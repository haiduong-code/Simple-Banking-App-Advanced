import { NotFoundException } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { Transaction } from '../transactions/entities/transaction.entity';
import { UserHistory } from '../users/entities/user-history.entity';
import { User, UserRole, UserStatus } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AdminService } from './admin.service';
import { RefreshSession } from '../auth/entities/refresh-session.entity';

describe('AdminService', () => {
  let service: AdminService;
  let userRepository: {
    manager: { transaction: jest.Mock };
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let userHistoryRepository: {
    create: jest.Mock;
    save: jest.Mock;
  };
  let auditService: { logInTransaction: jest.Mock };
  let usersService: { softDeleteUser: jest.Mock };
  let accountsService: { softDeleteAccount: jest.Mock };

  beforeEach(() => {
    userRepository = {
      manager: {
        transaction: jest.fn(),
      },
      findOne: jest.fn(),
      save: jest.fn(async (user: User) => user),
    };
    userHistoryRepository = {
      create: jest.fn((input) => input),
      save: jest.fn(async (history) => history),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === RefreshSession)
          return { update: jest.fn(async () => ({})) };
        if (entity === User) {
          return userRepository;
        }
        if (entity === UserHistory) {
          return userHistoryRepository;
        }
        throw new Error('Unexpected repository');
      }),
    } as unknown as EntityManager;
    userRepository.manager.transaction.mockImplementation(async (callback) =>
      callback(manager),
    );
    auditService = {
      logInTransaction: jest.fn(async () => undefined),
    };
    usersService = {
      softDeleteUser: jest.fn(async () => undefined),
    };
    accountsService = {
      softDeleteAccount: jest.fn(async () => undefined),
    };

    service = new AdminService(
      userRepository as unknown as Repository<User>,
      {} as Repository<Transaction>,
      auditService as unknown as AuditService,
      usersService as unknown as UsersService,
      accountsService as unknown as AccountsService,
    );
  });

  it('updates user status and writes audit log', async () => {
    const user = {
      id: '11111111-1111-4111-8111-111111111111',
      fullName: 'Customer',
      email: 'customer@bank.test',
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
      createdAt: new Date('2026-07-10T00:00:00.000Z'),
      deletedAt: null,
      accounts: [],
    } as User;
    userRepository.findOne.mockResolvedValue(user);

    const result = await service.updateUserStatus(
      user.id,
      { status: UserStatus.LOCKED },
      'admin-id',
      { ipAddress: '127.0.0.1', userAgent: 'jest' },
    );

    expect(user.status).toBe(UserStatus.LOCKED);
    expect(result.status).toBe(UserStatus.LOCKED);
    expect(userRepository.save).toHaveBeenCalledWith(user);
    expect(userHistoryRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        changedById: 'admin-id',
        action: 'status_change',
      }),
    );
    expect(auditService.logInTransaction).toHaveBeenCalledWith(
      'user.update',
      expect.objectContaining({
        actorId: 'admin-id',
        entity: 'User',
        entityId: user.id,
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      }),
      expect.any(Object),
    );
  });

  it('throws when user does not exist', async () => {
    userRepository.findOne.mockResolvedValue(null);

    await expect(
      service.updateUserStatus(
        'missing-id',
        { status: UserStatus.LOCKED },
        'admin-id',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(userRepository.save).not.toHaveBeenCalled();
    expect(userHistoryRepository.save).not.toHaveBeenCalled();
    expect(auditService.logInTransaction).not.toHaveBeenCalled();
  });

  it('delegates user soft delete to UsersService', async () => {
    const result = await service.softDeleteUser('user-id', 'admin-id', {
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
    });

    expect(result).toEqual({ deleted: true, userId: 'user-id' });
    expect(usersService.softDeleteUser).toHaveBeenCalledWith(
      'user-id',
      'admin-id',
      {
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      },
    );
  });

  it('delegates account soft delete to AccountsService', async () => {
    const result = await service.softDeleteAccount('account-id', 'admin-id', {
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
    });

    expect(result).toEqual({ deleted: true, accountId: 'account-id' });
    expect(accountsService.softDeleteAccount).toHaveBeenCalledWith(
      'account-id',
      'admin-id',
      {
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      },
    );
  });
});
