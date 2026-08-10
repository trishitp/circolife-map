import { spawn } from 'node:child_process';
import pg from 'pg';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}`));
    });
  });
}

async function waitForDatabase(url, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      await client.end();
      return;
    } catch {
      console.log('[entrypoint] waiting for database…');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('database not ready');
}

async function seedPincodesIfEmpty(url) {
  const pool = new pg.Pool({ connectionString: url });
  try {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM pincode_centroids');
    if (rows[0].n > 0) return;
    console.log('[entrypoint] pincode_centroids empty — loading data/pincodes.csv');
    await run('node', ['scripts/load_pincodes.js', 'data/pincodes.csv']);
  } finally {
    await pool.end();
  }
}

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('[entrypoint] DATABASE_URL is required');
  process.exit(1);
}

await waitForDatabase(dbUrl);
await run('node', ['src/migrate.js']);
await seedPincodesIfEmpty(dbUrl);

const server = spawn('node', ['src/index.js'], { stdio: 'inherit' });
server.on('exit', (code) => process.exit(code ?? 0));
