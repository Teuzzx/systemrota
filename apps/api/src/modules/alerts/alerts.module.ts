import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { AlertsController } from '../operations.controllers';
import { AlertsService } from './alerts.service';

@Module({
  imports: [SettingsModule],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
