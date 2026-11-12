import { DataSource, EntityManager, Repository } from 'typeorm';
import { Account, AccountStatus } from './entities/account.entity';
import { AccountHistory } from './entities/account-history.entity';
import { AccountsService } from './accounts.service';
import { AuditService } from '../audit/audit.service';
describe('Account creation, ownership, settings and history', () => {
  let service: AccountsService;
  let repository: any;
  let history: any;
  let manager: EntityManager;
  const account = () =>
    ({
      id: 'account-id',
      userId: 'owner',
      accountNumber: '9000000001',
      balance: '100.00',
      holdAmount: '20.00',
      status: AccountStatus.ACTIVE,
      currency: 'VND',
      deletedAt: null,
    }) as Account;
  beforeEach(() => {
    repository = {
      findOne: jest.fn(async () => null),
      findOneBy: jest.fn(async () => null),
      create: jest.fn((input) => input),
      save: jest.fn(async (input) => input),
    };
    history = { findAndCount: jest.fn(async () => [[], 0]), save: jest.fn() };
    manager = {
      getRepository: (entity: any) =>
        entity === Account ? repository : history,
    } as EntityManager;
    service = new AccountsService(
      repository as Repository<Account>,
      history as Repository<AccountHistory>,
      { transaction: async (callback: any) => callback(manager) } as DataSource,
      { logInTransaction: jest.fn() } as unknown as AuditService,
    );
  });
  it('creates a zero-balance VND account, checking collisions including deleted accounts', async () => {
    repository.findOne
      .mockResolvedValueOnce(account())
      .mockResolvedValueOnce(null);
    const result = await service.createForUser('owner');
    expect(result.accountNumber).toMatch(/^9\d{9}$/);
    expect(result.balance).toBe('0.00');
    expect(repository.findOne.mock.calls[0][0].withDeleted).toBe(true);
    await service.createForUser('owner', '0.00', manager);
  });
  it('bounds account number collision retries', async () => {
    repository.findOne.mockResolvedValue(account());
    await expect(service.createForUser('owner')).rejects.toThrow('Không sinh');
    expect(repository.findOne).toHaveBeenCalledTimes(10);
  });
  it('finds the owner account, with a clear error if missing', async () => {
    await expect(service.findByUserId('owner')).rejects.toThrow('chưa có');
    repository.findOne.mockResolvedValue(account());
    await expect(service.findByUserId('owner')).resolves.toMatchObject({
      userId: 'owner',
    });
  });
  it('restricts customer visibility and exposes the available balance without private fields', async () => {
    await expect(
      service.findForActor('missing', 'owner', 'customer'),
    ).rejects.toThrow('Không tìm');
    repository.findOneBy.mockResolvedValue(account());
    await expect(
      service.findForActor('account-id', 'stranger', 'customer'),
    ).rejects.toThrow('của mình');
    await expect(
      service.findForActor('account-id', 'owner', 'customer'),
    ).resolves.toMatchObject({ availableBalance: '80.00' });
    await expect(
      service.findForActor('account-id', 'admin', 'admin'),
    ).resolves.toMatchObject({ availableBalance: '80.00' });
    expect(
      service.toPublicResult({ ...account(), holdAmount: '200.00' })
        .availableBalance,
    ).toBe('0.00');
  });
  it('validates settings and saves the previous account version with the change', async () => {
    await expect(service.updateSettings('id', {}, 'admin')).rejects.toThrow(
      'Cần cung cấp',
    );
    await expect(
      service.updateSettings('id', { status: AccountStatus.FROZEN }, 'admin'),
    ).rejects.toThrow('Không tìm');
    repository.findOne.mockResolvedValue(account());
    await expect(
      service.updateSettings('id', { status: AccountStatus.FROZEN }, 'admin'),
    ).resolves.toMatchObject({ status: AccountStatus.FROZEN });
    expect(history.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'settings_change',
        beforeData: expect.objectContaining({ status: AccountStatus.ACTIVE }),
        afterData: expect.objectContaining({ status: AccountStatus.FROZEN }),
      }),
    );
  });
  it('paginates history including soft-deleted accounts', async () => {
    const query = { page: 2, limit: 5, action: 'soft_delete' };
    await expect(service.findHistory('missing', query)).rejects.toThrow(
      'Không tìm',
    );
    repository.findOne.mockResolvedValue({
      ...account(),
      deletedAt: new Date(),
    });
    const result = await service.findHistory('account-id', query);
    expect(result.meta).toEqual({ page: 2, limit: 5, total: 0, totalPages: 0 });
    expect(history.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: 'account-id', action: 'soft_delete' },
        skip: 5,
        take: 5,
      }),
    );
    await service.findHistory('account-id', { page: 1, limit: 10 });
  });
});
