import pool from '../config/database.js';

const addAccessRequestsTable = async () => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    console.log('🔨 Adding access_requests table...');
    
    // Access requests table
    await client.query(`
      CREATE TABLE IF NOT EXISTS access_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) NOT NULL,
        google_id VARCHAR(255) NOT NULL,
        instagram_handle VARCHAR(100) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        generated_code VARCHAR(50),
        admin_notes TEXT,
        requested_at TIMESTAMP DEFAULT NOW(),
        reviewed_at TIMESTAMP,
        reviewed_by VARCHAR(255),
        UNIQUE(email),
        UNIQUE(instagram_handle)
      );
    `);
    console.log('✅ access_requests table created');
    
    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status);
      CREATE INDEX IF NOT EXISTS idx_access_requests_email ON access_requests(email);
    `);
    console.log('✅ Indexes created');
    
    await client.query('COMMIT');
    console.log('🎉 Migration completed successfully!');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
};

// Run migration
addAccessRequestsTable()
  .then(() => {
    console.log('✅ Access requests table added successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration error:', error);
    process.exit(1);
  });