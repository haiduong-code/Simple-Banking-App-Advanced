import api from '../lib/api';
import type { AuditLogParams, AuditLogResponse } from '../types/audit';

export async function getAuditLogs(
  params: AuditLogParams,
): Promise<AuditLogResponse> {
  const { data } = await api.get<AuditLogResponse>('/audit-logs', {
    params,
  });
  return data;
}
