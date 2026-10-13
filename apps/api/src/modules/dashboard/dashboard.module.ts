import { Module } from '@nestjs/common';
import { LocationsModule } from '../locations/locations.module';
import { DashboardController } from '../operations.controllers';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [LocationsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
