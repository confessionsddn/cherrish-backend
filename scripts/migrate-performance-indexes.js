// Migration: Performance indexes matching the app's hot query patterns.
// Run once: node scripts/migrate-performance-indexes.js
//
// These use CREATE INDEX CONCURRENTLY so they don't lock the tables while
// building (important on a live DB). CONCURRENTLY cannot run inside a
// transaction, so each statement is issued on its own — do NOT wrap in BEGIN.
import pg from 'pg';
const { Client } = pg;
import dotenv from 'dotenv';
dotenv.config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000
});

// Each index targets a real query:
//  1. Feed: WHERE status='approved' ORDER BY created_at DESC  (composite)
//  2. Trending feed: WHERE status='approved' ORDER BY trending_score DESC, created_at DESC
//  3. Cleanup cron: DELETE notifications WHERE is_read=true AND created_at < ...
//  4. Cleanup + queue: notification_queue by (is_sent, created_at)
const INDEXES = [
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_confessions_status_created
     ON confessions(status, created_at DESC)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_confessions_status_trending
     ON confessions(status, trending_score DESC, created_at DESC)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_read_created
     ON notifications(is_read, created_at)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_queue_sent_created
     ON notification_queue(is_sent, created_at)`,
];

async function migrate() {
  await client.connect();
  console.log('✅ Connected\n');
  console.log('🔨 Creating performance indexes (CONCURRENTLY, no table locks)...\n');

  for (const stmt of INDEXES) {
    const name = stmt.match(/idx_[a-z_]+/)?.[0] || 'index';
    try {
      await client.query(stmt);
      console.log(`✅ ${name}`);
    } catch (err) {
      // CONCURRENTLY can leave an INVALID index on failure; report and continue.
      console.error(`⚠️  ${name} failed: ${err.message}`);
    }
  }

  console.log('\n🎉 Performance index migration complete!\n');
  await client.end();
  process.exit(0);
}

migrate().catch(async (err) => {
  console.error('❌ Migration failed:', err.message);
  try { await client.end(); } catch (e) {}
  process.exit(1);
});
