import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TransactionStateService } from '../transactions/transaction-state.service';
import { MonitoringService } from './monitoring.service';
import {
  HealthController,
  MonitoringController,
} from './monitoring.controller';
@Module({
  imports: [AuditModule],
  controllers: [HealthController, MonitoringController],
  providers: [MonitoringService, TransactionStateService],
})
export class MonitoringModule {}
