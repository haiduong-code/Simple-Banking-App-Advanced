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
import { OptimisticConflict } from '../common/transaction-retry';
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
  optimistic?: boolean;
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
        'COALESCE(SUM(CASE WHEN entry.type = :creditType THEN entry.amount ELSE -entry.amount END), 0)',
        'balance',
      )
      .where('entry.accountId = :accountId', { accountId })
      .setParameters({
        creditType: LedgerEntryType.CREDIT,
      })
      .getRawOne<{ balance: string }>();
    return normalizeMoney(totals?.balance ?? '0');
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

    if (
      sourceBalanceBefore -
        moneyToMinorUnits(params.sourceAccount.holdAmount ?? '0.00') <
      amountMinor
    ) {
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
    await this.saveBalances(
      [params.sourceAccount, params.destinationAccount],
      manager,
      params.optimistic,
    );

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

  async saveBalances(
    accounts: Account[],
    manager: EntityManager,
    optimistic = false,
  ) {
    const repository = manager.getRepository(Account);
    if (!optimistic) {
      await repository.save(accounts);
      return;
    }
    for (const account of [...accounts].sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      const result = await repository
        .createQueryBuilder()
        .update(Account)
        .set({ balance: account.balance, version: () => 'version + 1' })
        .where('id = :id AND version = :version AND deleted_at IS NULL', {
          id: account.id,
          version: account.version,
        })
        .execute();
      if (result.affected !== 1)
        throw new OptimisticConflict('Account version changed');
      account.version++;
    }
  }

  async recordCash(
    account: Account,
    transaction: Transaction,
    credit: boolean,
    manager: EntityManager,
    optimistic = false,
  ) {
    const amount = moneyToMinorUnits(transaction.amount);
    if (amount <= 0n) throw new BadRequestException('Số tiền phải lớn hơn 0');
    const balance = moneyToMinorUnits(account.balance);
    if (
      !credit &&
      balance - moneyToMinorUnits(account.holdAmount ?? '0.00') < amount
    )
      throw new BadRequestException('Số dư không đủ');
    account.balance = minorUnitsToMoney(
      credit ? balance + amount : balance - amount,
    );
    await this.saveBalances([account], manager, optimistic);
    return this.createEntry(
      {
        accountId: account.id,
        transactionId: transaction.id,
        type: credit ? LedgerEntryType.CREDIT : LedgerEntryType.DEBIT,
        amount: transaction.amount,
        balanceAfter: account.balance,
      },
      manager,
    );
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

    if (
      originalDestinationBalanceBefore -
        moneyToMinorUnits(
          params.originalDestinationAccount.holdAmount ?? '0.00',
        ) <
      amountMinor
    ) {
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
