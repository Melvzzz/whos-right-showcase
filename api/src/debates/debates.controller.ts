import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { DebatesService } from './debates.service';
import { RecommendationsService, RecommendedDebate } from './recommendations.service';
import { CreateDebateDto } from './dto/create-debate.dto';
import { CreatePrivateDebateDto } from './dto/create-private-debate.dto';
import { RespondStopDto } from './dto/respond-stop.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CleanupService } from '../gateways/cleanup.service';
import { ScoringService, DebateResult } from '../scoring/scoring.service';
import { BanGuard } from '../auth/guards/ban.guard';

@Controller('debates')
export class DebatesController {
  constructor(
    private readonly debatesService: DebatesService,
    private readonly recommendationsService: RecommendationsService,
    private readonly prisma: PrismaService,
    private readonly cleanupService: CleanupService,
    private readonly scoringService: ScoringService
  ) {}

  /**
   * Crée un nouveau débat
   * POST /debates
   */
  @Post()
  @UseGuards(AuthGuard('jwt'), BanGuard)
  async create(@Req() req, @Body() createDebateDto: CreateDebateDto) {
    return this.debatesService.create(req.user.id, createDebateDto);
  }

  /**
   * ✅ NOUVEAU : Crée un débat privé avec invitation (mode ami)
   * POST /debates/private
   */
  @Post('private')
  @UseGuards(AuthGuard('jwt'), BanGuard)
  async createPrivate(@Req() req, @Body() createPrivateDebateDto: CreatePrivateDebateDto) {
    return this.debatesService.createPrivateDebate(req.user.id, createPrivateDebateDto);
  }

  /**
   * Récupère tous les débats avec filtrage optionnel
   * GET /debates?status=waiting&live=true&languages=fr,en
   */
  @Get()
  @UseGuards(AuthGuard('jwt'))
  async findAll(
    @Req() req,
    @Query('status') status?: string,
    @Query('live') live?: string,
    @Query('languages') languages?: string
  ) {
    try {
      // Parse live query parameter to boolean if provided
      const isLive = live !== undefined ? live === 'true' : undefined;

      // ✅ NOUVEAU : Si languages est fourni, l'utiliser directement
      // Sinon, utiliser la langue préférée de l'utilisateur
      let languagesToFilter: string[] = [];

      if (languages) {
        // Parse comma-separated languages (ex: "fr,en")
        languagesToFilter = languages.split(',').map(l => l.trim()).filter(l => l);
      } else {
        // Fallback: utiliser la langue préférée de l'utilisateur
        try {
          const user = await this.prisma.user.findUnique({
            where: { id: req.user.id },
            select: { preferredLanguage: true }
          });
          languagesToFilter = [user?.preferredLanguage || 'fr'];
        } catch (userError) {
          console.warn('⚠️ Impossible de récupérer la langue utilisateur, utilisation du français par défaut:', userError.message);
          languagesToFilter = ['fr'];
        }
      }

      return this.debatesService.findAll({
        status,
        languages: languagesToFilter, // ✅ NOUVEAU : Support multi-langues
        isLive
      });
    } catch (error) {
      console.error('❌ Erreur dans findAll debates controller:', error);
      // En cas d'erreur, retourner la méthode originale sans filtrage par langue
      return this.debatesService.findAll({ status });
    }
  }

  /**
   * ✅ ASYNC : Récupère les débats asynchrones de l'utilisateur
   * GET /debates/my-async
   * IMPORTANT: Doit être AVANT @Get(':id') pour éviter que 'my-async' soit interprété comme un ID
   */
  @Get('my-async')
  @UseGuards(AuthGuard('jwt'))
  async getMyAsyncDebates(@Req() req) {
    return this.debatesService.getMyAsyncDebates(req.user.id);
  }

  /**
   * ✅ ASYNC : Récupère le nombre de débats asynchrones simultanés actifs
   * GET /debates/async-count
   * Retourne { count, limit, canCreate, role }
   * IMPORTANT: Doit être AVANT @Get(':id') pour éviter que 'async-count' soit interprété comme un ID
   */
  @Get('async-count')
  @UseGuards(AuthGuard('jwt'))
  async getAsyncDebateCount(@Req() req) {
    return this.debatesService.getAsyncDebateCount(req.user.id);
  }

  /**
   * Sprint 3: Récupère les débats recommandés pour l'utilisateur
   * GET /debates/recommendations?languages=fr,en&live=true&limit=20
   * Utilise le profil évolutif pour recommander des débats avec:
   * - Sujets familiers (25%)
   * - Bridging politique (35%) - profils opposés
   * - Diversité d'âge (15%)
   * - Compatibilité ELO (25%)
   * IMPORTANT: Doit être AVANT @Get(':id')
   */
  @Get('recommendations')
  @UseGuards(AuthGuard('jwt'))
  async getRecommendations(
    @Req() req,
    @Query('languages') languages?: string,
    @Query('live') live?: string,
    @Query('limit') limit?: string,
  ): Promise<RecommendedDebate[]> {
    // Parse languages
    let languagesToFilter: string[] = ['fr'];
    if (languages) {
      languagesToFilter = languages.split(',').map(l => l.trim()).filter(l => l);
    } else {
      // Fallback: langue préférée de l'utilisateur
      const user = await this.prisma.user.findUnique({
        where: { id: req.user.id },
        select: { preferredLanguage: true },
      });
      languagesToFilter = [user?.preferredLanguage || 'fr'];
    }

    // Parse isLive
    const isLive = live !== undefined ? live === 'true' : undefined;

    // Parse limit
    const limitNum = limit ? parseInt(limit, 10) : 20;

    return this.recommendationsService.getRecommendations(req.user.id, {
      languages: languagesToFilter,
      isLive,
      limit: limitNum,
    });
  }

  /**
   * Récupère un débat par son ID
   * GET /debates/:id
   */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.debatesService.findOne(id);
  }

  /**
   * ✅ NOUVEAU : Récupère le récapitulatif d'un débat terminé
   * GET /debates/:id/recap
   */
  @Get(':id/recap')
  @UseGuards(AuthGuard('jwt'))
  async getRecap(@Param('id') id: string, @Req() req) {
    return this.debatesService.getDebateRecap(id, req.user.id);
  }

  /**
   * 🎓 COACHING : Récupère le coaching post-debate pour l'utilisateur
   * GET /debates/:id/coaching
   */
  @Get(':id/coaching')
  @UseGuards(AuthGuard('jwt'))
  async getCoaching(@Param('id') id: string, @Req() req) {
    return this.debatesService.getCoaching(id, req.user.id);
  }

  /**
   * ✅ PREMIUM GATING : Enregistre la consultation d'un argument (FREE limité à 3/debate)
   * POST /debates/:id/view-argument
   */
  @Post(':id/view-argument')
  @UseGuards(AuthGuard('jwt'))
  async viewArgument(
    @Param('id') debateId: string,
    @Body() body: { argumentId: string },
    @Req() req
  ) {
    return this.debatesService.viewArgument(debateId, req.user.id, body.argumentId);
  }

  /**
   * ✅ ASYNC : Propose l'arrêt d'un débat asynchrone
   * POST /debates/:id/propose-stop
   */
  @Post(':id/propose-stop')
  @UseGuards(AuthGuard('jwt'))
  async proposeStop(@Req() req, @Param('id') debateId: string) {
    return this.debatesService.proposeStop(req.user.id, debateId);
  }

  /**
   * ✅ ASYNC : Répond à une proposition d'arrêt de débat asynchrone
   * POST /debates/:id/respond-stop
   */
  @Post(':id/respond-stop')
  @UseGuards(AuthGuard('jwt'))
  async respondStop(
    @Req() req,
    @Param('id') debateId: string,
    @Body() dto: RespondStopDto
  ) {
    return this.debatesService.respondStop(req.user.id, debateId, dto.accept);
  }

  /**
   * ✅ ASYNC : Accepte une proposition d'arrêt
   * POST /debates/:id/accept-stop
   */
  @Post(':id/accept-stop')
  @UseGuards(AuthGuard('jwt'))
  async acceptStop(@Req() req, @Param('id') debateId: string) {
    return this.debatesService.respondStop(req.user.id, debateId, true);
  }

  /**
   * ✅ ASYNC : Refuse une proposition d'arrêt
   * POST /debates/:id/refuse-stop
   */
  @Post(':id/refuse-stop')
  @UseGuards(AuthGuard('jwt'))
  async refuseStop(@Req() req, @Param('id') debateId: string) {
    return this.debatesService.respondStop(req.user.id, debateId, false);
  }

  /**
   * ✅ ASYNC : Libère un débat rejoint sans avoir envoyé d'argument
   * POST /debates/:id/release-join
   * Utilisé quand le guest quitte l'écran de débat async avant d'envoyer son premier argument
   */
  @Post(':id/release-join')
  @UseGuards(AuthGuard('jwt'))
  async releaseJoin(@Req() req, @Param('id') debateId: string) {
    return this.debatesService.releaseJoin(debateId, req.user.id);
  }

  /**
   * Rejoint un débat existant
   * PATCH /debates/:id/join
   */
  @Patch(':id/join')
  @UseGuards(AuthGuard('jwt'), BanGuard)
  async join(@Param('id') id: string, @Body() joinData: { guestView: string }, @Req() req) {
    console.log('🎯 [DebatesController] Tentative de rejoindre le débat:', {
      debateId: id,
      userId: req.user?.id,
      guestView: joinData?.guestView?.substring(0, 50) + '...',
      userEmail: req.user?.email
    });
    return this.debatesService.join(id, req.user.id, joinData.guestView);
  }

  /**
   * Réserve un débat pour prévisualisation
   * PATCH /debates/:id/reserve
   */
  @Patch(':id/reserve')
  @UseGuards(AuthGuard('jwt'))
  async reserve(@Param('id') id: string, @Req() req) {
    return this.debatesService.reserve(id, req.user.id);
  }

  /**
   * Libère la réservation d'un débat
   * PATCH /debates/:id/unreserve
   */
  @Patch(':id/unreserve')
  @UseGuards(AuthGuard('jwt'))
  async unreserve(@Param('id') id: string, @Req() req) {
    return this.debatesService.unreserve(id, req.user.id);
  }

  /**
   * Supprime tous les arguments d'un débat
   * DELETE /debates/:id/arguments
   */
  @Delete(':id/arguments')
  async deleteArguments(@Param('id') id: string) {
    try {
      // Supprimer tous les arguments (sources stockées en JSON dans Argument.sourcesData)
      await this.prisma.argument.deleteMany({
        where: { debateId: id }
      });

      return { 
        success: true,
        message: `Tous les arguments du débat ${id} ont été supprimés` 
      };
    } catch (error) {
      return {
        success: false,
        error: `Erreur lors de la suppression des arguments: ${error.message}`
      };
    }
  }

  /**
   * Quitte un débat en cours
   * POST /debates/:id/quit
   */
  @Post(':id/quit')
  @UseGuards(AuthGuard('jwt'))
  async quit(@Param('id') id: string, @Req() req) {
    await this.debatesService.quit(id, req.user.id);
    return { success: true };
  }

  /**
   * ✅ ASYNC : Abandonne un débat asynchrone (forfait)
   * POST /debates/:id/forfeit
   */
  @Post(':id/forfeit')
  @UseGuards(AuthGuard('jwt'))
  async forfeit(@Param('id') id: string, @Req() req) {
    await this.debatesService.forfeit(id, req.user.id);
    return { success: true };
  }

  /**
   * ✅ ASYNC : Marque le récap comme vu pour l'utilisateur
   * POST /debates/:id/mark-recap-viewed
   */
  @Post(':id/mark-recap-viewed')
  @UseGuards(AuthGuard('jwt'))
  async markRecapViewed(@Param('id') id: string, @Req() req) {
    await this.debatesService.markRecapViewed(id, req.user.id);
    return { success: true };
  }

  /**
   * ✅ NOUVEAU : Propose l'arrêt du débat
   * POST /debates/:id/propose-end
   */
  @Post(':id/propose-end')
  @UseGuards(AuthGuard('jwt'))
  async proposeEnd(@Param('id') id: string, @Body() body: { userId: string, username: string }, @Req() req) {
    await this.debatesService.proposeDebateEnd(id, req.user.id, body.username);
    return { success: true, message: 'Proposition d\'arrêt envoyée' };
  }

  /**
   * ✅ NOUVEAU : Accepter l'arrêt du débat avec vérification de sécurité
   * POST /debates/:id/accept-end
   */
  @Post(':id/accept-end')
  @UseGuards(AuthGuard('jwt'))
  async acceptEnd(@Param('id') id: string, @Body() body: { userId: string, username: string }, @Req() req) {
    await this.debatesService.acceptDebateEndWithSecurity(id, req.user.id, body.username);
    return { success: true, message: 'Vérification en cours...' };
  }

  /**
   * ✅ NOUVEAU : Refuser l'arrêt du débat
   * POST /debates/:id/refuse-end
   */
  @Post(':id/refuse-end')
  @UseGuards(AuthGuard('jwt'))
  async refuseEnd(@Param('id') id: string, @Body() body: { userId: string, username: string, refusedUsername: string }, @Req() req) {
    await this.debatesService.refuseDebateEnd(id, req.user.id, body.username);
    return { success: true, message: 'Proposition refusée' };
  }

  /**
   * Supprime un débat
   * DELETE /debates/:id
   */
  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  async delete(@Param('id') id: string, @Req() req) {
    await this.debatesService.delete(id, req.user.id);
    return { success: true };
  }

  /**
   * Force un nettoyage manuel des débats abandonnés
   * POST /debates/cleanup
   */
  @Post('cleanup')
  async forceCleanup() {
    await this.cleanupService.forceCleanup();
    return { success: true, message: 'Nettoyage effectué' };
  }

  /**
   * Récupère tous les débats (tous états confondus) - pour administration
   * GET /debates/all
   */
  @Get('all')
  findAllDebates(@Query('status') status?: string) {
    return this.debatesService.findAll({ status, includeAll: true });
  }

  /**
   * ✅ NOUVEAU : Finalise un débat en calculant ELO et XP
   * POST /debates/:id/finalize
   */
  @Post(':id/finalize')
  @UseGuards(AuthGuard('jwt'))
  async finalizeDebate(
    @Param('id') debateId: string,
    @Body() debateResult: DebateResult,
    @Req() req
  ) {
    try {
      // Vérifier que l'utilisateur est participant du débat
      const debate = await this.prisma.debate.findUnique({
        where: { id: debateId },
        include: { host: true, guest: true }
      });

      if (!debate) {
        return { error: 'Débat introuvable' };
      }

      if (!debate.guest) {
        return { error: 'Débat incomplet (pas d\'invité)' };
      }

      // Vérifier que l'utilisateur connecté est participant
      const userId = req.user.id;
      if (userId !== debate.hostId && userId !== debate.guestId) {
        return { error: 'Accès refusé - vous n\'êtes pas participant à ce débat' };
      }

      // Calculer et appliquer les scores ELO et XP
      const scoringResult = await this.scoringService.finalizeDebate(debateId, debateResult);

      return {
        success: true,
        result: scoringResult,
        message: 'Débat finalisé avec succès'
      };

    } catch (error) {
      console.error('Erreur lors de la finalisation du débat:', error);
      return {
        error: error.message || 'Erreur lors de la finalisation du débat'
      };
    }
  }
} 