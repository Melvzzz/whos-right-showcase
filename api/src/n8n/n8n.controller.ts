import { Controller, Post, Body, Param, Logger, HttpCode, HttpStatus } from '@nestjs/common';
import { N8nService } from './n8n.service';
import { M1ResultDto } from './dto/m1-result.dto';
import { M3ResultDto } from './dto/m3-result.dto';
import { PrismaService } from '../prisma/prisma.service';
import { PostHogService } from '../posthog/posthog.service';
import { QueueService } from '../queue/queue.service';

@Controller('n8n')
export class N8nController {
  private readonly logger = new Logger(N8nController.name);

  constructor(
    private readonly n8nService: N8nService,
    private readonly prisma: PrismaService,
    private readonly posthog: PostHogService,
    private readonly queueService: QueueService,
  ) {}

  /**
   * Check if an argument ID belongs to a LocalArgument
   */
  private async isLocalArgument(argumentId: string): Promise<boolean> {
    const localArg = await this.prisma.localArgument.findUnique({
      where: { id: argumentId },
      select: { id: true },
    });
    return !!localArg;
  }

  /**
   * Check if a debate ID belongs to a LocalDebate
   */
  private async isLocalDebate(debateId: string): Promise<boolean> {
    const localDebate = await this.prisma.localDebate.findUnique({
      where: { id: debateId },
      select: { id: true },
    });
    return !!localDebate;
  }

  /**
   * Receive M0 (StartDebate) results from n8n
   * Called after debate analysis is complete
   * Automatically detects if it's a local or regular debate
   */
  @Post('m0-result')
  @HttpCode(HttpStatus.OK)
  async receiveM0Result(@Body() body: any): Promise<{ success: boolean }> {
    this.logger.log(`📥 Received M0 result for debate ${body.debateId}`);

    try {
      // Check if this is a local debate
      const isLocal = await this.isLocalDebate(body.debateId);

      if (isLocal) {
        this.logger.log(`📍 Detected LOCAL debate, saving to LocalDebate table`);
        await this.n8nService.saveLocalM0Result(body);
      } else {
        await this.n8nService.saveM0Result(body);
      }

      return { success: true };
    } catch (error) {
      this.logger.error(`❌ Failed to save M0 result: ${error.message}`);
      throw error;
    }
  }

  /**
   * Receive M1 (Orchestrator) results from n8n
   * Called after message classification is complete
   * Automatically detects if it's a local or regular argument
   */
  @Post('m1-result')
  @HttpCode(HttpStatus.OK)
  async receiveM1Result(@Body() dto: M1ResultDto): Promise<{ success: boolean }> {
    this.logger.log(`📥 Received M1 result for argument ${dto.argumentId}`);

    try {
      // Check if this is a local argument
      const isLocal = await this.isLocalArgument(dto.argumentId);

      if (isLocal) {
        this.logger.log(`📍 Detected LOCAL argument, saving to LocalArgument table`);
        await this.n8nService.saveLocalM1Result(dto);
      } else {
        await this.n8nService.saveM1Result(dto);
      }

      return { success: true };
    } catch (error) {
      this.logger.error(`❌ Failed to save M1 result: ${error.message}`);
      throw error;
    }
  }

  /**
   * Receive M3 (Judge) results from n8n
   * Called after scoring is complete (includes M2 factcheck if applicable)
   * Automatically detects if it's a local or regular argument
   */
  @Post('m3-result')
  @HttpCode(HttpStatus.OK)
  async receiveM3Result(
    @Body() body: any,
  ): Promise<{ success: boolean }> {
    // Cast brut : pas de ValidationPipe pour préserver les objets nested (fallacies, biases, sources)
    // Le pipe global strip les propriétés non-décorées des objets nested — on le bypass
    const dto = body as M3ResultDto;
    this.logger.log(`📥 Received M3 result for argument ${dto.argumentId}`);

    try {
      // Check if this is a local argument
      const isLocal = await this.isLocalArgument(dto.argumentId);

      if (isLocal) {
        this.logger.log(`📍 Detected LOCAL argument, saving to LocalArgument table`);
        await this.n8nService.saveLocalM3Result(dto);
      } else {
        await this.n8nService.saveM3Result(dto);
      }

      // Track argument analysis completed (for fact-checking metrics), skip bots
      if (dto.userId) {
        const user = await this.prisma.user.findUnique({
          where: { id: dto.userId },
          select: { isBot: true },
        });

        if (!user?.isBot) {
          const usedFactChecking = dto.needsFactcheck === true && (dto.sources?.length ?? 0) > 0;
          const sourcesCount = dto.sources?.length ?? 0;

          this.posthog.trackArgumentAnalysisCompleted(
            dto.userId,
            dto.argumentId,
            dto.debateId || '',
            usedFactChecking,
            sourcesCount,
            dto.finalScore ?? null,
          );
        }
      }

      return { success: true };
    } catch (error) {
      this.logger.error(`❌ Failed to save M3 result: ${error.message}`);
      throw error;
    }
  }

  /**
   * Retry analysis for a stuck argument
   * Re-queues the argument through the M1→M2→M3 pipeline
   */
  @Post('retry-argument/:argumentId')
  @HttpCode(HttpStatus.OK)
  async retryArgument(
    @Param('argumentId') argumentId: string,
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log(`🔄 Retry requested for argument ${argumentId}`);

    try {
      const argument = await this.prisma.argument.findUnique({
        where: { id: argumentId },
        include: { debate: true },
      });

      if (!argument) {
        return { success: false, message: `Argument ${argumentId} not found` };
      }

      const debate = argument.debate;
      this.logger.log(`🔄 Retrying argument ${argumentId} (state: ${argument.state}, debate: ${debate.id}, m0: ${debate.n8nM0Completed})`);

      // If M0 is not done (or branchCode is missing), run it and wait for callback
      if (!debate.n8nM0Completed || !debate.n8nBranchCode) {
        this.logger.log(`🔄 M0 not ready for debate ${debate.id} (completed: ${debate.n8nM0Completed}, branchCode: ${debate.n8nBranchCode || 'MISSING'}), running M0...`);
        await this.n8nService.callStartDebate(
          debate.id,
          debate.title,
          debate.hostView || '',
          debate.guestView || '',
          debate.gameMode || 'COMPETITIVE',
        );

        // The sync response has no M0 data — wait for the async callback to save it
        const maxWaitMs = 15000;
        const pollIntervalMs = 500;
        let waited = 0;
        let m0Ready = false;
        while (waited < maxWaitMs) {
          await new Promise((r) => setTimeout(r, pollIntervalMs));
          waited += pollIntervalMs;
          const freshDebate = await this.prisma.debate.findUnique({
            where: { id: debate.id },
            select: { n8nM0Completed: true, n8nBranchCode: true },
          });
          if (freshDebate?.n8nM0Completed && freshDebate?.n8nBranchCode) {
            m0Ready = true;
            this.logger.log(`✅ M0 ready for debate ${debate.id} after ${waited}ms (branchCode: ${freshDebate.n8nBranchCode})`);
            break;
          }
        }

        if (!m0Ready) {
          return {
            success: false,
            message: `M0 callback did not arrive within ${maxWaitMs / 1000}s for debate ${debate.id}. Check n8n logs.`,
          };
        }
      }

      // Reset state to created
      await this.prisma.argument.update({
        where: { id: argumentId },
        data: { state: 'created' },
      });

      // Re-queue through the normal pipeline
      await this.queueService.addM1Job({
        argumentId: argument.id,
        debateId: argument.debateId,
        rawText: argument.rawText,
        userId: argument.userId,
        factCheckEnabled: argument.factChecked,
      });

      return {
        success: true,
        message: `Argument ${argumentId} re-queued for analysis (m0 was: ${debate.n8nM0Completed}, state was: ${argument.state})`,
      };
    } catch (error) {
      this.logger.error(`❌ Retry failed for argument ${argumentId}: ${error.message}`);
      return { success: false, message: error.message };
    }
  }

}
