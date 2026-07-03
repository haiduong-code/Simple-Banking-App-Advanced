import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, In, Repository } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import {
  MAX_MONEY_MINOR_UNITS,
  minorUnitsToMoney,
  moneyToMinorUnits,
  normalizeMoney,
} from '../common/money';
import { User, UserStatus } from '../users/entities/user.entity';
import {
  TransactionDirection,
  TransactionQueryDto,
} from './dto/transaction-query.dto';
import { TransferDto } from './dto/transfer.dto';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from './entities/transaction.entity';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Transaction)
    private readonly transactionRepo: Repository<Transaction>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
  ) {}

  async transfer(userId: string, dto: TransferDto, idempotencyKey: string) {
    const normalizedAmount = normalizeMoney(dto.amount);
    const description = dto.description?.trim() || null;

    const previous = await this.findByIdempotencyKey(idempotencyKey);
    if (previous) {
      this.assertSameRequest(
        previous,
        userId,
        dto.toAccountNumber,
        normalizedAmount,
        description,
      );
      return this.toTransferResult(previous);
    }

    return this.dataSource.transaction('READ COMMITTED', async (manager) => {
      const accounts = manager.getRepository(Account);
      const transactions = manager.getRepository(Transaction);
      const users = manager.getRepository(User);

      const sourceCandidate = await accounts.findOne({ where: { userId } });
      if (!sourceCandidate) {
        throw new NotFoundException('Người dùng chưa có tài khoản nguồn');
      }

      const destinationCandidate = await accounts.findOne({
        where: { accountNumber: dto.toAccountNumber },
      });
      if (!destinationCandidate) {
        throw new NotFoundException('Tài khoản đích không tồn tại');
      }
      if (sourceCandidate.id === destinationCandidate.id) {
        throw new BadRequestException('Không thể chuyển tiền cho chính mình');
      }

      // Khóa theo cùng một thứ tự ID để hai giao dịch ngược chiều không deadlock.
      const lockedAccounts = await accounts.find({
        where: { id: In([sourceCandidate.id, destinationCandidate.id]) },
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });
      const source = lockedAccounts.find(
        (account) => account.id === sourceCandidate.id,
      );
      const destination = lockedAccounts.find(
        (account) => account.id === destinationCandidate.id,
      );
      if (!source || !destination) {
        throw new NotFoundException('Tài khoản không còn tồn tại');
      }

      // Request đồng thời cùng key sẽ chờ lock rồi nhìn thấy giao dịch đầu tiên.
      const duplicate = await transactions.findOne({
        where: { idempotencyKey },
        relations: { fromAccount: true, toAccount: true },
      });
      if (duplicate) {
        this.assertSameRequest(
          duplicate,
          userId,
          dto.toAccountNumber,
          normalizedAmount,
          description,
        );
        return this.toTransferResult(duplicate);
      }

      const destinationOwner = await users.findOne({
        where: { id: destination.userId },
      });
      if (!destinationOwner || destinationOwner.status !== UserStatus.ACTIVE) {
        throw new BadRequestException('Tài khoản đích đang bị khóa');
      }

      const amount = moneyToMinorUnits(normalizedAmount);
      if (amount <= 0n) {
        throw new BadRequestException('Số tiền phải lớn hơn 0');
      }

      const sourceBalance = moneyToMinorUnits(source.balance);
      const destinationBalance = moneyToMinorUnits(destination.balance);
      if (sourceBalance < amount) {
        throw new BadRequestException('Số dư không đủ');
      }
      if (destinationBalance + amount > MAX_MONEY_MINOR_UNITS) {
        throw new UnprocessableEntityException(
          'Số dư tài khoản đích vượt giới hạn cho phép',
        );
      }

      source.balance = minorUnitsToMoney(sourceBalance - amount);
      destination.balance = minorUnitsToMoney(destinationBalance + amount);
      await accounts.save([source, destination]);

      const transaction = await transactions.save(
        transactions.create({
          fromAccountId: source.id,
          toAccountId: destination.id,
          fromAccount: source,
          toAccount: destination,
          amount: normalizedAmount,
          type: TransactionType.TRANSFER,
          status: TransactionStatus.SUCCESS,
          description,
          idempotencyKey,
        }),
      );

      return this.toTransferResult(transaction);
    });
  }

  async getHistory(userId: string, query: TransactionQueryDto) {
    const account = await this.accountRepo.findOne({ where: { userId } });
    if (!account) {
      throw new NotFoundException('Người dùng chưa có tài khoản');
    }

    const outgoing: FindOptionsWhere<Transaction> = {
      fromAccountId: account.id,
    };
    const incoming: FindOptionsWhere<Transaction> = {
      toAccountId: account.id,
    };
    const where =
      query.direction === TransactionDirection.OUTGOING
        ? outgoing
        : query.direction === TransactionDirection.INCOMING
          ? incoming
          : [outgoing, incoming];

    const [transactions, total] = await this.transactionRepo.findAndCount({
      where,
      relations: { fromAccount: true, toAccount: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return {
      items: transactions.map((transaction) => ({
        id: transaction.id,
        direction:
          transaction.fromAccountId === account.id ? 'outgoing' : 'incoming',
        fromAccountNumber: transaction.fromAccount?.accountNumber ?? null,
        toAccountNumber: transaction.toAccount?.accountNumber ?? null,
        amount: normalizeMoney(transaction.amount),
        type: transaction.type,
        status: transaction.status,
        description: transaction.description,
        createdAt: transaction.createdAt,
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  private findByIdempotencyKey(key: string): Promise<Transaction | null> {
    return this.transactionRepo.findOne({
      where: { idempotencyKey: key },
      relations: { fromAccount: true, toAccount: true },
    });
  }

  private assertSameRequest(
    transaction: Transaction,
    userId: string,
    toAccountNumber: string,
    amount: string,
    description: string | null,
  ): void {
    const isSame =
      transaction.fromAccount?.userId === userId &&
      transaction.toAccount?.accountNumber === toAccountNumber &&
      normalizeMoney(transaction.amount) === amount &&
      transaction.description === description;

    if (!isSame) {
      throw new ConflictException(
        'Idempotency-Key đã được dùng cho một yêu cầu khác',
      );
    }
  }

  private toTransferResult(transaction: Transaction) {
    return {
      id: transaction.id,
      fromAccountNumber: transaction.fromAccount?.accountNumber ?? null,
      toAccountNumber: transaction.toAccount?.accountNumber ?? null,
      amount: normalizeMoney(transaction.amount),
      status: transaction.status,
      description: transaction.description,
      createdAt: transaction.createdAt,
    };
  }
}
