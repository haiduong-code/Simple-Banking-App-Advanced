import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AccountsService } from './accounts.service';
import { AccountHistory } from './entities/account-history.entity';
import { Account } from './entities/account.entity';
import { AccountsController } from './accounts.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Account, AccountHistory]), AuditModule],
  controllers: [AccountsController],
  providers: [AccountsService, RolesGuard],
  exports: [AccountsService],
})
export class AccountsModule {}
