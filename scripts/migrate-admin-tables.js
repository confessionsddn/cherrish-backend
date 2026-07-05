// Migration: Create tables needed by admin routes
import pg from 'pg';
const { Client } = pg;
import dotenv from 'dotenv';
dotenv.config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000
});

async function migrate() {
  await client.connect();
  console.log('✅ Connected\n');
  await client.query('BEGIN');

  // user_ip_logs - tracks user activity by IP
  await client.query(`
    CREATE TABLE IF NOT EXISTS user_ip_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      ip_address VARCHAR(50),
      user_agent TEXT,
      action VARCHAR(50) DEFAULT 'page_view',
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ip_logs_user ON user_ip_logs(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ip_logs_created ON user_ip_logs(created_at);
  `);
  console.log('✅ user_ip_logs');

  // admin_action_logs - tracks admin actions
  await client.query(`
    CREATE TABLE IF NOT EXISTS admin_action_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      admin_id UUID REFERENCES users(id) ON DELETE CASCADE,
      action_type VARCHAR(50) NOT NULL,
      target_type VARCHAR(50),
      target_id UUID,
      details JSONB,
      ip_address VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON admin_action_logs(created_at DESC);
  `);
  console.log('✅ admin_action_logs');

  // user_streaks
  await client.query(`
    CREATE TABLE IF NOT EXISTS user_streaks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      current_streak INTEGER DEFAULT 0,
      longest_streak INTEGER DEFAULT 0,
      last_active_date DATE,
      streak_started_date DATE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ user_streaks');

  // Add missing columns to confessions table
  await client.query(`
    ALTER TABLE confessions ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMP;
    ALTER TABLE confessions ADD COLUMN IF NOT EXISTS pinned_by UUID;
    ALTER TABLE confessions ADD COLUMN IF NOT EXISTS featured_at TIMESTAMP;
    ALTER TABLE confessions ADD COLUMN IF NOT EXISTS featured_by UUID;
    ALTER TABLE confessions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
    ALTER TABLE confessions ADD COLUMN IF NOT EXISTS deleted_by UUID;
  `);
  console.log('✅ confessions columns (pinned_at, featured_at, deleted_at, etc.)');

  // Add missing columns to users table
  await client.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
  `);
  console.log('✅ users.deleted_at column');

  // Add rupees_paid column to credit_transactions (for top buyers)
  await client.query(`
    ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS rupees_paid INTEGER DEFAULT 0;
  `);
  console.log('✅ credit_transactions.rupees_paid column');

  await client.query('COMMIT');
  console.log('\n🎉 Admin tables migration complete!\n');
  await client.end();
  process.exit(0);
}

migrate().catch(async err => {
  console.error('❌ Failed:', err.message);
  try { await client.query('ROLLBACK'); await client.end(); } catch(e) {}
  process.exit(1);
});
