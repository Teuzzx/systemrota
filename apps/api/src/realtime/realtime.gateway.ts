import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RoleKey } from '@prisma/client';
import { OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Inject } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/configuration';
import { PrismaService } from '../common/prisma.service';
import { AlertsService } from '../modules/alerts/alerts.service';
import { LocationsService } from '../modules/locations/locations.service';
import { DashboardService } from '../modules/dashboard/dashboard.service';

interface SocketPrincipal {
  userId: string;
  roles: RoleKey[];
  driverId: string | null;
}

export const CHANNELS = {
  OPERATIONS: 'operations',       // visao geral: painel administrativo
  DRIVER: (driverId: string) => `driver:${driverId}`,
  JOURNEY: (journeyId: string) => `journey:${journeyId}`,
} as const;

/**
 * WebSocket com autenticacao no handshake e canais escopados.
 * Nenhum dado operacional e transmitido para todos indiscriminadamente:
 *  - MOTORISTA so recebe o proprio canal;
 *  - ADMINISTRADOR/SUPERVISOR recebem o canal operacional.
 */
@Injectable()
@WebSocketGateway({ cors: { origin: '*', credentials: false } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer() private server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly principals = new Map<string, SocketPrincipal>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly locations: LocationsService,
    private readonly dashboard: DashboardService,
    private readonly alerts: AlertsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.nodeEnv === 'test') return;
    // Publicacao periodica: posicoes e alertas. Em producao, o ideal e
    // disparar por mudanca; o timer mantem o painel vivo mesmo sem eventos.
    this.timer = setInterval(() => {
      void this.broadcastOperational();
    }, 15_000);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  async handleConnection(socket: Socket): Promise<void> {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      (socket.handshake.headers.authorization as string | undefined)?.replace(/^Bearer /i, '');
    if (!token) {
      socket.disconnect(true);
      return;
    }
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; roles: RoleKey[]; driverId: string | null; typ: string }>(
        token,
        { secret: this.config.auth.accessSecret },
      );
      if (payload.typ !== 'access') throw new Error('tipo invalido');
      this.principals.set(socket.id, {
        userId: payload.sub,
        roles: payload.roles,
        driverId: payload.driverId,
      });
      if (this.isOperationsViewer(payload.roles)) {
        await socket.join(CHANNELS.OPERATIONS);
      }
      if (payload.driverId) {
        await socket.join(CHANNELS.DRIVER(payload.driverId));
      }
      socket.emit('connected', { channels: this.channelsOf(socket.id) });
    } catch {
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: Socket): void {
    this.principals.delete(socket.id);
  }

  @SubscribeMessage('journey:subscribe')
  async handleJourneySubscribe(socket: Socket, payload: { journeyId?: string }): Promise<{ ok: boolean; error?: string }> {
    const principal = this.principals.get(socket.id);
    if (!principal || !payload?.journeyId) return { ok: false, error: 'nao autorizado' };
    const journey = await this.prisma.journey.findUnique({
      where: { id: payload.journeyId },
      select: { driverId: true },
    });
    if (!journey) return { ok: false, error: 'jornada nao encontrada' };
    const allowed = this.isOperationsViewer(principal.roles) || journey.driverId === principal.driverId;
    if (!allowed) return { ok: false, error: 'acesso negado a esta jornada' };
    await socket.join(CHANNELS.JOURNEY(payload.journeyId));
    return { ok: true };
  }

  /** Publica o retrato operacional para quem tem permissao de leitura. */
  async broadcastOperational(): Promise<void> {
    if (!this.server || this.server.engine.clientsCount === 0) return;
    try {
      const [positions, overview, alertStats] = await Promise.all([
        this.locations.latestPositions(),
        this.dashboard.overview(),
        this.alerts.stats(),
      ]);
      this.server.to(CHANNELS.OPERATIONS).emit('operations:snapshot', {
        positions,
        overview,
        alerts: alertStats,
        emittedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.warn(`Falha ao publicar snapshot operacional: ${String(error)}`);
    }
  }

  /** Notificacao de evento pontual (visita concluida, alerta novo, etc.). */
  async publishJourneyEvent(journeyId: string, event: unknown): Promise<void> {
    if (!this.server) return;
    this.server.to(CHANNELS.JOURNEY(journeyId)).emit('journey:event', event);
    this.server.to(CHANNELS.OPERATIONS).emit('journey:event', event);
  }

  private isOperationsViewer(roles: RoleKey[]): boolean {
    return roles.includes(RoleKey.ADMINISTRADOR) || roles.includes(RoleKey.SUPERVISOR);
  }

  private channelsOf(socketId: string): string[] {
    const socket = this.server?.sockets.sockets.get(socketId);
    return socket ? [...socket.rooms].filter((r) => r !== socketId) : [];
  }
}
