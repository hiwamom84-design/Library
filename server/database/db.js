/**
 * PostgreSQL Database Connection Module
 * Connects to Railway PostgreSQL using process.env.DATABASE_URL.
 * Supports connection pooling, transactions, and SSL configuration.
 */

const { config, maskDatabaseUrl } = require('../config/config');

let pool = null;

function initializePool() {
  if (pool) return pool;

  const dbUrl = config.databaseUrl;
  if (!dbUrl) {
    console.warn('⚠️ [Database] DATABASE_URL is not set. Database operations will fail until configured.');
    return null;
  }

  // Attempt to load 'pg' module
  let pg;
  try {
    pg = require('pg');
  } catch (err) {
    console.error('❌ [Database] The "pg" package is required to connect to PostgreSQL. Run: npm install');
    throw new Error('PostgreSQL driver (pg) is not installed.');
  }

  const { Pool } = pg;

  // Determine SSL configuration
  // Railway internal network (e.g., containers in same project) may not use SSL,
  // but public domain connections (e.g., *.railway.app) require SSL.
  const isLocalhost = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1');
  const requiresSsl = !isLocalhost || dbUrl.includes('sslmode=require') || config.isProduction;

  const poolConfig = {
    connectionString: dbUrl,
    max: 20, // Maximum active connections in pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };

  if (requiresSsl) {
    poolConfig.ssl = {
      rejectUnauthorized: false // Required for Railway self-signed CA certs
    };
  }

  console.log(`🔌 [Database] Connecting to PostgreSQL at: ${maskDatabaseUrl(dbUrl)} (SSL: ${requiresSsl ? 'enabled' : 'disabled'})`);

  pool = new Pool(poolConfig);

  pool.on('error', (err) => {
    console.error('❌ [Database] Unexpected error on idle PostgreSQL client:', err.message);
  });

  return pool;
}

/**
 * Execute a parameterized SQL query
 * @param {string} text - SQL query with $1, $2 placeholders
 * @param {Array} params - Array of parameter values
 */
async function query(text, params = []) {
  const activePool = initializePool();
  if (!activePool) {
    throw new Error('DATABASE_URL is not configured. Please set the DATABASE_URL environment variable.');
  }

  const start = Date.now();
  try {
    const res = await activePool.query(text, params);
    const duration = Date.now() - start;
    if (config.nodeEnv === 'development' && duration > 100) {
      console.log(`⏱️ [Database] Slow query (${duration}ms):`, text.slice(0, 80));
    }
    return res;
  } catch (err) {
    console.error(`❌ [Database Query Error]: ${err.message}`);
    // Do not leak SQL query structure to clients in production
    throw err;
  }
}

/**
 * Get a client from the pool for ACID transactions
 */
async function getClient() {
  const activePool = initializePool();
  if (!activePool) {
    throw new Error('DATABASE_URL is not configured.');
  }
  const client = await activePool.connect();
  return client;
}

/**
 * Health check for database connectivity
 */
async function checkHealth() {
  if (!config.databaseUrl) {
    return {
      status: 'unconfigured',
      healthy: false,
      message: 'DATABASE_URL environment variable is missing.'
    };
  }

  try {
    const res = await query('SELECT 1 AS healthy, NOW() AS server_time, current_database() AS db_name, version() AS pg_version;');
    return {
      status: 'connected',
      healthy: true,
      database: res.rows[0].db_name,
      serverTime: res.rows[0].server_time,
      version: res.rows[0].pg_version
    };
  } catch (err) {
    return {
      status: 'error',
      healthy: false,
      message: err.message
    };
  }
}

/**
 * Graceful pool shutdown
 */
async function close() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('🔌 [Database] PostgreSQL pool closed.');
  }
}

module.exports = {
  query,
  getClient,
  checkHealth,
  close,
  initializePool
};
