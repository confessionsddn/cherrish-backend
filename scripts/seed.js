import pool from '../config/database.js';

const seedDatabase = async () => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    console.log('🌱 Seeding database...');
    
    // Insert rare numbers for bidding
    const rareNumbers = [1, 7, 69, 77, 100, 111, 420, 500, 666, 777, 999];
    
    for (const number of rareNumbers) {
      await client.query(`
        INSERT INTO rare_numbers (number, is_available, minimum_bid)
        VALUES ($1, true, $2)
        ON CONFLICT (number) DO NOTHING
      `, [number, 50]);
    }
    console.log(`✅ Inserted ${rareNumbers.length} rare numbers`);
    
    // Insert some sample access codes (for testing)
    const sampleCodes = [
      'LOVE2024-DEMO-001',
      'LOVE2024-DEMO-002',
      'LOVE2024-DEMO-003',
      'LOVE2024-DEMO-004',
      'LOVE2024-DEMO-005'
    ];
    
    for (const code of sampleCodes) {
      await client.query(`
        INSERT INTO access_codes (code, is_used)
        VALUES ($1, false)
        ON CONFLICT (code) DO NOTHING
      `, [code]);
    }
    console.log(`✅ Inserted ${sampleCodes.length} sample access codes`);
    console.log('📝 Sample codes:', sampleCodes);
    
    await client.query('COMMIT');
    console.log('🎉 Database seeding completed successfully!');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Seeding failed:', error);
    throw error;
  } finally {
    client.release();
  }
};

// Run seeding
seedDatabase()
  .then(() => {
    console.log('✅ Database seeded successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Seeding error:', error);
    process.exit(1);
  });
