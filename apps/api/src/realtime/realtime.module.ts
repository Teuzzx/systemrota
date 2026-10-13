import { Module } from '@nestjs/common';
import { AlertsModule } from '../modules/alerts/alerts.module';
import { DashboardModule } from '../modules/dashboard/dashboard.module';
import { LocationsModule } from '../modules/locations/locations.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [LocationsModule, DashboardModule, AlertsModule],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
