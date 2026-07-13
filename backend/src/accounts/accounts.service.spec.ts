import { NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AccountsService } from './accounts.service';
import { AccountHistory } from './entities/account-history.entity';
import { Account } from './entities/account.entity';

describe('AccountsService soft delete', () => {
  let service: AccountsService;
  let accountRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    softDelete: jest.Mock;
  };
  let accountHistoryRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findAndCount: jest.Mock;
  };
  let auditService: { logInTransaction: jest.Mock };

  beforeEach(() => {
    accountRepository = {
      findOne: jest.fn(),
      save: jest.fn(async (account: Account) => account),
      delete: jest.fn(),
      softDelete: jest.fn(),
    };
    accountHistoryRepository = {
      create: jest.fn((input) => input),
      save: jest.fn(async (history) => history),
      findAndCount: jest.fn(),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
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

    service = new AccountsService(
      {} as Repository<Account>,
      accountHistoryRepository as unknown as Repository<AccountHistory>,
      dataSource as unknown as DataSource,
      auditService as unknown as AuditService,
    );
  });

  it('sets deletedAt and writes audit log without hard delete', async () => {
    const account = {
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      accountNumber: '9000000001',
      balance: '100.00',
      currency: 'VND',
      deletedAt: null,
    } as Account;
    accountRepository.findOne.mockResolvedValue(account);

    await service.softDeleteAccount(account.id, 'admin-id', {
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
    });

    expect(account.deletedAt).toBeInstanceOf(Date);
    expect(accountRepository.save).toHaveBeenCalledWith(account);
    expect(accountRepository.delete).not.toHaveBeenCalled();
    expect(accountRepository.softDelete).not.toHaveBeenCalled();
    expect(accountHistoryRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: account.id,
        changedById: 'admin-id',
        action: 'soft_delete',
      }),
    );
    expect(auditService.logInTransaction).toHaveBeenCalledWith(
      'account.soft_delete',
      expect.objectContaining({
        actorId: 'admin-id',
        entity: 'Account',
        entityId: account.id,
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      }),
      expect.any(Object),
    );
  });

  it('throws when account does not exist', async () => {
    accountRepository.findOne.mockResolvedValue(null);

    await expect(
      service.softDeleteAccount('missing-id', 'admin-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(accountRepository.save).not.toHaveBeenCalled();
    expect(accountHistoryRepository.save).not.toHaveBeenCalled();
    expect(auditService.logInTransaction).not.toHaveBeenCalled();
  });
});
