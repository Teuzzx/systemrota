import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AlertThresholds,
  DEFAULT_ALERT_THRESHOLDS,
  DEFAULT_TRACKING_POLICY,
  TrackingPolicy,
} from '@rota/shared';
import { APP_CONFIG, AppConfig } from '../../config/configuration';
import { PrismaService } from '../../common/prisma.service';

export const SETTING_KEY = {
  ALERT_THRESHOLDS: 'alert.thresholds',
  TRACKING_POLICY: 'tracking.policy',
  OPERATIONS: 'operations.defaults',
} as const;

/**
 * Parametros operacionais sobreposiveis em `system_settings`.
 * O codigo NUNCA fixa limite operacional: le daqui, com fallback explicito.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async getThresholds(): Promise<AlertThresholds> {
    const stored = await this.prisma.systemSetting.findUnique({
      where: { key: SETTING_KEY.ALERT_THRESHOLDS },
    });
    const base: AlertThresholds = { ...DEFAULT_ALERT_THRESHOLDS };
    if (!stored) return base;
    const value = (stored.value ?? {}) as Partial<AlertThresholds>;
    return { ...base, ...pickNumbers(value) };
  }

  async getTrackingPolicy(): Promise<TrackingPolicy> {
    const stored = await this.prisma.systemSetting.findUnique({
      where: { key: SETTING_KEY.TRACKING_POLICY },
    });
    const base: TrackingPolicy = {
      ...DEFAULT_TRACKING_POLICY,
      locationRetentionDays: this.config.tracking.locationRetentionDays,
      aggregateRetentionDays: this.config.tracking.aggregateRetentionDays,
    };
    if (!stored) return base;
    return { ...base, ...(stored.value as Partial<TrackingPolicy>) };
  }

  async getOperationsDefaults(): Promise<{ defaultServiceSeconds: number }> {
    const stored = await this.prisma.systemSetting.findUnique({
      where: { key: SETTING_KEY.OPERATIONS },
    });
    const base = { defaultServiceSeconds: this.config.operations.defaultServiceSeconds };
    if (!stored) return base;
    return { ...base, ...(stored.value as Record<string, number>) };
  }

  async list() {
    return this.prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
  }

  async upsert(key: string, value: unknown, updatedById: string | null, description?: string) {
    if (!/^[a-z0-9_.-]{3,120}$/i.test(key)) {
      throw new NotFoundException(`Chave de configuracao invalida: ${key}`);
    }
    return this.prisma.systemSetting.upsert({
      where: { key },
      create: {
        key,
        value: value as Prisma.InputJsonValue,
        description: description ?? null,
        updatedById,
      },
      update: {
        value: value as Prisma.InputJsonValue,
        description: description ?? null,
        updatedById,
      },
    });
  }
}

function pickNumbers(source: Record<string, unknown>): Partial<AlertThresholds> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return out as Partial<AlertThresholds>;
}
