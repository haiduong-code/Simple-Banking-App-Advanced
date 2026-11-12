// Explicitly isolated database. Never load the developer's .env database in integration tests.
process.env.DB_HOST = process.env.E2E_DB_HOST ?? '127.0.0.1';
process.env.DB_PORT = process.env.E2E_DB_PORT ?? '55432';
process.env.DB_USER = process.env.E2E_DB_USER ?? 'banking_test';
process.env.DB_PASSWORD = process.env.E2E_DB_PASSWORD ?? 'banking_test';
process.env.DB_NAME = process.env.E2E_DB_NAME ?? 'banking_test';
if (!process.env.DB_NAME.endsWith('_test'))
  throw new Error(
    'E2E_DB_NAME must end with _test; this suite resets its data',
  );
process.env.JWT_SECRET = 'isolated-integration-test-secret';
process.env.DB_SYNCHRONIZE = 'true';
process.env.OTP_OUTBOX_DIR = require('node:path').join(
  require('node:os').tmpdir(),
  `banking-test-otp-${process.pid}`,
);
