import { Module } from '@nestjs/common';
import { ScoringService } from './scoring.service';
import { PrismaService } from '../prisma/prisma.service';
import { LlmModule } from '../llm/llm.module';
import { SocketModule } from '../gateways/socket.module';

@Module({
  imports: [
    LlmModule,
    SocketModule
  ],
  providers: [
    ScoringService,
    PrismaService
  ],
  exports: [
    ScoringService
  ]
})
export class ScoringModule {} 