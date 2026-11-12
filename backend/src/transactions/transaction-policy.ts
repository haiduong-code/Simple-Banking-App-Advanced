import { BadRequestException } from '@nestjs/common';
import {
  Account,
  AccountStatus,
  AccountTier,
} from '../accounts/entities/account.entity';
import { MAX_MONEY_MINOR_UNITS, moneyToMinorUnits } from '../common/money';

export const OTP_THRESHOLD = 10_000_000n * 100n;
export const ACCOUNT_LIMITS = {
  [AccountTier.STANDARD]: {
    perTransaction: 20_000_000n * 100n,
    daily: 50_000_000n * 100n,
  },
  [AccountTier.VIP]: {
    perTransaction: 100_000_000n * 100n,
    daily: 200_000_000n * 100n,
  },
};

export function vietnamDayBounds(now = new Date()) {
  const offset = 7 * 60 * 60 * 1000;
  const local = new Date(now.getTime() + offset);
  const start = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) -
      offset,
  );
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

export function validateMovement(
  source: Account | null,
  destination: Account | null,
  amount: bigint,
  dailySpent = 0n,
) {
  if (amount <= 0n) throw new BadRequestException('Số tiền phải lớn hơn 0');
  for (const account of [source, destination]) {
    if (
      account &&
      (account.deletedAt ||
        (account.status && account.status !== AccountStatus.ACTIVE))
    ) {
      throw new BadRequestException(
        'Tài khoản phải ở trạng thái ACTIVE để giao dịch',
      );
    }
  }
  if (source && destination && source.currency !== destination.currency)
    throw new BadRequestException('Hai tài khoản phải cùng loại tiền tệ');
  if (source) {
    const limits = ACCOUNT_LIMITS[source.tier ?? AccountTier.STANDARD];
    if (amount > limits.perTransaction)
      throw new BadRequestException('Vượt hạn mức giao dịch một lần');
    if (dailySpent + amount > limits.daily)
      throw new BadRequestException(
        'Vượt hạn mức giao dịch trong ngày (giờ Việt Nam)',
      );
    if (
      moneyToMinorUnits(source.balance) -
        moneyToMinorUnits(source.holdAmount ?? '0.00') <
      amount
    )
      throw new BadRequestException('Số dư khả dụng không đủ');
  }
  if (
    destination &&
    moneyToMinorUnits(destination.balance) + amount > MAX_MONEY_MINOR_UNITS
  )
    throw new BadRequestException(
      'Số dư tài khoản đích vượt giới hạn cho phép',
    );
}
