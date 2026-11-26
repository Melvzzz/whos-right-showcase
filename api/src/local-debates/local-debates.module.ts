import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LocalDebatesController } from './local-debates.controller';
import { LocalDebatesService } from './local-debates.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueModule } from '../queue/queue.module';
import { ArgumentsModule } from '../arguments/arguments.module';
import { N8nModule } from '../n8n/n8n.module';
import { ModerationModule } from '../moderation/moderation.module';

@Module({
  imports: [
    ConfigModule,
    QueueModule,
    ArgumentsModule, // Pour accéder à DuelDebateAnalysisService (fallback)
    N8nModule, // Pour n8n analysis
    ModerationModule, // Pour la modération du contenu (anti-insultes)
  ],
  controllers: [LocalDebatesController],
  providers: [
    LocalDebatesService,
    PrismaService,
  ],
  exports: [LocalDebatesService],
})
export class LocalDebatesModule {}