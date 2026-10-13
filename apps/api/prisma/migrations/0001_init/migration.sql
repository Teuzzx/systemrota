-- Migracao inicial gerada por scripts/generate-migration.mjs
-- (prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma)
--
-- PostGIS e obrigatorio: as colunas geography(Point,4326) dependem dele.
-- Em Postgres gerenciado (Supabase, RDS, Cloud SQL) criar extensao exige
-- superusuario: habilite postgis e pg_trgm ANTES de rodar esta migracao.
-- Com as extensoes ja ativas, o IF NOT EXISTS vira no-op e nao exige privilegio.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateSchema

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'PENDING_ACTIVATION');

-- CreateEnum
CREATE TYPE "RoleKey" AS ENUM ('ADMINISTRADOR', 'SUPERVISOR', 'MOTORISTA');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('ATIVO', 'INATIVO', 'FERIAS');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ATIVO', 'INATIVO', 'PENDENTE_REVISAO');

-- CreateEnum
CREATE TYPE "GeocodeStatus" AS ENUM ('VALIDADO', 'PENDENTE', 'INVALIDO', 'AUSENTE');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'VALIDATING', 'VALIDATED', 'COMMITTED', 'FAILED', 'REVERTED');

-- CreateEnum
CREATE TYPE "ImportSeverity" AS ENUM ('ERRO', 'AVISO', 'INFO');

-- CreateEnum
CREATE TYPE "RouteStatus" AS ENUM ('PLANEJADA', 'ATRIBUIDA', 'PUBLICADA', 'EM_EXECUCAO', 'PAUSADA', 'CONCLUIDA', 'CANCELADA', 'ARQUIVADA');

-- CreateEnum
CREATE TYPE "JourneyStatus" AS ENUM ('EM_ANDAMENTO', 'PAUSADA', 'FINALIZADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('PLANEJADA', 'EM_DESLOCAMENTO', 'CHEGADA_REGISTRADA', 'EM_ATENDIMENTO', 'CONCLUIDA', 'NAO_REALIZADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "JourneyEventType" AS ENUM ('JOURNEY_STARTED', 'JOURNEY_PAUSED', 'JOURNEY_RESUMED', 'JOURNEY_FINISHED', 'JOURNEY_CANCELLED', 'VISIT_ARRIVED', 'VISIT_SERVICE_STARTED', 'VISIT_SERVICE_ENDED', 'VISIT_NOT_DONE', 'VISIT_CANCELLED', 'OCCURRENCE_LOGGED', 'ROUTE_VERSION_CONFLICT');

-- CreateEnum
CREATE TYPE "MeasurementQuality" AS ENUM ('EXATA', 'ESTIMADA', 'INCOMPLETA');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('GPS', 'MANUAL');

-- CreateEnum
CREATE TYPE "OccurrenceType" AS ENUM ('ESTABELECIMENTO_FECHADO', 'CLIENTE_INDISPONIVEL', 'ENDERECO_INCORRETO', 'PROBLEMA_DE_ACESSO', 'PROBLEMA_OPERACIONAL', 'OUTRO');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'AVISO', 'CRITICO');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('ABERTO', 'RECONHECIDO', 'RESOLVIDO', 'SILENCIADO');

-- CreateEnum
CREATE TYPE "AlertAction" AS ENUM ('CRIADO', 'ATUALIZADO', 'RECONHECIDO', 'RESOLVIDO', 'SILENCIADO', 'NOTIFICADO');

-- CreateEnum
CREATE TYPE "OptimizationStatus" AS ENUM ('EM_ANDAMENTO', 'CONCLUIDA', 'FALHOU');

-- CreateEnum
CREATE TYPE "OptimizationAlgorithm" AS ENUM ('NEAREST_NEIGHBOR_2OPT', 'MANUAL', 'IMPORTADO');

-- CreateEnum
CREATE TYPE "Connectivity" AS ENUM ('ONLINE', 'OFFLINE', 'DEGRADADO');

-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('GASOLINA', 'ETANOL', 'DIESEL', 'GNV', 'FLEX');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(180) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(32),
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_ACTIVATION',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "key" "RoleKey" NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "description" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "code" VARCHAR(40),
    "status" "DriverStatus" NOT NULL DEFAULT 'ATIVO',
    "homeCity" VARCHAR(120),
    "homeNeighborhood" VARCHAR(120),
    "homeLatitude" DOUBLE PRECISION,
    "homeLongitude" DOUBLE PRECISION,
    "licenseNumber" VARCHAR(60),
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "administrators" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "department" VARCHAR(120),
    "canManageSettings" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "administrators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supervisor_scopes" (
    "id" UUID NOT NULL,
    "supervisorId" UUID NOT NULL,
    "driverId" UUID,
    "city" VARCHAR(120),
    "neighborhood" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supervisor_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "familyId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" VARCHAR(255),
    "ip" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "plate" VARCHAR(16) NOT NULL,
    "model" VARCHAR(80),
    "year" INTEGER,
    "fuelType" "FuelType",
    "tankCapacityL" DOUBLE PRECISION,
    "avgConsumptionKmpl" DOUBLE PRECISION,
    "fuelCostPerLiter" DOUBLE PRECISION,
    "odometerKm" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_assignments" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endAt" TIMESTAMP(3),
    "odometerStartKm" DOUBLE PRECISION,
    "odometerEndKm" DOUBLE PRECISION,
    "notes" TEXT,

    CONSTRAINT "vehicle_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "externalId" VARCHAR(80),
    "sourceSystem" VARCHAR(40) NOT NULL DEFAULT 'MANUAL',
    "tradeName" VARCHAR(200) NOT NULL,
    "contactName" VARCHAR(160),
    "phone" VARCHAR(32),
    "email" VARCHAR(180),
    "addressLine" VARCHAR(255),
    "neighborhood" VARCHAR(120),
    "city" VARCHAR(120) NOT NULL,
    "state" CHAR(2) NOT NULL DEFAULT 'PI',
    "zipCode" VARCHAR(12),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "location" geography(Point, 4326),
    "geocodeStatus" "GeocodeStatus" NOT NULL DEFAULT 'AUSENTE',
    "status" "CustomerStatus" NOT NULL DEFAULT 'ATIVO',
    "notes" TEXT,
    "openingHours" VARCHAR(255),
    "defaultServiceS" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 5,
    "lastVisitAt" TIMESTAMP(3),
    "nextPlannedVisitAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "importBatchId" UUID,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_imports" (
    "id" UUID NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "fileChecksum" VARCHAR(128) NOT NULL,
    "format" VARCHAR(16) NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "mapping" JSONB,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "insertedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "uploadedById" UUID,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_import_errors" (
    "id" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "column" VARCHAR(120),
    "rawValue" TEXT,
    "message" VARCHAR(500) NOT NULL,
    "severity" "ImportSeverity" NOT NULL DEFAULT 'ERRO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_import_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "region" VARCHAR(160),
    "cities" TEXT[],
    "neighborhoods" TEXT[],
    "driverId" UUID,
    "plannedDate" DATE NOT NULL,
    "status" "RouteStatus" NOT NULL DEFAULT 'PLANEJADA',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "plannedStartAt" TIMESTAMP(3),
    "plannedEndAt" TIMESTAMP(3),
    "returnToBase" BOOLEAN NOT NULL DEFAULT false,
    "distanceEstimatedM" DOUBLE PRECISION,
    "durationEstimatedS" INTEGER,
    "serviceEstimatedS" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_versions" (
    "id" UUID NOT NULL,
    "routeId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "RouteStatus" NOT NULL,
    "totalDistanceM" DOUBLE PRECISION,
    "totalDurationS" INTEGER,
    "totalServiceS" INTEGER,
    "totalStops" INTEGER NOT NULL,
    "changeNote" TEXT,
    "diff" JSONB,
    "changedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_stops" (
    "id" UUID NOT NULL,
    "routeId" UUID NOT NULL,
    "routeVersionId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 5,
    "plannedArrivalAt" TIMESTAMP(3),
    "plannedDepartureAt" TIMESTAMP(3),
    "estTravelFromPrevS" INTEGER,
    "estDistanceFromPrevM" DOUBLE PRECISION,
    "estServiceS" INTEGER,
    "timeWindowStart" TIMESTAMP(3),
    "timeWindowEnd" TIMESTAMP(3),
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "note" VARCHAR(500),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "route_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journeys" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "routeId" UUID,
    "routeVersionId" UUID,
    "routeVersionAtStart" INTEGER,
    "status" "JourneyStatus" NOT NULL DEFAULT 'EM_ANDAMENTO',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "pauseTotalS" INTEGER NOT NULL DEFAULT 0,
    "travelTotalS" INTEGER NOT NULL DEFAULT 0,
    "serviceTotalS" INTEGER NOT NULL DEFAULT 0,
    "unclassifiedS" INTEGER NOT NULL DEFAULT 0,
    "distanceTraveledM" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gpsDistanceM" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "odometerStartKm" DOUBLE PRECISION,
    "odometerEndKm" DOUBLE PRECISION,
    "estimatedFuelL" DOUBLE PRECISION,
    "estimatedFuelCost" DOUBLE PRECISION,
    "stopsPlanned" INTEGER NOT NULL DEFAULT 0,
    "stopsConcluded" INTEGER NOT NULL DEFAULT 0,
    "stopsNotDone" INTEGER NOT NULL DEFAULT 0,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerId" UUID,

    CONSTRAINT "journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visits" (
    "id" UUID NOT NULL,
    "journeyId" UUID NOT NULL,
    "routeStopId" UUID,
    "customerId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "VisitStatus" NOT NULL DEFAULT 'PLANEJADA',
    "plannedArrivalAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "serviceStartedAt" TIMESTAMP(3),
    "serviceEndedAt" TIMESTAMP(3),
    "serviceDurationS" INTEGER,
    "waitDurationS" INTEGER,
    "travelDurationS" INTEGER,
    "travelQuality" "MeasurementQuality" NOT NULL DEFAULT 'INCOMPLETA',
    "distanceFromPrevM" DOUBLE PRECISION,
    "notDoneReason" VARCHAR(80),
    "notDoneNote" TEXT,
    "source" "EventSource" NOT NULL DEFAULT 'MANUAL',
    "manualJustification" TEXT,
    "confirmedByGeofence" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_events" (
    "id" UUID NOT NULL,
    "journeyId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "clientEventId" VARCHAR(80) NOT NULL,
    "sequenceNo" INTEGER NOT NULL,
    "type" "JourneyEventType" NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracyM" DOUBLE PRECISION,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "duplicateOfId" UUID,
    "rejected" BOOLEAN NOT NULL DEFAULT false,
    "rejectionReason" VARCHAR(255),

    CONSTRAINT "journey_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_points" (
    "id" UUID NOT NULL,
    "journeyId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "clientPointId" VARCHAR(80) NOT NULL,
    "sequenceNo" INTEGER NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "location" geography(Point, 4326),
    "accuracyM" DOUBLE PRECISION NOT NULL,
    "speedMps" DOUBLE PRECISION,
    "bearingDeg" DOUBLE PRECISION,
    "connectivity" "Connectivity" NOT NULL DEFAULT 'ONLINE',
    "batteryPct" INTEGER,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "retainedUntil" TIMESTAMP(3) NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "location_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_hour_aggregates" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "pointCount" INTEGER NOT NULL,
    "distanceM" DOUBLE PRECISION NOT NULL,
    "movingS" INTEGER NOT NULL,
    "stationaryS" INTEGER NOT NULL,
    "avgLatitude" DOUBLE PRECISION NOT NULL,
    "avgLongitude" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_hour_aggregates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "occurrences" (
    "id" UUID NOT NULL,
    "journeyId" UUID NOT NULL,
    "visitId" UUID,
    "driverId" UUID NOT NULL,
    "customerId" UUID,
    "type" "OccurrenceType" NOT NULL,
    "description" TEXT,
    "requiresFollowUp" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" UUID,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "ruleKey" VARCHAR(60) NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'AVISO',
    "status" "AlertStatus" NOT NULL DEFAULT 'ABERTO',
    "title" VARCHAR(200) NOT NULL,
    "message" VARCHAR(600) NOT NULL,
    "context" JSONB,
    "driverId" UUID,
    "journeyId" UUID,
    "routeId" UUID,
    "customerId" UUID,
    "dedupeKey" VARCHAR(160) NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" UUID,
    "silencedUntil" TIMESTAMP(3),

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_history" (
    "id" UUID NOT NULL,
    "alertId" UUID NOT NULL,
    "action" "AlertAction" NOT NULL,
    "actorId" UUID,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_optimization_runs" (
    "id" UUID NOT NULL,
    "routeId" UUID,
    "routeVersionId" UUID,
    "provider" VARCHAR(40) NOT NULL,
    "algorithm" "OptimizationAlgorithm" NOT NULL DEFAULT 'NEAREST_NEIGHBOR_2OPT',
    "status" "OptimizationStatus" NOT NULL DEFAULT 'EM_ANDAMENTO',
    "originLatitude" DOUBLE PRECISION,
    "originLongitude" DOUBLE PRECISION,
    "destinationLatitude" DOUBLE PRECISION,
    "destinationLongitude" DOUBLE PRECISION,
    "returnToBase" BOOLEAN NOT NULL DEFAULT false,
    "inputCount" INTEGER NOT NULL DEFAULT 0,
    "includedCount" INTEGER NOT NULL DEFAULT 0,
    "excludedCount" INTEGER NOT NULL DEFAULT 0,
    "totalDistanceM" DOUBLE PRECISION,
    "totalDurationS" INTEGER,
    "totalServiceS" INTEGER,
    "result" JSONB,
    "excluded" JSONB,
    "constraints" JSONB,
    "diffFromPrevious" JSONB,
    "confidenceNote" VARCHAR(500),
    "errorMessage" TEXT,
    "driverId" UUID,
    "requestedById" UUID,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "route_optimization_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "actorEmail" VARCHAR(180),
    "actorRole" VARCHAR(40),
    "action" VARCHAR(120) NOT NULL,
    "entity" VARCHAR(80) NOT NULL,
    "entityId" VARCHAR(120),
    "before" JSONB,
    "after" JSONB,
    "ip" VARCHAR(64),
    "userAgent" VARCHAR(255),
    "requestId" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" VARCHAR(120) NOT NULL,
    "value" JSONB NOT NULL,
    "description" VARCHAR(400),
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_userId_key" ON "drivers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_code_key" ON "drivers"("code");

-- CreateIndex
CREATE INDEX "drivers_status_idx" ON "drivers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "administrators_userId_key" ON "administrators"("userId");

-- CreateIndex
CREATE INDEX "supervisor_scopes_supervisorId_idx" ON "supervisor_scopes"("supervisorId");

-- CreateIndex
CREATE INDEX "supervisor_scopes_driverId_idx" ON "supervisor_scopes"("driverId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plate_key" ON "vehicles"("plate");

-- CreateIndex
CREATE INDEX "vehicle_assignments_driverId_startAt_idx" ON "vehicle_assignments"("driverId", "startAt");

-- CreateIndex
CREATE INDEX "vehicle_assignments_vehicleId_idx" ON "vehicle_assignments"("vehicleId");

-- CreateIndex
CREATE INDEX "customers_city_neighborhood_idx" ON "customers"("city", "neighborhood");

-- CreateIndex
CREATE INDEX "customers_status_idx" ON "customers"("status");

-- CreateIndex
CREATE INDEX "customers_geocodeStatus_idx" ON "customers"("geocodeStatus");

-- CreateIndex
CREATE INDEX "customers_tradeName_idx" ON "customers"("tradeName");

-- CreateIndex
CREATE INDEX "customers_lastVisitAt_idx" ON "customers"("lastVisitAt");

-- CreateIndex
CREATE UNIQUE INDEX "customers_sourceSystem_externalId_key" ON "customers"("sourceSystem", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_imports_idempotencyKey_key" ON "customer_imports"("idempotencyKey");

-- CreateIndex
CREATE INDEX "customer_imports_status_idx" ON "customer_imports"("status");

-- CreateIndex
CREATE INDEX "customer_imports_createdAt_idx" ON "customer_imports"("createdAt");

-- CreateIndex
CREATE INDEX "customer_import_errors_importId_severity_idx" ON "customer_import_errors"("importId", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "routes_code_key" ON "routes"("code");

-- CreateIndex
CREATE INDEX "routes_plannedDate_status_idx" ON "routes"("plannedDate", "status");

-- CreateIndex
CREATE INDEX "routes_driverId_plannedDate_idx" ON "routes"("driverId", "plannedDate");

-- CreateIndex
CREATE UNIQUE INDEX "route_versions_routeId_version_key" ON "route_versions"("routeId", "version");

-- CreateIndex
CREATE INDEX "route_stops_routeId_sequence_idx" ON "route_stops"("routeId", "sequence");

-- CreateIndex
CREATE INDEX "route_stops_customerId_idx" ON "route_stops"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "route_stops_routeVersionId_sequence_key" ON "route_stops"("routeVersionId", "sequence");

-- CreateIndex
CREATE INDEX "journeys_driverId_startedAt_idx" ON "journeys"("driverId", "startedAt");

-- CreateIndex
CREATE INDEX "journeys_status_startedAt_idx" ON "journeys"("status", "startedAt");

-- CreateIndex
CREATE INDEX "journeys_routeId_idx" ON "journeys"("routeId");

-- CreateIndex
CREATE INDEX "visits_customerId_arrivedAt_idx" ON "visits"("customerId", "arrivedAt");

-- CreateIndex
CREATE INDEX "visits_driverId_status_idx" ON "visits"("driverId", "status");

-- CreateIndex
CREATE INDEX "visits_journeyId_status_idx" ON "visits"("journeyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "visits_journeyId_sequence_key" ON "visits"("journeyId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "journey_events_clientEventId_key" ON "journey_events"("clientEventId");

-- CreateIndex
CREATE INDEX "journey_events_journeyId_capturedAt_idx" ON "journey_events"("journeyId", "capturedAt");

-- CreateIndex
CREATE INDEX "journey_events_driverId_capturedAt_idx" ON "journey_events"("driverId", "capturedAt");

-- CreateIndex
CREATE INDEX "journey_events_type_idx" ON "journey_events"("type");

-- CreateIndex
CREATE UNIQUE INDEX "location_points_clientPointId_key" ON "location_points"("clientPointId");

-- CreateIndex
CREATE INDEX "location_points_journeyId_capturedAt_idx" ON "location_points"("journeyId", "capturedAt");

-- CreateIndex
CREATE INDEX "location_points_driverId_capturedAt_idx" ON "location_points"("driverId", "capturedAt");

-- CreateIndex
CREATE INDEX "location_points_retainedUntil_idx" ON "location_points"("retainedUntil");

-- CreateIndex
CREATE INDEX "location_hour_aggregates_bucketStart_idx" ON "location_hour_aggregates"("bucketStart");

-- CreateIndex
CREATE UNIQUE INDEX "location_hour_aggregates_driverId_bucketStart_key" ON "location_hour_aggregates"("driverId", "bucketStart");

-- CreateIndex
CREATE INDEX "occurrences_journeyId_idx" ON "occurrences"("journeyId");

-- CreateIndex
CREATE INDEX "occurrences_requiresFollowUp_resolvedAt_idx" ON "occurrences"("requiresFollowUp", "resolvedAt");

-- CreateIndex
CREATE INDEX "alerts_status_severity_idx" ON "alerts"("status", "severity");

-- CreateIndex
CREATE INDEX "alerts_firstSeenAt_idx" ON "alerts"("firstSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_dedupeKey_key" ON "alerts"("dedupeKey");

-- CreateIndex
CREATE INDEX "alert_history_alertId_createdAt_idx" ON "alert_history"("alertId", "createdAt");

-- CreateIndex
CREATE INDEX "route_optimization_runs_routeId_startedAt_idx" ON "route_optimization_runs"("routeId", "startedAt");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administrators" ADD CONSTRAINT "administrators_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supervisor_scopes" ADD CONSTRAINT "supervisor_scopes_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supervisor_scopes" ADD CONSTRAINT "supervisor_scopes_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_assignments" ADD CONSTRAINT "vehicle_assignments_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_assignments" ADD CONSTRAINT "vehicle_assignments_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "customer_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_import_errors" ADD CONSTRAINT "customer_import_errors_importId_fkey" FOREIGN KEY ("importId") REFERENCES "customer_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_versions" ADD CONSTRAINT "route_versions_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_routeVersionId_fkey" FOREIGN KEY ("routeVersionId") REFERENCES "route_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_routeStopId_fkey" FOREIGN KEY ("routeStopId") REFERENCES "route_stops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_events" ADD CONSTRAINT "journey_events_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_points" ADD CONSTRAINT "location_points_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_points" ADD CONSTRAINT "location_points_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_history" ADD CONSTRAINT "alert_history_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_optimization_runs" ADD CONSTRAINT "route_optimization_runs_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_optimization_runs" ADD CONSTRAINT "route_optimization_runs_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- ====================== INDICES ESPACIAIS (GiST) ======================
CREATE INDEX "customers_location_gist" ON "customers" USING GIST ("location");
CREATE INDEX "location_points_location_gist" ON "location_points" USING GIST ("location");

-- ====================== REGRAS NO BANCO ================================
-- Regra de negocio no banco: um motorista nao pode ter duas jornadas
-- simultaneas. Complementa a validacao da aplicacao e protege contra
-- corrida entre dois dispositivos do mesmo motorista.
CREATE UNIQUE INDEX "journeys_one_active_per_driver"
  ON "journeys" ("driverId")
  WHERE "status" IN ('EM_ANDAMENTO', 'PAUSADA');

-- Busca textual de clientes por nome (trigram).
CREATE INDEX "customers_trade_name_trgm"
  ON "customers" USING GIN ("tradeName" gin_trgm_ops);
