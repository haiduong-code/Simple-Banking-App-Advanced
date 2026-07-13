import { Request } from 'express';

export interface AuditRequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

export function getAuditRequestContext(request: Request): AuditRequestContext {
  const userAgentHeader = request.headers['user-agent'];
  const userAgent = Array.isArray(userAgentHeader)
    ? userAgentHeader.join(', ')
    : (userAgentHeader ?? null);

  return {
    ipAddress: request.ip ?? null,
    userAgent,
  };
}
