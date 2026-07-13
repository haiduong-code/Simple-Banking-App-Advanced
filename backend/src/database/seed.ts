import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import { AppModule } from '../app.module';
import { moneyToMinorUnits, normalizeMoney } from '../common/money';
import { LedgerEntryType } from '../ledger/entities/ledger-entry.entity';
import { LedgerService } from '../ledger/ledger.service';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../transactions/entities/transaction.entity';
import { User, UserRole, UserStatus } from '../users/entities/user.entity';

const BCRYPT_SALT_ROUNDS = 10;
const SEED_PASSWORD = 'Test@123';

interface SeedUser {
  fullName: string;
  email: string;
  accountNumber: string;
  balance: string;
  role?: UserRole;
}

const SEED_USERS: SeedUser[] = [
  {
    fullName: 'Admin Banking',
    email: 'admin@bank.test',
    accountNumber: '9000000000',
    balance: '0.00',
    role: UserRole.ADMIN,
  },
  {
    fullName: 'Nguyễn Văn An',
    email: 'an@bank.test',
    accountNumber: '9000000001',
    balance: '10000000.00',
  },
  {
    fullName: 'Trần Thị Bình',
    email: 'binh@bank.test',
    accountNumber: '9000000002',
    balance: '5000000.00',
  },
  {
    fullName: 'Lê Minh Chi',
    email: 'chi@bank.test',
    accountNumber: '9000000003',
    balance: '0.00',
  },
];

function deterministicUuid(input: string): string {
  const hex = createHash('sha256').update(input).digest('hex').slice(0, 32);
  const chars = hex.split('');
  chars[12] = '4';
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);

  return [
    chars.slice(0, 8).join(''),
    chars.slice(8, 12).join(''),
    chars.slice(12, 16).join(''),
    chars.slice(16, 20).join(''),
    chars.slice(20, 32).join(''),
  ].join('-');
}

async function ensureOpeningBalanceLedger(
  manager: EntityManager,
  ledgerService: LedgerService,
  account: Account,
  balance: string,
): Promise<void> {
  const normalizedBalance = normalizeMoney(balance);
  if (moneyToMinorUnits(normalizedBalance) <= 0n) {
    return;
  }

  const transactionRepository = manager.getRepository(Transaction);

  let openingTransaction = await transactionRepository.findOne({
    where: {
      type: TransactionType.OPENING_BALANCE,
      toAccountId: account.id,
    },
  });

  if (!openingTransaction) {
    openingTransaction = await transactionRepository.save(
      transactionRepository.create({
        fromAccountId: null,
        toAccountId: account.id,
        amount: normalizedBalance,
        idempotencyKey: deterministicUuid(`opening_balance:${account.id}`),
        type: TransactionType.OPENING_BALANCE,
        status: TransactionStatus.COMPLETED,
        completedAt: new Date(),
        description: 'Seed opening balance',
      }),
    );
  }

  const existingOpeningEntry = await ledgerService.hasEntry(
    {
      accountId: account.id,
      transactionId: openingTransaction.id,
      type: LedgerEntryType.CREDIT,
    },
    manager,
  );
  if (existingOpeningEntry) {
    return;
  }

  await ledgerService.createEntry(
    {
      accountId: account.id,
      transactionId: openingTransaction.id,
      type: LedgerEntryType.CREDIT,
      amount: normalizedBalance,
      balanceAfter: normalizedBalance,
    },
    manager,
  );
}

async function upsertSeedUser(
  manager: EntityManager,
  ledgerService: LedgerService,
  seedUser: SeedUser,
  passwordHash: string,
): Promise<void> {
  const userRepository = manager.getRepository(User);
  const accountRepository = manager.getRepository(Account);

  let user = await userRepository.findOne({
    where: { email: seedUser.email },
    withDeleted: true,
  });

  if (!user) {
    user = userRepository.create({
      fullName: seedUser.fullName,
      email: seedUser.email,
      passwordHash,
      role: seedUser.role ?? UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
    });
  } else {
    user.fullName = seedUser.fullName;
    user.passwordHash = passwordHash;
    user.role = seedUser.role ?? UserRole.CUSTOMER;
    user.status = UserStatus.ACTIVE;
    user.deletedAt = null;
  }
  user = await userRepository.save(user);

  const accountNumberOwner = await accountRepository.findOne({
    where: { accountNumber: seedUser.accountNumber },
    withDeleted: true,
  });
  if (accountNumberOwner && accountNumberOwner.userId !== user.id) {
    throw new Error(
      `Số tài khoản seed ${seedUser.accountNumber} đã thuộc về user khác`,
    );
  }

  let account = await accountRepository.findOne({
    where: { userId: user.id },
    withDeleted: true,
  });
  if (!account) {
    account = accountRepository.create({
      userId: user.id,
      accountNumber: seedUser.accountNumber,
      balance: seedUser.balance,
      currency: 'VND',
    });
  } else {
    const hasLedgerEntries = await ledgerService.hasEntriesForAccount(
      account.id,
      manager,
    );
    account.accountNumber = seedUser.accountNumber;
    account.deletedAt = null;
    if (!hasLedgerEntries) {
      account.balance = seedUser.balance;
    }
    account.currency = 'VND';
  }
  account = await accountRepository.save(account);

  await ensureOpeningBalanceLedger(
    manager,
    ledgerService,
    account,
    seedUser.balance,
  );
}

async function seed(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const dataSource = app.get(DataSource);
    const ledgerService = app.get(LedgerService);
    const passwordHash = await bcrypt.hash(SEED_PASSWORD, BCRYPT_SALT_ROUNDS);

    await dataSource.transaction(async (manager) => {
      for (const seedUser of SEED_USERS) {
        await upsertSeedUser(manager, ledgerService, seedUser, passwordHash);
      }
    });

    console.log('\nSeed dữ liệu test chuyển khoản thành công.');
    console.log(`Mật khẩu chung: ${SEED_PASSWORD}`);
    console.table(
      SEED_USERS.map(({ fullName, email, accountNumber, balance, role }) => ({
        fullName,
        email,
        role: role ?? UserRole.CUSTOMER,
        accountNumber,
        balance: `${balance} VND`,
      })),
    );
  } finally {
    await app.close();
  }
}

void seed().catch((error: unknown) => {
  console.error('Seed dữ liệu thất bại:', error);
  process.exitCode = 1;
});
