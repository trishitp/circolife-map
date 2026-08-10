import { pool } from './db.js';
import { runRegeocode } from './sync/sync.js';

const clearFailed = !process.argv.includes('--keep-failed');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limitRows = limitArg ? Number(limitArg.split('=')[1]) : 50000;

try {
  const r = await runRegeocode({ clearFailed, limitRows });
  console.log(JSON.stringify(r, null, 2));
} finally {
  await pool.end();
}
