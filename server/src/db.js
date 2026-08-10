import pg from 'pg';
import { cfg } from './config.js';

const poolConfig = {
  connectionString: cfg.dbUrl,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
};
if (cfg.dbSsl) {
  poolConfig.ssl = { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== '0' };
}

export const pool = new pg.Pool(poolConfig);
pool.on('error', (err) => {
  console.error('[db] idle client error', err.message);
});

export const q = (text, params) => pool.query(text, params);
