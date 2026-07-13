import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, FindOptionsWhere, Repository } from 'typeorm';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { AuditLog, AuditLogData } from './entities/audit-log.entity';

export interface AuditLogOptions {
  actorId?: string | null;
  entity: string;
  entityId?: string | null;
  beforeData?: AuditLogData;
  afterData?: AuditLogData;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
  ) {}

  async log(action: string, options: AuditLogOptions): Promise<void> {
    await this.logInTransaction(action, options);
  }

  async logInTransaction(
    action: string,
    options: AuditLogOptions,
    manager?: EntityManager,
  ): Promise<void> {
    const repository = manager?.getRepository(AuditLog) ?? this.auditLogRepo;
    const log = repository.create({
      action,
      actorId: options.actorId ?? null,
      entity: options.entity,
      entityId: options.entityId ?? null,
      ipAddress: this.truncate(options.ipAddress ?? null, 64),
      userAgent: this.truncate(options.userAgent ?? null, 512),
      beforeData: this.sanitizeData(options.beforeData ?? null),
      afterData: this.sanitizeData(options.afterData ?? null),
    });

    await repository.save(log);
  }

  async findLogs(query: AuditLogQueryDto) {
    const where: FindOptionsWhere<AuditLog> = {};

    if (query.actorId) {
      where.actorId = query.actorId;
    }
    if (query.action) {
      where.action = query.action;
    }
    if (query.entity) {
      where.entity = query.entity;
    }
    if (query.entityId) {
      where.entityId = query.entityId;
    }

    const [items, total] = await this.auditLogRepo.findAndCount({
      where,
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return {
      items,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  private sanitizeData(data: AuditLogData): AuditLogData {
    if (!data) {
      return null;
    }

    return Object.fromEntries(
      Object.entries(data).filter(([key]) => !this.isSensitiveKey(key)),
    );
  }

  private isSensitiveKey(key: string): boolean {
    return /password|passwordHash|token|jwt|secret|otp/i.test(key);
  }

  private truncate(value: string | null, maxLength: number): string | null {
    if (!value) {
      return null;
    }

    return value.length > maxLength ? value.slice(0, maxLength) : value;
  }
}
