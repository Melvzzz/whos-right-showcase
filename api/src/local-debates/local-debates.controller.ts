import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpStatus,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { LocalDebatesService, CreateLocalDebateDto, AddLocalArgumentDto } from './local-debates.service';

/**
 * Contrôleur pour les débats locaux
 * Endpoints pour créer, gérer et analyser les débats en mode local
 */
@Controller('local-debates')
@UseGuards(AuthGuard('jwt'))
export class LocalDebatesController {
  constructor(private readonly localDebatesService: LocalDebatesService) {}

  /**
   * Créer un nouveau débat local
   * POST /local-debates
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createLocalDebate(
    @Request() req: any,
    @Body() createDebateDto: CreateLocalDebateDto
  ) {
    const userId = req.user.id;

    // Validation des données
    if (!createDebateDto.title || createDebateDto.title.length < 15) {
      throw new BadRequestException('Le titre doit contenir au moins 15 caractères');
    }

    if (!createDebateDto.player1Name || !createDebateDto.player2Name) {
      throw new BadRequestException('Les noms des joueurs sont requis');
    }

    if (!createDebateDto.player1Viewpoint || !createDebateDto.player2Viewpoint) {
      throw new BadRequestException('Les points de vue des joueurs sont requis');
    }

    if (![30, 60, 90].includes(createDebateDto.maxArgumentTime)) {
      throw new BadRequestException('Temps maximum par argument invalide (30, 60 ou 90 secondes)');
    }

    const result = await this.localDebatesService.createLocalDebate(userId, createDebateDto);

    return {
      success: true,
      localDebate: result,
      message: 'Débat local créé avec succès'
    };
  }

  /**
   * Récupérer un débat local spécifique
   * GET /local-debates/:id
   */
  @Get(':id')
  async getLocalDebate(@Param('id') id: string) {
    const result = await this.localDebatesService.getLocalDebate(id);

    return {
      success: true,
      localDebate: result
    };
  }

  /**
   * Ajouter un argument à un débat local
   * POST /local-debates/:id/arguments
   */
  @Post(':id/arguments')
  async addLocalArgument(
    @Param('id') localDebateId: string,
    @Body() addArgumentDto: AddLocalArgumentDto
  ) {
    // Validation des données
    if (!['player1', 'player2'].includes(addArgumentDto.playerId)) {
      throw new BadRequestException('playerId doit être "player1" ou "player2"');
    }

    if (!addArgumentDto.rawText || addArgumentDto.rawText.length < 10) {
      throw new BadRequestException('Le texte de l\'argument doit contenir au moins 10 caractères');
    }

    if (!addArgumentDto.playerName) {
      throw new BadRequestException('Le nom du joueur est requis');
    }

    if (!addArgumentDto.duration || addArgumentDto.duration < 1) {
      throw new BadRequestException('La durée d\'enregistrement est requise');
    }

    const result = await this.localDebatesService.addLocalArgument(localDebateId, addArgumentDto);

    return {
      success: true,
      argument: result,
      message: 'Argument ajouté avec succès - analyse IA en cours'
    };
  }

  /**
   * Mettre à jour un débat local (changement de tour, timers, etc.)
   * PUT /local-debates/:id
   */
  @Put(':id')
  async updateLocalDebate(
    @Param('id') id: string,
    @Body() updateData: {
      currentTurn?: 'player1' | 'player2';
      player1Timer?: number;
      player2Timer?: number;
      status?: 'active' | 'completed';
    }
  ) {
    // Validation des données
    if (updateData.currentTurn && !['player1', 'player2'].includes(updateData.currentTurn)) {
      throw new BadRequestException('currentTurn doit être "player1" ou "player2"');
    }

    if (updateData.status && !['active', 'completed'].includes(updateData.status)) {
      throw new BadRequestException('status doit être "active" ou "completed"');
    }

    if (updateData.player1Timer !== undefined && updateData.player1Timer < 0) {
      throw new BadRequestException('player1Timer ne peut pas être négatif');
    }

    if (updateData.player2Timer !== undefined && updateData.player2Timer < 0) {
      throw new BadRequestException('player2Timer ne peut pas être négatif');
    }

    const result = await this.localDebatesService.updateLocalDebate(id, updateData);

    return {
      success: true,
      localDebate: result,
      message: 'Débat local mis à jour'
    };
  }

  /**
   * Terminer un débat local
   * POST /local-debates/:id/end
   */
  @Post(':id/end')
  async endLocalDebate(@Param('id') id: string) {
    const result = await this.localDebatesService.endLocalDebate(id);

    return {
      success: true,
      localDebate: result,
      message: 'Débat local terminé'
    };
  }

  /**
   * Récupérer les détails d'un argument local spécifique
   * GET /local-debates/:debateId/arguments/:argumentId
   */
  @Get(':debateId/arguments/:argumentId')
  async getLocalArgumentDetail(
    @Param('debateId') debateId: string,
    @Param('argumentId') argumentId: string
  ) {
    const result = await this.localDebatesService.getLocalArgumentDetail(debateId, argumentId);

    return {
      success: true,
      argument: result
    };
  }

  /**
   * Vérifier si des arguments sont encore en cours de traitement
   * GET /local-debates/:id/processing-status
   */
  @Get(':id/processing-status')
  async getProcessingStatus(@Param('id') id: string) {
    const result = await this.localDebatesService.getProcessingStatus(id);

    return {
      success: true,
      ...result
    };
  }

  /**
   * Récupérer le récapitulatif d'un débat local terminé
   * GET /local-debates/:id/recap
   */
  @Get(':id/recap')
  async getLocalDebateRecap(@Param('id') id: string, @Request() req: any) {
    const userId = req.user.id;
    const result = await this.localDebatesService.getLocalDebateRecap(id, userId);

    return result;
  }

  /**
   * Récupérer l'historique des débats locaux de l'utilisateur connecté
   * GET /local-debates/user/history
   */
  @Get('user/history')
  async getUserLocalDebates(
    @Request() req: any,
    @Query('limit') limit?: string
  ) {
    const userId = req.user.id;
    const limitNumber = limit ? parseInt(limit) : 20;

    if (limitNumber > 100) {
      throw new BadRequestException('Limite maximum: 100 débats');
    }

    const result = await this.localDebatesService.getUserLocalDebates(userId, limitNumber);

    return {
      success: true,
      localDebates: result,
      count: result.length
    };
  }

  /**
   * Supprimer un débat local
   * DELETE /local-debates/:id
   */
  @Delete(':id')
  async deleteLocalDebate(
    @Param('id') id: string,
    @Request() req: any
  ) {
    const userId = req.user.id;

    // Vérifier que l'utilisateur est le propriétaire
    const localDebate = await this.localDebatesService.getLocalDebate(id);

    if (localDebate.hostUserId !== userId) {
      throw new BadRequestException('Vous ne pouvez supprimer que vos propres débats locaux');
    }

    // Supprimer le débat (cascade supprime automatiquement les arguments)
    await this.localDebatesService.deleteLocalDebate(id);

    return {
      success: true,
      message: 'Débat local supprimé'
    };
  }

  /**
   * Obtenir les statistiques des débats locaux
   * GET /local-debates/stats
   */
  @Get('stats/overview')
  async getLocalDebatesStats(@Request() req: any) {
    const userId = req.user.id;
    const stats = await this.localDebatesService.getUserLocalDebatesStats(userId);

    return {
      success: true,
      stats
    };
  }
}