// Migration: Push Notifications system tables
// Run once: node scripts/migrate-push-notifications.js
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
  console.log('🔨 Creating push notification tables...\n');

  // 1. user_player_ids — multi-device OneSignal subscriptions
  await client.query(`
    CREATE TABLE IF NOT EXISTS user_player_ids (
      id SERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      player_id VARCHAR(64) NOT NULL UNIQUE,
      device_type VARCHAR(20) DEFAULT 'web',
      created_at TIMESTAMP DEFAULT NOW(),
      last_active_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_user_player_ids_user ON user_player_ids(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_player_ids_player ON user_player_ids(player_id);
  `);
  console.log('✅ user_player_ids');

  // 2. notifications — persistent in-app notification history
  await client.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(30) NOT NULL,
      title VARCHAR(200) NOT NULL,
      message TEXT NOT NULL,
      data JSONB DEFAULT '{}',
      is_read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
  `);
  console.log('✅ notifications');

  // 3. reaction_milestones_sent — deduplication
  await client.query(`
    CREATE TABLE IF NOT EXISTS reaction_milestones_sent (
      id SERIAL PRIMARY KEY,
      confession_id UUID NOT NULL REFERENCES confessions(id) ON DELETE CASCADE,
      milestone INTEGER NOT NULL,
      notified_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(confession_id, milestone)
    );
  `);
  console.log('✅ reaction_milestones_sent');

  // 4. Add notification_preferences JSONB to users
  await client.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{"reactions":true,"gifts":true,"themes":true,"replies":true,"reply_likes":true,"announcements":true,"polls":true,"account_status":true}';
  `);
  console.log('✅ users.notification_preferences');

  // 5. Add columns to notification_queue
  await client.query(`
    ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
    ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS failed BOOLEAN DEFAULT FALSE;
    ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS onesignal_notification_id VARCHAR(64);
    ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS fail_reason TEXT;
  `);
  console.log('✅ notification_queue columns (retry_count, failed, onesignal_notification_id, fail_reason)');

  await client.query('COMMIT');
  console.log('\n🎉 Push notification migration complete!\n');
  await client.end();
  process.exit(0);
}

migrate().catch(async err => {
  console.error('❌ Migration failed:', err.message);
  try { await client.query('ROLLBACK'); await client.end(); } catch(e) {}
  process.exit(1);
});
