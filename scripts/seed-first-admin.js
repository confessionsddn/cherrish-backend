// One-time script: Creates an access code and makes the first user admin after registration
// Run with: node scripts/seed-first-admin.js
import pg from 'pg';
const { Client } = pg;
import dotenv from 'dotenv';
dotenv.config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000
});

async function seed() {
  await client.connect();
  console.log('✅ Connected\n');

  // Create an initial access code for the admin to register
  const code = 'LOVE2026-ADMIN-FIRST';
  
  await client.query(
    `INSERT INTO access_codes (code, is_used) VALUES ($1, false) ON CONFLICT (code) DO NOTHING`,
    [code]
  );
  console.log(`✅ Access code created: ${code}`);
  console.log('   Use this code to register on cherrish.in\n');

  // Check if admin user already exists (in case they already registered)
  const adminEmail = 'itmconfessionddn@gmail.com';
  const result = await client.query('SELECT id, email FROM users WHERE email = $1', [adminEmail]);
  
  if (result.rows.length > 0) {
    await client.query('UPDATE users SET is_admin = true WHERE email = $1', [adminEmail]);
    console.log(`✅ Admin privileges granted to: ${adminEmail}`);
  } else {
    console.log(`⚠️  User ${adminEmail} not found yet.`);
    console.log('   Register first using the access code above, then run this script again.');
    console.log('   Or just run: node scripts/add-admin-role.js after registering.\n');
  }

  await client.end();
  console.log('\n🎉 Done!');
  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
