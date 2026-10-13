import { PrismaClient } from '@prisma/client';
import { Permission, ROLE_PERMISSIONS, RoleKey } from '@rota/shared';
import { SETTING_KEY } from '../modules/settings/settings.service';

/**
 * Carga base: perfis, permissoes e parametros operacionais.
 * Idempotente: pode rodar em qualquer ordem sem duplicar nada.
 */
export async function seedCore(prisma: PrismaClient): Promise<void> {
  for (const key of Object.values(RoleKey)) {
    await prisma.role.upsert({
      where: { key },
      create: {
        key,
        name: key.charAt(0) + key.slice(1).toLowerCase(),
        description: `Perfil ${key}`,
      },
      update: {},
    });
  }

  const allPermissions = [...new Set(Object.values(Permission))];
  for (const key of allPermissions) {
    await prisma.permission.upsert({
      where: { key },
      create: { key, description: key },
      update: {},
    });
  }

  for (const roleKey of Object.values(RoleKey)) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    const permissions = ROLE_PERMISSIONS[roleKey];
    const records = await prisma.permission.findMany({
      where: { key: { in: permissions } },
      select: { id: true },
    });
    for (const permission of records) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        create: { roleId: role.id, permissionId: permission.id },
        update: {},
      });
    }
  }

  const defaults: Array<[string, unknown, string]> = [
    [
      SETTING_KEY.ALERT_THRESHOLDS,
      {
        locationStaleS: 300,
        visitLateToleranceS: 900,
        journeyMaxS: 12 * 3600,
        prolongedStopS: 30 * 60,
        routeExpectedProgressPct: 40,
        syncPendingS: 1800,
        journeyNotClosedS: 14 * 3600,
        dedupeWindowS: 900,
      },
      'Limites dos alertas automaticos. Ajustaveis pelo painel.',
    ],
    [
      SETTING_KEY.TRACKING_POLICY,
      {
        movingIntervalS: 15,
        stationaryIntervalS: 60,
        maxAcceptableAccuracyM: 100,
        locationRetentionDays: 90,
        aggregateRetentionDays: 730,
        onlyDuringJourney: true,
      },
      'Politica de rastreamento e retencao de localizacao.',
    ],
    [
      SETTING_KEY.OPERATIONS,
      { defaultServiceSeconds: 900 },
      'Padroes operacionais (tempo medio de atendimento).',
    ],
  ];

  for (const [key, value, description] of defaults) {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: value as never, description },
      update: {},
    });
  }
}
