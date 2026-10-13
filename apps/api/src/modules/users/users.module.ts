import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { SettingsController, UsersController } from '../admin.controllers';
import { UsersService } from './users.service';

@Module({
  imports: [SettingsModule],
  controllers: [UsersController, SettingsController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
