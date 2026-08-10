import { pool } from '../src/db.js';
import { runAssetsSync } from '../src/sync/sync.js';

try {
  const r = await runAssetsSync();
  console.log(JSON.stringify(r, null, 2));
} finally {
  await pool.end();
}
