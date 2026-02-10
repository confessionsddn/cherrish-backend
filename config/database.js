import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

// ============================================
// OPTIMIZED POSTGRESQL CONNECTION
// ============================================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  // OPTIMIZED SETTINGS FOR SUPABASE POOLER
  max: 20,                      // Increase max connections
  min: 5,                       // Keep 5 connections warm
  idleTimeoutMillis: 30000,     // Close idle clients after 30s
  connectionTimeoutMillis: 5000, // Fail fast (5s instead of 10s)
  allowExitOnIdle: false,
  
  // CRITICAL: Enable statement timeout
  statement_timeout: 10000,     // Kill queries after 10s
  query_timeout: 10000,
  
  // Keep-alive for long connections
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000
});

// Connection event handlers
pool.on('connect', (client) => {
  console.log('✅ Database client connected');
  
  // Set faster timeouts on each connection
  client.query('SET statement_timeout = 10000'); // 10 seconds max per query
});

pool.on('error', (err, client) => {
  console.error('❌ Unexpected database error:', err.message);
  // Don't crash, pool will auto-reconnect
});

pool.on('acquire', () => {
  // Silently track connection acquisition
});

pool.on('remove', () => {
  console.log('⚠️ Client removed from pool');
});

// ============================================
// FAST QUERY FUNCTION (NO RETRIES)
// ============================================

export const query = async (text, params) => {
  const start = Date.now();
  
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    
    // Only log slow queries (> 500ms)
    if (duration > 500) {
      console.warn('⚠️ SLOW QUERY:', { 
        text: text.substring(0, 80) + '...', 
        duration: `${duration}ms`,
        rows: res.rowCount
      });
    }
    
    return res;
    
  } catch (error) {
    const duration = Date.now() - start;
    console.error('❌ Query failed:', {
      error: error.message,
      duration: `${duration}ms`,
      query: text.substring(0, 80) + '...'
    });
    throw error;
  }
};

// ============================================
// GET CLIENT FROM POOL (for transactions)
// ============================================

export const getClient = async () => {
  try {
    const client = await pool.connect();
    
    // Set timeout for this client
    await client.query('SET statement_timeout = 10000');
    
    return client;
  } catch (error) {
    console.error('❌ Failed to get client:', error.message);
    throw error;
  }
};

// ============================================
// HEALTH CHECK
// ============================================

export const checkConnection = async () => {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Database connection healthy:', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
};

// Run health check on startup
checkConnection();

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

const shutdown = async () => {
  console.log('🛑 Shutting down database pool...');
  try {
    await pool.end();
    console.log('✅ Database pool closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error closing pool:', error);
    process.exit(1);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export default pool;