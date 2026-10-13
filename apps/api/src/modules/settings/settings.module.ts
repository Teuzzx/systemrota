import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';

// Os endpoints de configuracao sao expostos por SettingsController (ver
// ../admin.controllers), registrado em UsersModule. Aqui so o servico.
@Module({
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
