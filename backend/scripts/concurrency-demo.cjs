// Runs only on a dedicated *_test database; never imports application .env settings.
const { Pool } = require('pg');
const { performance } = require('node:perf_hooks');
const database = process.env.E2E_DB_NAME ?? 'banking_test';
if (!database.endsWith('_test'))
  throw new Error('Use a dedicated database ending in _test');
const pool = new Pool({
  host: process.env.E2E_DB_HOST ?? '127.0.0.1',
  port: +(process.env.E2E_DB_PORT ?? 55432),
  user: process.env.E2E_DB_USER ?? 'banking_test',
  password: process.env.E2E_DB_PASSWORD ?? 'banking_test',
  database,
  max: 25,
});
const table = `concurrency_demo_${process.pid}`;

async function run(mode) {
  await pool.query(
    `UPDATE ${table} SET balance = 1000000, version = 0 WHERE id = 1`,
  );
  let waiting = 0;
  let release;
  const allRead = new Promise((resolve) => {
    release = resolve;
  });
  const durations = [];
  const started = performance.now();
  const results = await Promise.all(
    Array.from({ length: 20 }, async () => {
      const start = performance.now();
      const client = await pool.connect();
      try {
        if (mode === 'unsafe') {
          const { rows } = await client.query(
            `SELECT balance FROM ${table} WHERE id = 1`,
          );
          if (++waiting === 20) release();
          await allRead;
          if (rows[0].balance < 100000) return false;
          await client.query(`UPDATE ${table} SET balance = $1 WHERE id = 1`, [
            rows[0].balance - 100000,
          ]);
          return true;
        }
        if (mode === 'pessimistic') {
          await client.query('BEGIN');
          const { rows } = await client.query(
            `SELECT balance FROM ${table} WHERE id = 1 FOR UPDATE`,
          );
          if (rows[0].balance < 100000) {
            await client.query('ROLLBACK');
            return false;
          }
          await client.query(
            `UPDATE ${table} SET balance = balance - 100000, version = version + 1 WHERE id = 1`,
          );
          await client.query('COMMIT');
          return true;
        }
        for (let attempt = 0; attempt < 30; attempt++) {
          const { rows } = await client.query(
            `SELECT balance, version FROM ${table} WHERE id = 1`,
          );
          if (rows[0].balance < 100000) return false;
          const update = await client.query(
            `UPDATE ${table} SET balance = balance - 100000, version = version + 1 WHERE id = 1 AND version = $1`,
            [rows[0].version],
          );
          if (update.rowCount === 1) return true;
          await new Promise((resolve) =>
            setTimeout(resolve, Math.random() * 10),
          );
        }
        throw new Error('Retry limit reached');
      } finally {
        durations.push(performance.now() - start);
        client.release();
      }
    }),
  );
  const elapsedMs = performance.now() - started;
  const { rows } = await pool.query(
    `SELECT balance FROM ${table} WHERE id = 1`,
  );
  return {
    mode,
    requests: 20,
    succeeded: results.filter(Boolean).length,
    rejected: results.filter((value) => !value).length,
    finalBalance: rows[0].balance,
    meanLatencyMs: +(
      durations.reduce((sum, value) => sum + value, 0) / 20
    ).toFixed(2),
    requestsPerSecond: +(20000 / elapsedMs).toFixed(2),
  };
}
(async () => {
  try {
    await pool.query(
      `CREATE TABLE ${table} (id int PRIMARY KEY, balance bigint NOT NULL, version int NOT NULL)`,
    );
    await pool.query(`INSERT INTO ${table} VALUES (1, 1000000, 0)`);
    const results = [];
    for (const mode of ['unsafe', 'pessimistic', 'optimistic'])
      results.push(await run(mode));
    console.log(JSON.stringify(results, null, 2));
    if (
      results[1].succeeded !== 10 ||
      results[2].succeeded !== 10 ||
      results[1].finalBalance !== '0' ||
      results[2].finalBalance !== '0'
    )
      throw new Error('Concurrency invariant failed');
  } finally {
    await pool.query(`DROP TABLE IF EXISTS ${table}`);
    await pool.end();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
