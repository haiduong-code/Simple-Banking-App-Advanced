import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/entities/account.entity';
import { AuditModule } from '../audit/audit.module';
import { LedgerModule } from '../ledger/ledger.module';
import { Transaction } from './entities/transaction.entity';
import { TransactionStateService } from './transaction-state.service';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { BankingOperationsService } from './banking-operations.service';
import { OtpDeliveryService } from './otp-delivery.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction, Account]),
    LedgerModule,
    AuditModule,
  ],
  controllers: [TransactionsController],
  providers: [
    TransactionsService,
    TransactionStateService,
    BankingOperationsService,
    OtpDeliveryService,
  ],
})
export class TransactionsModule {}
