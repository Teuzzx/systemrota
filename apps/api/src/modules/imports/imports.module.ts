import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { ImportsController } from '../admin.controllers';
import { ImportsService } from './imports.service';

@Module({
  imports: [CustomersModule],
  controllers: [ImportsController],
  providers: [ImportsService],
  exports: [ImportsService],
})
export class ImportsModule {}
