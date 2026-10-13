import { Module } from '@nestjs/common';
import { RoutingModule } from '../routing/routing.module';
import { RoutesModule } from '../routes/routes.module';
import { OptimizationController } from '../operations.controllers';
import { OptimizationService } from './optimization.service';

@Module({
  imports: [RoutingModule, RoutesModule],
  controllers: [OptimizationController],
  providers: [OptimizationService],
  exports: [OptimizationService],
})
export class OptimizationModule {}
