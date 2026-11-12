import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Local development SMS mailbox. OTP never appears in API responses or logs. */
@Injectable()
export class OtpDeliveryService {
  constructor(private readonly config: ConfigService) {}
  async deliver(
    transactionId: string,
    ownerId: string,
    code: string,
    expiresAt: Date,
  ) {
    const directory = resolve(
      this.config.get('OTP_OUTBOX_DIR', '.local/otp-outbox'),
    );
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, `${transactionId}.json`),
      JSON.stringify({ transactionId, ownerId, code, expiresAt }),
      { mode: 0o600 },
    );
  }
}
