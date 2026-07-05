// Standalone migration runner - uses direct pg connection (not config/database.js)
import pg from 'pg';
const { Client } = pg;

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_Lm9kGZ8tUyqK@ep-twilight-poetry-a6xr8ybw.us-west-2.aws.neon.tech/neondb?sslmode=require';

console.log('🔗 Connecting to:', DATABASE_URL.substring(0, 60) + '...');

const client = new Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  statement_timeout: 30000
});

async function migrate() {
  await client.connect();
  console.log('✅ Connected to database!\n');

  await client.query('BEGIN');
  console.log('🔨 Creating tables...\n');

  // USERS
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      google_id VARCHAR(255) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      username VARCHAR(50) UNIQUE NOT NULL,
      user_number INTEGER UNIQUE NOT NULL,
      credits INTEGER DEFAULT 150,
      is_premium BOOLEAN DEFAULT false,
      is_banned BOOLEAN DEFAULT false,
      is_admin BOOLEAN DEFAULT false,
      ban_until TIMESTAMP,
      username_changed BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW(),
      last_login TIMESTAMP DEFAULT NOW(),
      last_activity TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ users');

  // ACCESS CODES
  await client.query(`
    CREATE TABLE IF NOT EXISTS access_codes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code VARCHAR(50) UNIQUE NOT NULL,
      is_used BOOLEAN DEFAULT false,
      used_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      used_at TIMESTAMP,
      expires_at TIMESTAMP
    );
  `);
  console.log('✅ access_codes');

  // ACCESS REQUESTS
  await client.query(`
    CREATE TABLE IF NOT EXISTS access_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) NOT NULL,
      google_id VARCHAR(255),
      instagram_handle VARCHAR(50),
      status VARCHAR(20) DEFAULT 'pending',
      generated_code VARCHAR(50),
      admin_notes TEXT,
      reviewed_by VARCHAR(255),
      requested_at TIMESTAMP DEFAULT NOW(),
      reviewed_at TIMESTAMP
    );
  `);
  console.log('✅ access_requests');

  // CONFESSIONS
  await client.query(`
    CREATE TABLE IF NOT EXISTS confessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      mood_zone VARCHAR(50) NOT NULL,
      status VARCHAR(20) DEFAULT 'approved',
      is_boosted BOOLEAN DEFAULT false,
      is_spotlight BOOLEAN DEFAULT false,
      is_pinned BOOLEAN DEFAULT false,
      is_featured BOOLEAN DEFAULT false,
      boost_expires_at TIMESTAMP,
      boost_multiplier DECIMAL(3,1) DEFAULT 1.0,
      spotlight_expires_at TIMESTAMP,
      audio_url TEXT,
      gender_revealed BOOLEAN DEFAULT false,
      gender VARCHAR(10),
      trending_score DECIMAL(10,4) DEFAULT 0,
      views_count INTEGER DEFAULT 0,
      total_impressions INTEGER DEFAULT 0,
      replies_count INTEGER DEFAULT 0,
      heart_count INTEGER DEFAULT 0,
      like_count INTEGER DEFAULT 0,
      cry_count INTEGER DEFAULT 0,
      laugh_count INTEGER DEFAULT 0,
      reviewed_by VARCHAR(255),
      reviewed_at TIMESTAMP,
      rejection_reason TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ confessions');

  // REACTIONS
  await client.query(`
    CREATE TABLE IF NOT EXISTS reactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      confession_id UUID REFERENCES confessions(id) ON DELETE CASCADE,
      reaction_type VARCHAR(20) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ reactions');

  // REACTION COOLDOWNS
  await client.query(`
    CREATE TABLE IF NOT EXISTS reaction_cooldowns (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      total_reactions INTEGER DEFAULT 0,
      window_start TIMESTAMP DEFAULT NOW(),
      last_reaction_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ reaction_cooldowns');

  // CONFESSION REPLIES
  await client.query(`
    CREATE TABLE IF NOT EXISTS confession_replies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      confession_id UUID REFERENCES confessions(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      likes_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ confession_replies');

  // REPLY LIKES
  await client.query(`
    CREATE TABLE IF NOT EXISTS reply_likes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      reply_id UUID REFERENCES confession_replies(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(reply_id, user_id)
    );
  `);
  console.log('✅ reply_likes');

  // CONFESSION VIEWS
  await client.query(`
    CREATE TABLE IF NOT EXISTS confession_views (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      confession_id UUID REFERENCES confessions(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      viewed_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ confession_views');

  // CONFESSION REPORTS
  await client.query(`
    CREATE TABLE IF NOT EXISTS confession_reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      confession_id UUID REFERENCES confessions(id) ON DELETE CASCADE,
      reported_by UUID REFERENCES users(id) ON DELETE CASCADE,
      reason VARCHAR(50) NOT NULL,
      details TEXT,
      status VARCHAR(20) DEFAULT 'pending',
      reviewed_by VARCHAR(255),
      reviewed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(confession_id, reported_by)
    );
  `);
  console.log('✅ confession_reports');

  // CREDIT TRANSACTIONS
  await client.query(`
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      type VARCHAR(20) NOT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ credit_transactions');

  // PAYMENT RECEIPTS
  await client.query(`
    CREATE TABLE IF NOT EXISTS payment_receipts (
      id SERIAL PRIMARY KEY,
      payment_id TEXT UNIQUE NOT NULL,
      order_id TEXT NOT NULL,
      user_id UUID NOT NULL REFERENCES users(id),
      payment_type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ payment_receipts');

  // PREMIUM SUBSCRIPTIONS
  await client.query(`
    CREATE TABLE IF NOT EXISTS premium_subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      start_date TIMESTAMP DEFAULT NOW(),
      end_date TIMESTAMP NOT NULL,
      is_active BOOLEAN DEFAULT true,
      spotlight_uses_remaining INTEGER DEFAULT 10,
      spotlight_12h_remaining INTEGER DEFAULT 10,
      boost_12h_remaining INTEGER DEFAULT 10,
      daily_edit_used BOOLEAN DEFAULT false,
      daily_voice_used BOOLEAN DEFAULT false,
      last_reset_date DATE,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ premium_subscriptions');

  // CONFESSION GIFTS
  await client.query(`
    CREATE TABLE IF NOT EXISTS confession_gifts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      confession_id UUID REFERENCES confessions(id) ON DELETE CASCADE,
      sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
      gift_type VARCHAR(50) NOT NULL,
      gift_price INTEGER NOT NULL,
      message TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ confession_gifts');

  // USER GIFT INVENTORY
  await client.query(`
    CREATE TABLE IF NOT EXISTS user_gift_inventory (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      gift_type VARCHAR(50) NOT NULL,
      total_received INTEGER DEFAULT 0,
      unlocked_theme BOOLEAN DEFAULT false,
      UNIQUE(user_id, gift_type)
    );
  `);
  console.log('✅ user_gift_inventory');

  // USER ACTIVE THEMES
  await client.query(`
    CREATE TABLE IF NOT EXISTS user_active_themes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      theme_name VARCHAR(50) NOT NULL,
      is_active BOOLEAN DEFAULT false,
      unlocked_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, theme_name)
    );
  `);
  console.log('✅ user_active_themes');

  // VISIBILITY PURCHASES
  await client.query(`
    CREATE TABLE IF NOT EXISTS visibility_purchases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      confession_id UUID REFERENCES confessions(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(20) NOT NULL,
      duration_minutes INTEGER NOT NULL,
      credits_spent INTEGER DEFAULT 0,
      was_premium BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ visibility_purchases');

  // POLLS
  await client.query(`
    CREATE TABLE IF NOT EXISTS polls (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_by UUID REFERENCES users(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      allow_multiple_answers BOOLEAN DEFAULT false,
      is_pinned BOOLEAN DEFAULT false,
      is_active BOOLEAN DEFAULT true,
      expires_at TIMESTAMP,
      total_votes INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ polls');

  // POLL OPTIONS
  await client.query(`
    CREATE TABLE IF NOT EXISTS poll_options (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      poll_id UUID REFERENCES polls(id) ON DELETE CASCADE,
      option_text VARCHAR(200) NOT NULL,
      display_order INTEGER DEFAULT 0,
      vote_count INTEGER DEFAULT 0
    );
  `);
  console.log('✅ poll_options');

  // POLL VOTES
  await client.query(`
    CREATE TABLE IF NOT EXISTS poll_votes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      poll_id UUID REFERENCES polls(id) ON DELETE CASCADE,
      option_id UUID REFERENCES poll_options(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(poll_id, option_id, user_id)
    );
  `);
  console.log('✅ poll_votes');

  // COMMUNITY MESSAGES
  await client.query(`
    CREATE TABLE IF NOT EXISTS community_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_by UUID REFERENCES users(id) ON DELETE CASCADE,
      message_text TEXT NOT NULL,
      is_pinned BOOLEAN DEFAULT false,
      is_deleted BOOLEAN DEFAULT false,
      total_reactions INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ community_messages');

  // MESSAGE REACTIONS
  await client.query(`
    CREATE TABLE IF NOT EXISTS message_reactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id UUID REFERENCES community_messages(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      reaction_type VARCHAR(20) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(message_id, user_id, reaction_type)
    );
  `);
  console.log('✅ message_reactions');

  // ADMIN MESSAGES
  await client.query(`
    CREATE TABLE IF NOT EXISTS admin_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      sender_type VARCHAR(10) NOT NULL,
      message TEXT NOT NULL,
      is_read BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ admin_messages');

  // USER ACTIVITY LOG
  await client.query(`
    CREATE TABLE IF NOT EXISTS user_activity_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      action_type VARCHAR(50) NOT NULL,
      action_details JSONB,
      target_id UUID,
      credits_change INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ user_activity_log');

  // ADMIN AUDIT LOG
  await client.query(`
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      admin_id UUID REFERENCES users(id) ON DELETE CASCADE,
      action_type VARCHAR(50) NOT NULL,
      entity_type VARCHAR(50),
      entity_id UUID,
      details JSONB,
      ip_address VARCHAR(50),
      user_agent TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ admin_audit_log');

  // RARE NUMBERS
  await client.query(`
    CREATE TABLE IF NOT EXISTS rare_numbers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      number INTEGER UNIQUE NOT NULL,
      is_available BOOLEAN DEFAULT true,
      current_owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
      minimum_bid INTEGER DEFAULT 50,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ rare_numbers');

  // USERNAME HISTORY
  await client.query(`
    CREATE TABLE IF NOT EXISTS username_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      old_username VARCHAR(50),
      new_username VARCHAR(50),
      changed_by VARCHAR(20) DEFAULT 'user',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ username_history');

  // NOTIFICATION QUEUE
  await client.query(`
    CREATE TABLE IF NOT EXISTS notification_queue (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      notification_type VARCHAR(50) NOT NULL,
      title TEXT,
      message TEXT,
      data JSONB,
      is_sent BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ notification_queue');

  // INDEXES
  console.log('\n📊 Creating indexes...');
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_confessions_user_id ON confessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_confessions_created_at ON confessions(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_confessions_status ON confessions(status);
    CREATE INDEX IF NOT EXISTS idx_reactions_user_confession ON reactions(user_id, confession_id);
    CREATE INDEX IF NOT EXISTS idx_replies_confession_id ON confession_replies(confession_id);
    CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON credit_transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_payment_receipts_pid ON payment_receipts(payment_id);
    CREATE INDEX IF NOT EXISTS idx_views_lookup ON confession_views(confession_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_admin_msg_user ON admin_messages(user_id);
    CREATE INDEX IF NOT EXISTS idx_activity_user ON user_activity_log(user_id, created_at DESC);
  `);
  console.log('✅ All indexes created');

  // TRIGGERS
  await client.query(`
    CREATE OR REPLACE FUNCTION update_poll_vote_count()
    RETURNS TRIGGER AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        UPDATE poll_options SET vote_count = vote_count + 1 WHERE id = NEW.option_id;
        UPDATE polls SET total_votes = total_votes + 1 WHERE id = NEW.poll_id;
      ELSIF TG_OP = 'DELETE' THEN
        UPDATE poll_options SET vote_count = GREATEST(vote_count - 1, 0) WHERE id = OLD.option_id;
        UPDATE polls SET total_votes = GREATEST(total_votes - 1, 0) WHERE id = OLD.poll_id;
      END IF;
      RETURN NULL;
    END;
    $$ language 'plpgsql';

    DROP TRIGGER IF EXISTS trigger_poll_vote_count ON poll_votes;
    CREATE TRIGGER trigger_poll_vote_count
    AFTER INSERT OR DELETE ON poll_votes
    FOR EACH ROW EXECUTE FUNCTION update_poll_vote_count();
  `);
  console.log('✅ Triggers created');

  await client.query('COMMIT');
  console.log('\n🎉 Migration complete! All 25 tables ready.\n');
  
  await client.end();
  process.exit(0);
}

migrate().catch(async err => {
  console.error('\n❌ MIGRATION FAILED:', err.message);
  try { await client.query('ROLLBACK'); await client.end(); } catch(e) {}
  process.exit(1);
});
