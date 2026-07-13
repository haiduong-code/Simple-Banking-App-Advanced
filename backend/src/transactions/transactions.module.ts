import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/entities/account.entity';
import { AuditModule } from '../audit/audit.module';
import { LedgerModule } from '../ledger/ledger.module';
import { Transaction } from './entities/transaction.entity';
import { TransactionStateService } from './transaction-state.service';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction, Account]),
    LedgerModule,
    AuditModule,
  ],
  controllers: [TransactionsController],
  providers: [TransactionsService, TransactionStateService],
})
export class TransactionsModule {}
