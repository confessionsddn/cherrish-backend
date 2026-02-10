//routes/auth.js - COMPLETE FIXED VERSION
import express from 'express';
import passport from '../middleware/auth.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { query } from '../config/database.js';
import { logManualActivity } from '../middleware/activity-logger.js';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const router = express.Router();

// Temporary storage for pending registrations
const pendingRegistrations = new Map();

// Clean up old pending registrations every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of pendingRegistrations.entries()) {
    if (now - value.timestamp > 600000) { // 10 minutes
      pendingRegistrations.delete(key);
    }
  }
}, 300000);

// ============================================
// HELPER: Get next available user number (SKIP RESERVED)
// ============================================
async function getNextUserNumber() {
  try {
    // Get the highest user number
    const maxResult = await query(
      'SELECT MAX(user_number) as max_num FROM users'
    );
    
    let nextNumber = (maxResult.rows[0].max_num || 0) + 1;
    
    // Keep incrementing until we find a non-reserved number
    let attempts = 0;
    while (attempts < 100) { // Safety limit
      const reservedCheck = await query(
        `SELECT number FROM rare_numbers 
         WHERE number = $1 AND is_available = false`,
        [nextNumber]
      );
      
      if (reservedCheck.rows.length === 0) {
        // Number is NOT reserved, use it!
        console.log(`✅ Assigned user number: #${nextNumber}`);
        return nextNumber;
      }
      
      // Number is reserved, try next
      console.log(`⏭️ Skipping reserved number: ${nextNumber}`);
      nextNumber++;
      attempts++;
    }
    
    // Fallback if something goes wrong
    console.warn('⚠️ Reached attempt limit, using fallback');
    return nextNumber;
    
  } catch (error) {
    console.error('Get next user number error:', error);
    // Fallback to simple increment
    const maxResult = await query('SELECT MAX(user_number) as max_num FROM users');
    return (maxResult.rows[0].max_num || 0) + 1;
  }
}

// Helper function to generate random username
function generateRandomUsername() {
  const adjectives = ['PINK', 'DARK', 'WILD', 'COOL', 'SHY', 'BRAVE', 'CALM', 'SWIFT'];
  const nouns = ['LION', 'MOON', 'STAR', 'WAVE', 'SPARK', 'FIRE', 'WIND', 'STORM'];
  const randomNum = Math.floor(Math.random() * 9999);
  
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  
  return `${adj}_${noun}${randomNum}`;
}

// ============================================
// ROUTES
// ============================================

// Register with access code (Step 1 - Verify code exists)
router.post('/register/verify-code', async (req, res) => {
  try {
    const { accessCode } = req.body;
    
    if (!accessCode) {
      return res.status(400).json({ error: 'Access code is required' });
    }
    
    // Check if access code exists and is not used
    const codeResult = await query(
      'SELECT * FROM access_codes WHERE code = $1 AND is_used = false',
      [accessCode]
    );
    
    if (codeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid or already used access code' });
    }
    
    const code = codeResult.rows[0];
    
    // Check if code is expired
    if (code.expires_at && new Date(code.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Access code has expired' });
    }
    
    res.json({
      success: true,
      message: 'Access code verified! You can now sign in with Google.',
      codeId: code.id
    });
    
  } catch (error) {
    console.error('Verify code error:', error);
    res.status(500).json({ error: 'Failed to verify access code' });
  }
});

// Complete registration with access code and Google data
router.post('/register/complete-oauth', async (req, res) => {
  try {
    const { accessCode, email, googleId } = req.body;
    
    if (!accessCode || !email || !googleId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Verify access code
    const codeResult = await query(
      'SELECT * FROM access_codes WHERE code = $1 AND is_used = false',
      [accessCode]
    );
    
    if (codeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid or already used access code' });
    }
    
    // Check if user already exists
    const existingUser = await query(
      'SELECT * FROM users WHERE google_id = $1 OR email = $2',
      [googleId, email]
    );
    
    if (existingUser.rows.length > 0) {
      const user = existingUser.rows[0];
      const token = generateToken(user);
      return res.json({
        success: true,
        message: 'User already exists',
        token,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          user_number: user.user_number,
          credits: user.credits,
          is_premium: user.is_premium
        }
      });
    }
    
    // Generate random username
    const randomUsername = generateRandomUsername();
    
    // Get next user number (SKIPS RESERVED)
    const userNumber = await getNextUserNumber();
    
    // Create user
    const newUser = await query(
      `INSERT INTO users (google_id, email, username, user_number, credits)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, username, user_number, credits, is_premium, created_at`,
      [googleId, email, randomUsername, userNumber, parseInt(process.env.INITIAL_CREDITS) || 150]
    );
    
    // Mark access code as used
    await query(
      'UPDATE access_codes SET is_used = true, used_by_user_id = $1, used_at = NOW() WHERE code = $2',
      [newUser.rows[0].id, accessCode]
    );
    
    const user = newUser.rows[0];
    
    // Log registration activity
    if (logManualActivity) {
      await logManualActivity(user.id, 'registration', { 
        email, 
        user_number: userNumber,
        access_code: accessCode 
      });
    }
    
    const token = generateToken(user);
    
    console.log('✅ New user registered:', user.email, user.username, `#${userNumber}`);
    
    res.status(201).json({
      success: true,
      message: 'Registration successful!',
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        user_number: user.user_number,
        credits: user.credits,
        is_premium: user.is_premium
      }
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Google OAuth login
router.get('/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false
  })
);

// Google OAuth callback
router.get('/google/callback', (req, res, next) => {
  passport.authenticate('google', { session: false }, async (err, user) => {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    
    try {
      if (err) {
        console.error('❌ OAuth error:', err);
        return res.redirect(`${frontendUrl}/?error=auth_failed`);
      }
      
      // User doesn't exist - needs registration with access code
      if (!user) {
        console.log('⚠️ New user - redirecting to access code page');
        
        // Get OAuth profile from request
        const profile = req.oauthProfile;
        
        if (!profile || !profile.email || !profile.googleId) {
          console.error('❌ No OAuth profile data');
          return res.redirect(`${frontendUrl}/?error=oauth_failed`);
        }
        
        console.log('📧 Profile data:', profile);
        
        // Pass email and googleId via URL parameters (base64 encoded for safety)
        const dataString = JSON.stringify({
          email: profile.email,
          googleId: profile.googleId
        });
        const encodedData = Buffer.from(dataString).toString('base64');
        
        return res.redirect(`${frontendUrl}/access-code?data=${encodedData}`);
      }
      
      // User exists - generate token and login
      console.log('✅ User logged in:', user.email, user.username);
      
      // Log login activity
      if (logManualActivity) {
        await logManualActivity(user.id, 'login', { method: 'google_oauth' });
      }
      
      const token = generateToken(user);
      return res.redirect(`${frontendUrl}/auth/callback?token=${token}`);
      
    } catch (error) {
      console.error('❌ OAuth callback error:', error);
      return res.redirect(`${frontendUrl}/?error=auth_failed`);
    }
  })(req, res, next);
});

// Get current user
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Update last_login and last_activity (async, don't wait)
    query(
      'UPDATE users SET last_login = NOW(), last_activity = NOW() WHERE id = $1',
      [decoded.id]
    ).catch(err => console.error('Last login update failed:', err));
    
    const userResult = await query(
      `SELECT id, email, username, user_number, credits, is_premium, is_banned, is_admin, 
              ban_until, created_at, last_login, last_activity, username_changed
       FROM users WHERE id = $1`,
      [decoded.id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Get premium subscription data if user is premium
    let premiumData = null;
    if (user.is_premium) {
      const premiumResult = await query(
        `SELECT spotlight_12h_remaining, boost_12h_remaining, spotlight_uses_remaining
         FROM premium_subscriptions 
         WHERE user_id = $1 AND is_active = true AND end_date > NOW()
         ORDER BY end_date DESC LIMIT 1`,
        [decoded.id]
      );
      
      if (premiumResult.rows.length > 0) {
        premiumData = premiumResult.rows[0];
      }
    }
    
    res.json({ 
      user: {
        ...user,
        premium_data: premiumData
      }
    });
    
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user data' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

// Change username (Premium: FREE once, Free user: 200 credits once)
router.post('/change-username', authenticateToken, async (req, res) => {
  try {
    const { new_username } = req.body;
    const userId = req.user.id;
    
    if (!new_username || new_username.trim().length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }
    
    if (new_username.trim().length > 20) {
      return res.status(400).json({ error: 'Username must be less than 20 characters' });
    }
    
    // Check if username is taken
    const existingUser = await query(
      'SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2',
      [new_username.trim(), userId]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Username already taken!' });
    }
    
    // Get user data
    const userResult = await query(
      'SELECT username, credits, is_premium, username_changed FROM users WHERE id = $1',
      [userId]
    );
    
    const user = userResult.rows[0];
    const oldUsername = user.username;
    
    // Check if already changed
    if (user.username_changed) {
      return res.status(400).json({ 
        error: 'Username already changed!',
        message: 'You can only change your username once in a lifetime.'
      });
    }
    
    const isPremium = user.is_premium;
    const cost = isPremium ? 0 : 200;
    
    // Check credits for free users
    if (!isPremium && user.credits < cost) {
      return res.status(400).json({
        error: `Not enough credits! You need ${cost} credits.`,
        required: cost,
        current: user.credits
      });
    }
    
    // Deduct credits for free users
    if (cost > 0) {
      await query(
        'UPDATE users SET credits = credits - $1 WHERE id = $2',
        [cost, userId]
      );
      
      await query(
        `INSERT INTO credit_transactions (user_id, amount, type, description)
         VALUES ($1, $2, 'spent', 'Changed username')`,
        [userId, -cost]
      );
    }
    
    // Save username history
    await query(
      `INSERT INTO username_history (user_id, old_username, new_username, changed_by)
       VALUES ($1, $2, $3, 'user')`,
      [userId, oldUsername, new_username.trim()]
    );
    
    // Update username and mark as changed
    await query(
      'UPDATE users SET username = $1, username_changed = true WHERE id = $2',
      [new_username.trim(), userId]
    );
    
    // Log activity
    if (logManualActivity) {
      await logManualActivity(userId, 'username_change', { 
        old_username: oldUsername,
        new_username: new_username.trim(),
        cost
      }, null, -cost);
    }
    
    console.log(`✅ Username changed: ${oldUsername} -> ${new_username.trim()} (Cost: ${cost})`);
    
    // Get updated user data
    const updated = await query(
      'SELECT credits FROM users WHERE id = $1',
      [userId]
    );
    
    res.json({
      success: true,
      message: isPremium ? 'Username changed! (FREE for premium)' : `Username changed! (Cost: ${cost} credits)`,
      new_username: new_username.trim(),
      credits_remaining: updated.rows[0].credits,
      credits_spent: cost
    });
    
  } catch (error) {
    console.error('Change username error:', error);
    res.status(500).json({ error: 'Failed to change username' });
  }
});

// ADMIN: Manually assign reserved numbers
router.post('/admin/assign-rare-number', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { user_id, number } = req.body;
    
    // Check if number is in rare_numbers
    const numberCheck = await query(
      'SELECT * FROM rare_numbers WHERE number = $1',
      [number]
    );
    
    if (numberCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Not a rare number' });
    }
    
    // Check if already owned
    if (numberCheck.rows[0].current_owner_id) {
      return res.status(400).json({ error: 'Number already owned' });
    }
    
    // Get old user number for history
    const userResult = await query(
      'SELECT user_number FROM users WHERE id = $1',
      [user_id]
    );
    
    const oldNumber = userResult.rows[0].user_number;
    
    // Assign to user
    await query(
      'UPDATE users SET user_number = $1 WHERE id = $2',
      [number, user_id]
    );
    
    await query(
      'UPDATE rare_numbers SET is_available = false, current_owner_id = $1 WHERE number = $2',
      [user_id, number]
    );
    
    // Log activity
    if (logManualActivity) {
      await logManualActivity(user_id, 'rare_number_assigned', { 
        old_number: oldNumber,
        new_number: number,
        assigned_by: 'admin'
      });
    }
    
    console.log(`👑 Rare number #${number} assigned to user ${user_id}`);
    
    res.json({
      success: true,
      message: `Badge #${number} assigned!`
    });
    
  } catch (error) {
    console.error('Assign rare number error:', error);
    res.status(500).json({ error: 'Failed to assign number' });
  }
});

export default router;