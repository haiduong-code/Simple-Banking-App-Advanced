import { NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import { AccountHistory } from '../accounts/entities/account-history.entity';
import { AuditService } from '../audit/audit.service';
import { UserHistory } from './entities/user-history.entity';
import { User, UserRole, UserStatus } from './entities/user.entity';
import { UsersService } from './users.service';

describe('UsersService soft delete', () => {
  let service: UsersService;
  let userRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    softDelete: jest.Mock;
  };
  let userHistoryRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findAndCount: jest.Mock;
  };
  let accountRepository: {
    find: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    softDelete: jest.Mock;
  };
  let accountHistoryRepository: {
    create: jest.Mock;
    save: jest.Mock;
  };
  let auditService: { logInTransaction: jest.Mock };

  beforeEach(() => {
    userRepository = {
      findOne: jest.fn(),
      save: jest.fn(async (user: User) => user),
      delete: jest.fn(),
      softDelete: jest.fn(),
    };
    userHistoryRepository = {
      create: jest.fn((input) => input),
      save: jest.fn(async (history) => history),
      findAndCount: jest.fn(),
    };
    accountRepository = {
      find: jest.fn(async () => []),
      save: jest.fn(async (accounts: Account[]) => accounts),
      delete: jest.fn(),
      softDelete: jest.fn(),
    };
    accountHistoryRepository = {
      create: jest.fn((input) => input),
      save: jest.fn(async (history) => history),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === User) {
          return userRepository;
        }
        if (entity === UserHistory) {
          return userHistoryRepository;
        }
        if (entity === Account) {
          return accountRepository;
        }
        if (entity === AccountHistory) {
          return accountHistoryRepository;
        }
        throw new Error('Unexpected repository');
      }),
    } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    auditService = {
      logInTransaction: jest.fn(async () => undefined),
    };

    service = new UsersService(
      {} as Repository<User>,
      userHistoryRepository as unknown as Repository<UserHistory>,
      dataSource as unknown as DataSource,
      auditService as unknown as AuditService,
    );
  });

  it('sets deletedAt on user and accounts and writes audit logs', async () => {
    const user = {
      id: '11111111-1111-4111-8111-111111111111',
      fullName: 'Test User',
      email: 'test@bank.test',
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
      deletedAt: null,
    } as User;
    const account = {
      id: '22222222-2222-4222-8222-222222222222',
      userId: user.id,
      accountNumber: '9000000001',
      balance: '100.00',
      currency: 'VND',
      deletedAt: null,
    } as Account;
    userRepository.findOne.mockResolvedValue(user);
    accountRepository.find.mockResolvedValue([account]);

    await service.softDeleteUser(user.id, 'admin-id', {
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
    });

    expect(user.deletedAt).toBeInstanceOf(Date);
    expect(account.deletedAt).toBeInstanceOf(Date);
    expect(userRepository.save).toHaveBeenCalledWith(user);
    expect(accountRepository.save).toHaveBeenCalledWith([account]);
    expect(userRepository.delete).not.toHaveBeenCalled();
    expect(accountRepository.delete).not.toHaveBeenCalled();
    expect(userHistoryRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        changedById: 'admin-id',
        action: 'soft_delete',
      }),
    );
    expect(accountHistoryRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: account.id,
        changedById: 'admin-id',
        action: 'soft_delete',
      }),
    );
    expect(auditService.logInTransaction).toHaveBeenCalledWith(
      'user.soft_delete',
      expect.objectContaining({
        actorId: 'admin-id',
        entity: 'User',
        entityId: user.id,
      }),
      expect.any(Object),
    );
    expect(auditService.logInTransaction).toHaveBeenCalledWith(
      'account.soft_delete',
      expect.objectContaining({
        actorId: 'admin-id',
        entity: 'Account',
        entityId: account.id,
      }),
      expect.any(Object),
    );
  });

  it('throws when user does not exist', async () => {
    userRepository.findOne.mockResolvedValue(null);

    await expect(
      service.softDeleteUser('missing-id', 'admin-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(userRepository.save).not.toHaveBeenCalled();
    expect(accountRepository.save).not.toHaveBeenCalled();
    expect(userHistoryRepository.save).not.toHaveBeenCalled();
    expect(accountHistoryRepository.save).not.toHaveBeenCalled();
    expect(auditService.logInTransaction).not.toHaveBeenCalled();
  });

  it('updates profile and writes user history', async () => {
    const user = {
      id: '11111111-1111-4111-8111-111111111111',
      fullName: 'Old Name',
      email: 'old@bank.test',
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
      createdAt: new Date('2026-07-10T00:00:00.000Z'),
      deletedAt: null,
    } as User;
    userRepository.findOne.mockResolvedValueOnce(user).mockResolvedValue(null);

    const result = await service.updateProfile(
      user.id,
      { fullName: 'New Name', email: 'new@bank.test' },
      user.id,
      { ipAddress: '127.0.0.1', userAgent: 'jest' },
    );

    expect(result.fullName).toBe('New Name');
    expect(result.email).toBe('new@bank.test');
    expect(userRepository.save).toHaveBeenCalledWith(user);
    expect(userHistoryRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        changedById: user.id,
        action: 'update_profile',
      }),
    );
    expect(auditService.logInTransaction).toHaveBeenCalledWith(
      'user.update',
      expect.objectContaining({
        actorId: user.id,
        entity: 'User',
        entityId: user.id,
      }),
      expect.any(Object),
    );
  });
});
