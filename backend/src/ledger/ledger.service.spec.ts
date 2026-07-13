import { existsSync } from 'fs';
import { join } from 'path';
import { Repository } from 'typeorm';
import { LedgerEntry } from './entities/ledger-entry.entity';
import { LedgerService } from './ledger.service';

describe('LedgerService append-only contract', () => {
  let service: LedgerService;

  beforeEach(() => {
    service = new LedgerService({} as Repository<LedgerEntry>);
  });

  it('không expose method update/delete/remove cho ledger', () => {
    const methodNames = Object.getOwnPropertyNames(
      Object.getPrototypeOf(service),
    ).filter((name) => name !== 'constructor');

    expect(methodNames).toEqual(
      expect.arrayContaining([
        'getAccountLedgerBalance',
        'hasEntriesForAccount',
        'hasEntry',
        'createEntry',
        'recordTransfer',
        'recordReversal',
      ]),
    );
    expect(methodNames).not.toEqual(
      expect.arrayContaining([
        'getRepository',
        'update',
        'delete',
        'remove',
        'softDelete',
        'restore',
        'clear',
      ]),
    );
  });

  it('không có LedgerController nên không có route PATCH/DELETE cho ledger', () => {
    expect(existsSync(join(__dirname, 'ledger.controller.ts'))).toBe(false);
  });
});
