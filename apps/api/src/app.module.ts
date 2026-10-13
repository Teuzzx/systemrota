import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig, loadConfig } from './config/configuration';
import { PrismaService } from './common/prisma.service';
import { AuditService } from './common/audit.service';
import { AuthModule } from './auth/auth.module';
import { SettingsModule } from './modules/settings/settings.module';
import { RoutingModule } from './modules/routing/routing.module';
import { CustomersModule } from './modules/customers/customers.module';
import { ImportsModule } from './modules/imports/imports.module';
import { RoutesModule } from './modules/routes/routes.module';
import { OptimizationModule } from './modules/optimization/optimization.module';
import { JourneysModule } from './modules/journeys/journeys.module';
import { LocationsModule } from './modules/locations/locations.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ReportsModule } from './modules/reports/reports.module';
import { UsersModule } from './modules/users/users.module';
import { RealtimeModule } from './realtime/realtime.module';

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: (): AppConfig => loadConfig() },
    PrismaService,
    AuditService,
  ],
  exports: [APP_CONFIG, PrismaService, AuditService],
})
export class CoreModule {}

@Module({
  imports: [
    CoreModule,
    AuthModule,
    SettingsModule,
    RoutingModule,
    CustomersModule,
    ImportsModule,
    RoutesModule,
    OptimizationModule,
    JourneysModule,
    LocationsModule,
    AlertsModule,
    DashboardModule,
    ReportsModule,
    UsersModule,
    RealtimeModule,
  ],
})
export class AppModule {}
