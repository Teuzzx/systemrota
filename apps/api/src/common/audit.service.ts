import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { APP_CONFIG, AppConfig } from '../config/configuration';
import { PrismaService } from './prisma.service';

export interface AuditEntry {
  actorId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/**
 * Trilha de auditoria. Nunca registra senha, token ou segredo:
 * o payload passa por um redator antes de ir para o banco.
 */
const SECRET_KEYS = /^(password|senha|token|secret|authorization|refreshToken|accessToken|apiKey)/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[profundo]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redact(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEYS.test(key) ? '[redigido]' : redact(val, depth + 1);
    }
    return out;
  }
  return value;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId ?? null,
          actorEmail: entry.actorEmail ?? null,
          actorRole: entry.actorRole ?? null,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          before: entry.before === undefined ? Prisma.JsonNull : (redact(entry.before) as Prisma.InputJsonValue),
          after: entry.after === undefined ? Prisma.JsonNull : (redact(entry.after) as Prisma.InputJsonValue),
          ip: entry.ip ?? null,
          userAgent: entry.userAgent?.slice(0, 255) ?? null,
          requestId: entry.requestId ?? null,
        },
      });
    } catch (error) {
      // Auditoria nunca derruba a operacao: registra e segue.
      this.logger.error(`Falha ao gravar auditoria (${entry.action}/${entry.entity}): ${String(error)}`);
    }
  }

  get isProduction(): boolean {
    return this.config.isProduction;
  }
}
