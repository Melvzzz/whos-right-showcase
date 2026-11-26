import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { N8nController } from './n8n.controller';
import { N8nService } from './n8n.service';
import { SocketModule } from '../gateways/socket.module';
import { PrismaService } from '../prisma/prisma.service';
import { TimerService } from '../gateways/timer.service';
import { ReportsModule } from '../reports/reports.module';
import { BotsModule } from '../bots/bots.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    ConfigModule,
    SocketModule, // For RedisService and TimerService
    ReportsModule, // For ReportsService (M0 rejection bans)
    forwardRef(() => BotsModule), // For BotPlayerService (notify bot on argument scored)
    forwardRef(() => QueueModule), // For retry-argument endpoint
  ],
  controllers: [N8nController],
  providers: [N8nService, PrismaService, TimerService],
  exports: [N8nService],
})
export class N8nModule {}
