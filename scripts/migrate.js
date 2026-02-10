import pool from '../config/database.js';

console.log('🔍 DATABASE_URL:', process.env.DATABASE_URL); // ADD THIS LINE


const createTables = async () => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    console.log('🔨 Creating database tables...');
    
    // Users table
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
        created_at TIMESTAMP DEFAULT NOW(),
        last_login TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Users table created');
    
    // Access codes table (for one-time registration codes)
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
    console.log('✅ Access codes table created');
    
    // Confessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS confessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        mood_zone VARCHAR(50) NOT NULL,
        is_boosted BOOLEAN DEFAULT false,
        boost_expires_at TIMESTAMP,
        audio_url TEXT,
        gender_revealed BOOLEAN DEFAULT false,
        gender VARCHAR(10),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        heart_count INTEGER DEFAULT 0,
        like_count INTEGER DEFAULT 0,
        cry_count INTEGER DEFAULT 0,
        laugh_count INTEGER DEFAULT 0
      );
    `);
    console.log('✅ Confessions table created');
    
    // Reactions table (track who reacted to prevent spam)
    await client.query(`
      CREATE TABLE IF NOT EXISTS reactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        confession_id UUID REFERENCES confessions(id) ON DELETE CASCADE,
        reaction_type VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, confession_id, reaction_type)
      );
    `);
    console.log('✅ Reactions table created');
    
    // Comments/Replies table
    await client.query(`
      CREATE TABLE IF NOT EXISTS comments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        confession_id UUID REFERENCES confessions(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        username VARCHAR(50) NOT NULL,
        user_number INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        likes_count INTEGER DEFAULT 0
      );
    `);
    console.log('✅ Comments table created');
    
    // Transactions table (for payment tracking)
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        credits INTEGER,
        razorpay_order_id VARCHAR(255),
        razorpay_payment_id VARCHAR(255),
        razorpay_signature VARCHAR(255),
        status VARCHAR(20) DEFAULT 'pending',
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Transactions table created');
    
    // Rare numbers table (for bidding system)
    await client.query(`
      CREATE TABLE IF NOT EXISTS rare_numbers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        number INTEGER UNIQUE NOT NULL,
        is_available BOOLEAN DEFAULT true,
        current_owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
        minimum_bid INTEGER DEFAULT 50,
        current_bid INTEGER,
        current_bidder_id UUID REFERENCES users(id) ON DELETE SET NULL,
        auction_ends_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Rare numbers table created');
    
    // Create indexes for better performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_confessions_user_id ON confessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_confessions_created_at ON confessions(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_confessions_mood_zone ON confessions(mood_zone);
      CREATE INDEX IF NOT EXISTS idx_reactions_user_id ON reactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_reactions_confession_id ON reactions(confession_id);
      CREATE INDEX IF NOT EXISTS idx_comments_confession_id ON comments(confession_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
    `);
    console.log('✅ Database indexes created');
    
    // Create trigger for updated_at timestamps
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);
    
    await client.query(`
      DROP TRIGGER IF EXISTS update_users_updated_at ON users;
      CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      DROP TRIGGER IF EXISTS update_confessions_updated_at ON confessions;
      CREATE TRIGGER update_confessions_updated_at BEFORE UPDATE ON confessions
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      DROP TRIGGER IF EXISTS update_transactions_updated_at ON transactions;
      CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);
    console.log('✅ Triggers created');
    
    await client.query('COMMIT');
    console.log('🎉 Database migration completed successfully!');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
};

// Run migration
createTables()
  .then(() => {
    console.log('✅ All tables created successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration error:', error);
    process.exit(1);
  });
