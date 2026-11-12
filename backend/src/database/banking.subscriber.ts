import {
  EntitySubscriberInterface,
  EventSubscriber,
  UpdateEvent,
  RemoveEvent,
  SoftRemoveEvent,
} from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import { User } from '../users/entities/user.entity';
import { LedgerEntry } from '../ledger/entities/ledger-entry.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { requestContext } from '../common/request-context';

@EventSubscriber()
export class BankingSubscriber implements EntitySubscriberInterface<
  Record<string, unknown>
> {
  beforeUpdate(event: UpdateEvent<Record<string, unknown>>) {
    if (event.metadata.target === LedgerEntry)
      throw new Error('Ledger entries are immutable');
  }
  beforeRemove(event: RemoveEvent<Record<string, unknown>>) {
    if (
      event.metadata.target === LedgerEntry ||
      event.metadata.target === Account ||
      event.metadata.target === User ||
      event.metadata.target === AuditLog
    )
      throw new Error('Hard delete is forbidden for banking records');
  }
  beforeSoftRemove(event: SoftRemoveEvent<Record<string, unknown>>) {
    if (event.metadata.target === LedgerEntry)
      throw new Error('Ledger entries are immutable');
  }
  async afterUpdate(event: UpdateEvent<Record<string, unknown>>) {
    if (
      (event.metadata.target !== Account && event.metadata.target !== User) ||
      !event.databaseEntity ||
      !event.entity
    )
      return;
    const fields =
      event.metadata.target === Account
        ? ['status', 'tier', 'deletedAt']
        : ['fullName', 'email', 'phone', 'status', 'deletedAt'];
    if (
      !event.updatedColumns.some((column) =>
        fields.includes(column.propertyName),
      )
    )
      return;
    const snapshot = (entity: Record<string, unknown>) =>
      Object.fromEntries(fields.map((field) => [field, entity[field] ?? null]));
    const context = requestContext.getStore();
    await event.manager.getRepository(AuditLog).insert({
      actorId: context?.actorId ?? null,
      action: 'entity.updated',
      entity: event.metadata.name,
      entityId: event.databaseEntity.id as string,
      ipAddress: context?.ipAddress?.slice(0, 64) ?? null,
      userAgent: context?.userAgent?.slice(0, 512) ?? null,
      requestId: context?.requestId ?? null,
      beforeData: snapshot(event.databaseEntity),
      afterData: snapshot({ ...event.databaseEntity, ...event.entity }),
    });
  }
}
