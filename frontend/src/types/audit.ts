import type { HistorySnapshot } from './accounts';

export interface AuditLogItem {
  id: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  beforeData: HistorySnapshot | null;
  afterData: HistorySnapshot | null;
  createdAt: string;
}

export interface AuditLogParams {
  page?: number;
  limit?: number;
  actorId?: string;
  action?: string;
  entity?: string;
  entityId?: string;
}

export interface AuditLogResponse {
  items: AuditLogItem[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
