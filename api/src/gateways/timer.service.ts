import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RedisService } from './redis.service';
import { SocketGateway } from './socket.gateway';

/**
 * Format des clés Redis pour les timers:
 * timer:{debateId}:{userId} -> nombre de secondes restantes
 * timer:{debateId}:{userId}:active -> "1" si le timer est actif, inexistant sinon
 */
@Injectable()
export class TimerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TimerService.name);
  private intervalId: NodeJS.Timeout | null = null;
  
  // Map pour suivre les timers actifs en mémoire
  private activeTimers = new Map<string, boolean>();
  
  constructor(
    private readonly redisService: RedisService,
    private readonly socketGateway: SocketGateway,
  ) {}

  /**
   * Initialisation du module: démarre le worker qui vérifie les timers
   */
  async onModuleInit() {
    this.logger.log('Starting timer service');
    // Démarrer le worker de timer qui s'exécute chaque seconde
    this.startTimerWorker();
  }

  /**
   * Nettoyage lors de l'arrêt du module
   */
  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.logger.log('Timer service stopped');
  }
  
  /**
   * Démarre un timer pour un utilisateur dans un débat
   * @param debateId ID du débat
   * @param userId ID de l'utilisateur
   * @param seconds Nombre de secondes initial (par défaut 60)
   * @returns Le nombre de secondes défini
   */
  async startTimer(debateId: string, userId: string, seconds: number = 60): Promise<number> {
    const timerKey = this.getTimerKey(debateId, userId);
    const activeKey = `${timerKey}:active`;
    
    try {
      // Stocker la valeur initiale de secondes dans Redis
      await this.redisService.pubClient.set(timerKey, seconds.toString());
      // Marquer le timer comme actif
      await this.redisService.pubClient.set(activeKey, '1');
      
      // Suivre ce timer en mémoire
      this.activeTimers.set(timerKey, true);
      
      this.logger.log(`Timer started for debate ${debateId}, user ${userId}: ${seconds}s`);
      
      // Émettre l'événement initial
      this.emitTimerTick(debateId, userId, seconds);
      
      return seconds;
    } catch (error) {
      this.logger.error(`Failed to start timer: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Met en pause un timer actif
   * @param debateId ID du débat
   * @param userId ID de l'utilisateur
   * @returns Le nombre de secondes restantes ou null si le timer n'existe pas
   */
  async pauseTimer(debateId: string, userId: string): Promise<number | null> {
    const timerKey = this.getTimerKey(debateId, userId);
    const activeKey = `${timerKey}:active`;
    
    try {
      // Vérifier si le timer existe
      const remainingSeconds = await this.redisService.pubClient.get(timerKey);
      
      if (!remainingSeconds) {
        this.logger.warn(`No timer found for debate ${debateId}, user ${userId}`);
        return null;
      }
      
      // Désactiver le timer
      await this.redisService.pubClient.del(activeKey);
      
      // Supprimer de la liste des timers actifs en mémoire
      this.activeTimers.delete(timerKey);
      
      const seconds = parseInt(remainingSeconds, 10);
      this.logger.log(`Timer paused for debate ${debateId}, user ${userId}: ${seconds}s remaining`);
      
      // Émettre l'événement de pause
      this.emitTimerPaused(debateId, userId, seconds);
      
      return seconds;
    } catch (error) {
      this.logger.error(`Failed to pause timer: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Réinitialise un timer (actif ou non)
   * @param debateId ID du débat
   * @param userId ID de l'utilisateur
   * @param seconds Nouveau nombre de secondes
   * @param autoStart Démarrer automatiquement le timer après réinitialisation
   * @returns Le nombre de secondes défini
   */
  async resetTimer(debateId: string, userId: string, seconds: number = 60, autoStart: boolean = true): Promise<number> {
    const timerKey = this.getTimerKey(debateId, userId);
    const activeKey = `${timerKey}:active`;
    
    try {
      // Stocker la nouvelle valeur de secondes
      await this.redisService.pubClient.set(timerKey, seconds.toString());
      
      if (autoStart) {
        // Activer le timer
        await this.redisService.pubClient.set(activeKey, '1');
        this.activeTimers.set(timerKey, true);
        this.logger.log(`Timer reset and started for debate ${debateId}, user ${userId}: ${seconds}s`);
      } else {
        // Désactiver le timer
        await this.redisService.pubClient.del(activeKey);
        this.activeTimers.delete(timerKey);
        this.logger.log(`Timer reset (paused) for debate ${debateId}, user ${userId}: ${seconds}s`);
      }
      
      // Émettre l'événement de réinitialisation
      this.emitTimerReset(debateId, userId, seconds);
      
      return seconds;
    } catch (error) {
      this.logger.error(`Failed to reset timer: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Obtient le temps restant d'un timer
   * @param debateId ID du débat
   * @param userId ID de l'utilisateur
   * @returns Le nombre de secondes restantes ou null si le timer n'existe pas
   */
  async getRemainingTime(debateId: string, userId: string): Promise<number | null> {
    const timerKey = this.getTimerKey(debateId, userId);
    
    try {
      const remainingSeconds = await this.redisService.pubClient.get(timerKey);
      
      if (!remainingSeconds) {
        return null;
      }
      
      return parseInt(remainingSeconds, 10);
    } catch (error) {
      this.logger.error(`Failed to get remaining time: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Vérifie si un timer est actif
   * @param debateId ID du débat
   * @param userId ID de l'utilisateur
   * @returns true si le timer est actif, false sinon
   */
  async isTimerActive(debateId: string, userId: string): Promise<boolean> {
    const timerKey = this.getTimerKey(debateId, userId);
    const activeKey = `${timerKey}:active`;
    
    try {
      const isActive = await this.redisService.pubClient.get(activeKey);
      return isActive === '1';
    } catch (error) {
      this.logger.error(`Failed to check timer status: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Prolonge un timer existant
   * @param debateId ID du débat
   * @param userId ID de l'utilisateur
   * @param additionalSeconds Secondes à ajouter
   * @returns Le nouveau nombre de secondes ou null si le timer n'existe pas
   */
  async extendTimer(debateId: string, userId: string, additionalSeconds: number = 30): Promise<number | null> {
    const timerKey = this.getTimerKey(debateId, userId);
    
    try {
      // Vérifier si le timer existe
      const currentValue = await this.redisService.pubClient.get(timerKey);
      
      if (!currentValue) {
        this.logger.warn(`No timer found for debate ${debateId}, user ${userId}`);
        return null;
      }
      
      // Calculer le nouveau temps
      const currentSeconds = parseInt(currentValue, 10);
      const newSeconds = currentSeconds + additionalSeconds;
      
      // Mettre à jour le timer
      await this.redisService.pubClient.set(timerKey, newSeconds.toString());
      
      this.logger.log(`Timer extended for debate ${debateId}, user ${userId}: +${additionalSeconds}s, new total: ${newSeconds}s`);
      
      // Émettre l'événement d'extension
      this.emitTimerExtended(debateId, userId, newSeconds, additionalSeconds);
      
      return newSeconds;
    } catch (error) {
      this.logger.error(`Failed to extend timer: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Supprime un timer
   * @param debateId ID du débat
   * @param userId ID de l'utilisateur
   */
  async deleteTimer(debateId: string, userId: string): Promise<void> {
    const timerKey = this.getTimerKey(debateId, userId);
    const activeKey = `${timerKey}:active`;
    
    try {
      // Supprimer les clés Redis
      await this.redisService.pubClient.del(timerKey, activeKey);
      
      // Supprimer de la liste des timers actifs en mémoire
      this.activeTimers.delete(timerKey);
      
      this.logger.log(`Timer deleted for debate ${debateId}, user ${userId}`);
      
      // Émettre l'événement de suppression
      this.emitTimerDeleted(debateId, userId);
    } catch (error) {
      this.logger.error(`Failed to delete timer: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Démarre le worker qui vérifie et met à jour les timers actifs
   * Ce worker s'exécute chaque seconde
   */
  private startTimerWorker(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    
    this.intervalId = setInterval(async () => {
      try {
        await this.processActiveTimers();
      } catch (error) {
        this.logger.error(`Error in timer worker: ${error.message}`);
      }
    }, 1000); // Interval de 1 seconde
    
    this.logger.log('Timer worker started');
  }
  
  /**
   * Traite tous les timers actifs en les décrémentant
   */
  private async processActiveTimers(): Promise<void> {
    // Obtenez la liste des timers actifs depuis Redis
    // Nous pourrions utiliser SCAN mais pour simplifier, nous utilisons la map en mémoire
    const activeTimerKeys = Array.from(this.activeTimers.keys());
    
    if (activeTimerKeys.length === 0) {
      return; // Pas de timers actifs
    }
    
    // Log périodique pour voir l'activité
    // if (Math.floor(Date.now() / 1000) % 10 === 0) { // Tous les 10 secondes
    //   this.logger.log(`⏰ Processing ${activeTimerKeys.length} active timers: ${activeTimerKeys.join(', ')}`);
    // }
    
    for (const timerKey of activeTimerKeys) {
      try {
        // Extraire debateId et userId du timerKey
        const [, debateId, userId] = timerKey.split(':');
        
        // Vérifier si le timer est toujours actif dans Redis
        const isActive = await this.isTimerActive(debateId, userId);
        
        if (!isActive) {
          // Le timer a été désactivé ailleurs, mettre à jour notre map locale
          this.activeTimers.delete(timerKey);
          // this.logger.log(`⏰ Timer ${timerKey} désactivé, supprimé de la map locale`);
          continue;
        }
        
        // Obtenir le temps restant
        const remainingSecondsStr = await this.redisService.pubClient.get(timerKey);
        
        if (!remainingSecondsStr) {
          // Timer n'existe plus, supprimer de notre map locale
          this.activeTimers.delete(timerKey);
          // this.logger.log(`⏰ Timer ${timerKey} n'existe plus dans Redis, supprimé de la map locale`);
          continue;
        }
        
        let remainingSeconds = parseInt(remainingSecondsStr, 10);
        
        // Décrémenter le timer
        remainingSeconds -= 1;
        
        if (remainingSeconds <= 0) {
          // Timer expiré
          remainingSeconds = 0;
          
          // Désactiver le timer
          const activeKey = `${timerKey}:active`;
          await this.redisService.pubClient.del(activeKey);
          this.activeTimers.delete(timerKey);
          
          this.logger.log(`⏰ Timer ${timerKey} EXPIRÉ !`);
          
          // Émettre l'événement d'expiration
          this.emitTimerExpired(debateId, userId);
        } else {
          // Mettre à jour le timer dans Redis
          await this.redisService.pubClient.set(timerKey, remainingSeconds.toString());
          
          // Log occasionnel pour voir l'activité
          if (remainingSeconds % 30 === 0) { // Tous les 30 secondes
            this.logger.log(`⏰ Timer ${timerKey}: ${remainingSeconds}s restantes`);
          }
          
          // Émettre l'événement de tic-tac
          this.emitTimerTick(debateId, userId, remainingSeconds);
        }
      } catch (error) {
        this.logger.error(`Error processing timer ${timerKey}: ${error.message}`);
      }
    }
  }
  
  /**
   * Génère la clé Redis pour un timer
   * @param debateId ID du débat
   * @param userId ID de l'utilisateur
   * @returns La clé Redis formatée
   */
  private getTimerKey(debateId: string, userId: string): string {
    return `timer:${debateId}:${userId}`;
  }
  
  /**
   * Émet un événement de tic-tac pour un timer
   * @param debateId ID du débat
   * @param userId ID de l'utilisateur
   * @param remainingSeconds Secondes restantes
   */
  private emitTimerTick(debateId: string, userId: string, remainingSeconds: number): void {
    // Émettre à la room spécifique au débat
    this.socketGateway.emitToRoom(
      `debate:${debateId}`,
      'timer_tick',
      {
        debateId,
        userId,
        remainingSeconds,
        event: 'tick',
      }
    );
  }
  
  /**
   * Émet un événement de pause pour un timer
   * @param debateId ID du débat
   * @param userId ID de l'utilisateur
   * @param remainingSeconds Secondes restantes
   */
  private emitTimerPaused(debateId: string, userId: string, remainingSeconds: number): void {
    this.socketGateway.emitToRoom(
      `debate:${debateId}`,
      'timer_paused',
      {
        debateId,
        userId,
        remainingSeconds,
        event: 'paused',
      }
    );
  }
  
  /**
   * Émet un événement d'expiration pour un timer
   * @param debateId ID du débat
   * @param userId ID de l'utilisateur
   */
  private emitTimerExpired(debateId: string, userId: string): void {
    this.socketGateway.emitToRoom(
      `debate:${debateId}`,
      'timer_expired',
      {
        debateId,
        userId,
        remainingSeconds: 0,
        event: 'expired',
      }
    );
  }
  
  /**
   * Émet un événement de réinitialisation pour un timer
   * @param debateId ID du débat
   * @param userId ID de l'utilisateur
   * @param seconds Nombre de secondes défini
   */
  private emitTimerReset(debateId: string, userId: string, seconds: number): void {
    this.socketGateway.emitToRoom(
      `debate:${debateId}`,
      'timer_reset',
      {
        debateId,
        userId,
        remainingSeconds: seconds,
        event: 'reset',
      }
    );
  }
  
  /**
   * Émet un événement d'extension pour un timer
   * @param debateId ID du débat
   * @param userId ID de l'utilisateur
   * @param newSeconds Nouveau nombre de secondes total
   * @param addedSeconds Secondes ajoutées
   */
  private emitTimerExtended(debateId: string, userId: string, newSeconds: number, addedSeconds: number): void {
    this.socketGateway.emitToRoom(
      `debate:${debateId}`,
      'timer_extended',
      {
        debateId,
        userId,
        remainingSeconds: newSeconds,
        addedSeconds,
        event: 'extended',
      }
    );
  }
  
  /**
   * Émet un événement de suppression pour un timer
   * @param debateId ID du débat
   * @param userId ID de l'utilisateur
   */
  private emitTimerDeleted(debateId: string, userId: string): void {
    this.socketGateway.emitToRoom(
      `debate:${debateId}`,
      'timer_deleted',
      {
        debateId,
        userId,
        event: 'deleted',
      }
    );
  }
} 