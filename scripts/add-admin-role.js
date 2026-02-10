import pool from '../config/database.js';

const addAdminRole = async () => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    console.log('🔨 Adding admin role to users table...');
    
    // Add is_admin column
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;
    `);
    console.log('✅ is_admin column added');
    
    // Make your email admin
    const adminEmail = 'itmconfessionddn@gmail.com'; // CHANGE THIS TO YOUR EMAIL
    
    await client.query(`
      UPDATE users SET is_admin = true WHERE email = $1;
    `, [adminEmail]);
    console.log(`✅ Admin privileges granted to: ${adminEmail}`);
    
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

addAdminRole()
  .then(() => {
    console.log('✅ Admin role added successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });