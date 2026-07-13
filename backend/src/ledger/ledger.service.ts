import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import {
  MAX_MONEY_MINOR_UNITS,
  minorUnitsToMoney,
  moneyToMinorUnits,
  normalizeMoney,
} from '../common/money';
import { Transaction } from '../transactions/entities/transaction.entity';
import { LedgerEntry, LedgerEntryType } from './entities/ledger-entry.entity';

export interface CreateLedgerEntryParams {
  accountId: string;
  transactionId: string;
  type: LedgerEntryType;
  amount: string;
  balanceAfter: string;
}

export interface FindLedgerEntryParams {
  accountId: string;
  transactionId: string;
  type: LedgerEntryType;
}

export interface RecordTransferParams {
  transaction: Transaction;
  sourceAccount: Account;
  destinationAccount: Account;
  amount: string;
  sourceBalanceBefore: string;
  destinationBalanceBefore: string;
}

export interface RecordReversalParams {
  transaction: Transaction;
  originalSourceAccount: Account;
  originalDestinationAccount: Account;
  amount: string;
  originalSourceBalanceBefore: string;
  originalDestinationBalanceBefore: string;
}

@Injectable()
export class LedgerService {
  constructor(
    @InjectRepository(LedgerEntry)
    private readonly ledgerEntryRepo: Repository<LedgerEntry>,
  ) {}

  private getLedgerEntryRepository(
    manager?: EntityManager,
  ): Repository<LedgerEntry> {
    return manager?.getRepository(LedgerEntry) ?? this.ledgerEntryRepo;
  }

  async getAccountLedgerBalance(
    accountId: string,
    manager?: EntityManager,
  ): Promise<string> {
    const repository = this.getLedgerEntryRepository(manager);
    const totals = await repository
      .createQueryBuilder('entry')
      .select(
        'COALESCE(SUM(CASE WHEN entry.type = :creditType THEN entry.amount ELSE 0 END), 0)',
        'creditTotal',
      )
      .addSelect(
        'COALESCE(SUM(CASE WHEN entry.type = :debitType THEN entry.amount ELSE 0 END), 0)',
        'debitTotal',
      )
      .where('entry.accountId = :accountId', { accountId })
      .setParameters({
        creditType: LedgerEntryType.CREDIT,
        debitType: LedgerEntryType.DEBIT,
      })
      .getRawOne<{ creditTotal: string; debitTotal: string }>();

    const creditTotal = moneyToMinorUnits(totals?.creditTotal ?? '0');
    const debitTotal = moneyToMinorUnits(totals?.debitTotal ?? '0');

    return minorUnitsToMoney(creditTotal - debitTotal);
  }

  async hasEntriesForAccount(
    accountId: string,
    manager?: EntityManager,
  ): Promise<boolean> {
    const repository = this.getLedgerEntryRepository(manager);
    const count = await repository.count({ where: { accountId } });

    return count > 0;
  }

  async hasEntry(
    params: FindLedgerEntryParams,
    manager?: EntityManager,
  ): Promise<boolean> {
    const repository = this.getLedgerEntryRepository(manager);
    const count = await repository.count({ where: params });

    return count > 0;
  }

  async createEntry(
    params: CreateLedgerEntryParams,
    manager: EntityManager,
  ): Promise<LedgerEntry> {
    const amount = normalizeMoney(params.amount);
    if (moneyToMinorUnits(amount) <= 0n) {
      throw new BadRequestException('Số tiền bút toán phải lớn hơn 0');
    }

    const balanceAfter = normalizeMoney(params.balanceAfter);
    const repository = this.getLedgerEntryRepository(manager);
    const entry = repository.create({
      accountId: params.accountId,
      transactionId: params.transactionId,
      type: params.type,
      amount,
      balanceAfter,
    });

    return repository.save(entry);
  }

  async recordTransfer(
    params: RecordTransferParams,
    manager: EntityManager,
  ): Promise<{ debitEntry: LedgerEntry; creditEntry: LedgerEntry }> {
    if (!params.transaction.id) {
      throw new Error('Transaction must be saved before recording ledger');
    }
    if (params.sourceAccount.id === params.destinationAccount.id) {
      throw new BadRequestException(
        'Không thể ghi sổ chuyển khoản cùng account',
      );
    }

    const amount = normalizeMoney(params.amount);
    const amountMinor = moneyToMinorUnits(amount);
    if (amountMinor <= 0n) {
      throw new BadRequestException('Số tiền chuyển khoản phải lớn hơn 0');
    }

    const sourceBalanceBefore = moneyToMinorUnits(
      normalizeMoney(params.sourceBalanceBefore),
    );
    const destinationBalanceBefore = moneyToMinorUnits(
      normalizeMoney(params.destinationBalanceBefore),
    );

    if (sourceBalanceBefore < amountMinor) {
      throw new BadRequestException('Số dư tài khoản nguồn không đủ');
    }

    const sourceBalanceAfter = sourceBalanceBefore - amountMinor;
    const destinationBalanceAfter = destinationBalanceBefore + amountMinor;
    if (destinationBalanceAfter > MAX_MONEY_MINOR_UNITS) {
      throw new UnprocessableEntityException(
        'Số dư tài khoản đích vượt giới hạn cho phép',
      );
    }

    const sourceBalanceAfterMoney = minorUnitsToMoney(sourceBalanceAfter);
    const destinationBalanceAfterMoney = minorUnitsToMoney(
      destinationBalanceAfter,
    );

    params.sourceAccount.balance = sourceBalanceAfterMoney;
    params.destinationAccount.balance = destinationBalanceAfterMoney;
    await manager
      .getRepository(Account)
      .save([params.sourceAccount, params.destinationAccount]);

    const debitEntry = await this.createEntry(
      {
        accountId: params.sourceAccount.id,
        transactionId: params.transaction.id,
        type: LedgerEntryType.DEBIT,
        amount,
        balanceAfter: sourceBalanceAfterMoney,
      },
      manager,
    );
    const creditEntry = await this.createEntry(
      {
        accountId: params.destinationAccount.id,
        transactionId: params.transaction.id,
        type: LedgerEntryType.CREDIT,
        amount,
        balanceAfter: destinationBalanceAfterMoney,
      },
      manager,
    );

    if (
      moneyToMinorUnits(debitEntry.amount) !==
      moneyToMinorUnits(creditEntry.amount)
    ) {
      throw new Error('Transfer ledger debit and credit totals do not match');
    }

    return { debitEntry, creditEntry };
  }

  async recordReversal(
    params: RecordReversalParams,
    manager: EntityManager,
  ): Promise<{ debitEntry: LedgerEntry; creditEntry: LedgerEntry }> {
    if (!params.transaction.id) {
      throw new Error('Transaction must be saved before recording ledger');
    }
    if (
      params.originalSourceAccount.id === params.originalDestinationAccount.id
    ) {
      throw new BadRequestException('Không thể ghi sổ reversal cùng account');
    }

    const amount = normalizeMoney(params.amount);
    const amountMinor = moneyToMinorUnits(amount);
    if (amountMinor <= 0n) {
      throw new BadRequestException('Số tiền reversal phải lớn hơn 0');
    }

    const originalSourceBalanceBefore = moneyToMinorUnits(
      normalizeMoney(params.originalSourceBalanceBefore),
    );
    const originalDestinationBalanceBefore = moneyToMinorUnits(
      normalizeMoney(params.originalDestinationBalanceBefore),
    );

    if (originalDestinationBalanceBefore < amountMinor) {
      throw new BadRequestException(
        'Tài khoản nhận tiền ban đầu không đủ số dư để hoàn tiền',
      );
    }

    const originalDestinationBalanceAfter =
      originalDestinationBalanceBefore - amountMinor;
    const originalSourceBalanceAfter =
      originalSourceBalanceBefore + amountMinor;
    if (originalSourceBalanceAfter > MAX_MONEY_MINOR_UNITS) {
      throw new UnprocessableEntityException(
        'Số dư tài khoản gửi ban đầu vượt giới hạn cho phép',
      );
    }

    const originalDestinationBalanceAfterMoney = minorUnitsToMoney(
      originalDestinationBalanceAfter,
    );
    const originalSourceBalanceAfterMoney = minorUnitsToMoney(
      originalSourceBalanceAfter,
    );

    params.originalDestinationAccount.balance =
      originalDestinationBalanceAfterMoney;
    params.originalSourceAccount.balance = originalSourceBalanceAfterMoney;
    await manager
      .getRepository(Account)
      .save([params.originalDestinationAccount, params.originalSourceAccount]);

    const debitEntry = await this.createEntry(
      {
        accountId: params.originalDestinationAccount.id,
        transactionId: params.transaction.id,
        type: LedgerEntryType.DEBIT,
        amount,
        balanceAfter: originalDestinationBalanceAfterMoney,
      },
      manager,
    );
    const creditEntry = await this.createEntry(
      {
        accountId: params.originalSourceAccount.id,
        transactionId: params.transaction.id,
        type: LedgerEntryType.CREDIT,
        amount,
        balanceAfter: originalSourceBalanceAfterMoney,
      },
      manager,
    );

    if (
      moneyToMinorUnits(debitEntry.amount) !==
      moneyToMinorUnits(creditEntry.amount)
    ) {
      throw new Error('Reversal ledger debit and credit totals do not match');
    }

    return { debitEntry, creditEntry };
  }
}
