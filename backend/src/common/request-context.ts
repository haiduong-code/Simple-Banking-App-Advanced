import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

export const requestContext = new AsyncLocalStorage<{
  requestId: string;
  actorId?: string;
  ipAddress?: string;
  userAgent?: string;
}>();

export function logEvent(
  level: 'info' | 'error' | 'warn',
  event: string,
  data: Record<string, unknown> = {},
) {
  const output = {
    timestamp: new Date().toISOString(),
    level,
    event,
    requestId: requestContext.getStore()?.requestId ?? null,
    ...data,
  };
  console[level === 'info' ? 'log' : level](JSON.stringify(output));
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const supplied = req.header('x-request-id');
    const requestId =
      supplied && /^[\w-]{1,100}$/.test(supplied) ? supplied : randomUUID();
    res.setHeader('X-Request-Id', requestId);
    const start = performance.now();
    requestContext.run(
      { requestId, ipAddress: req.ip, userAgent: req.header('user-agent') },
      () => {
        res.on('finish', () =>
          logEvent(res.statusCode >= 500 ? 'error' : 'info', 'http.request', {
            requestId,
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            durationMs: Math.round((performance.now() - start) * 100) / 100,
          }),
        );
        next();
      },
    );
  }
}
