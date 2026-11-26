import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DebatesController } from './debates.controller';
import { DebatesService } from './debates.service';
import { RecommendationsService } from './recommendations.service';
import { PrismaService } from '../prisma/prisma.service';
import { CleanupService } from '../gateways/cleanup.service';
import { SocketModule } from '../gateways/socket.module';
import { ArgumentsModule } from '../arguments/arguments.module';
import { ScoringModule } from '../scoring/scoring.module';
import { InvitationsModule } from '../invitations/invitations.module';
import { N8nModule } from '../n8n/n8n.module';
import { ModerationModule } from '../moderation/moderation.module';
import { BanGuard } from '../auth/guards/ban.guard';
import { BotsModule } from '../bots/bots.module';
import { NotificationModule } from '../notifications/notification.module';

@Module({
  imports: [
    ConfigModule, // Pour ConfigService (n8n feature flag)
    SocketModule, // Importer SocketModule pour accéder à SocketGateway, RedisService
    ArgumentsModule, // Importer ArgumentsModule pour accéder à DuelDebateAnalysisService
    ScoringModule, // Importer ScoringModule pour accéder à ScoringService
    forwardRef(() => InvitationsModule), // Éviter dépendance circulaire
    forwardRef(() => N8nModule), // Pour accéder à N8nService (analyse M0) - forwardRef pour éviter dépendance circulaire avec BotsModule
    ModerationModule, // Pour la modération du contenu (anti-insultes)
    NotificationModule, // Pour les notifications push (proposition d'arrêt)
    forwardRef(() => BotsModule), // Pour notifier BotPlayerService quand un débat commence/termine
  ],
  controllers: [DebatesController],
  providers: [
    DebatesService,
    RecommendationsService, // Sprint 3: Service de recommandations
    PrismaService,
    CleanupService, // Utilise RedisService (via SocketModule) et PrismaService
    BanGuard, // Guard pour vérifier si l'utilisateur est banni
  ],
  exports: [DebatesService, RecommendationsService],
})
export class DebatesModule {} 