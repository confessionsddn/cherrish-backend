// backend/middleware/rateLimit.js
import { query } from '../config/database.js';

// ============================================
// RATE LIMITING FOR CONFESSIONS
// 5 confessions per hour (free users only)
// Premium users bypass this limit
// ============================================

export const confessionRateLimit = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    // Check if user is premium
    const userResult = await query(
      'SELECT is_premium FROM users WHERE id = $1',
      [userId]
    );
    
    const isPremium = userResult.rows[0]?.is_premium;
    
    // Premium users bypass rate limit
    if (isPremium) {
      console.log(`👑 Premium user ${userId} - bypassing rate limit`);
      return next();
    }
    
    // Check rate limit
    const rateLimitResult = await query(
      `SELECT confessions_count, window_start FROM confession_rate_limits
       WHERE user_id = $1
       AND window_start > NOW() - INTERVAL '1 hour'`,
      [userId]
    );
    
    if (rateLimitResult.rows.length > 0) {
      const { confessions_count, window_start } = rateLimitResult.rows[0];
      
      // HARD LIMIT: 5 confessions per hour
      if (confessions_count >= 5) {
        const windowStart = new Date(window_start);
        const now = new Date();
        const elapsed = Math.floor((now - windowStart) / 1000); // seconds
        const timeLeft = Math.max(3600 - elapsed, 0); // seconds remaining
        
        const minutesLeft = Math.floor(timeLeft / 60);
        const secondsLeft = timeLeft % 60;
        
        console.log(`⏰ Rate limit hit for user ${userId}: ${confessions_count}/5 confessions`);
        
        return res.status(429).json({ 
          error: '⏰ CONFESSION LIMIT REACHED!',
          message: `You've posted 5 confessions. Please wait ${minutesLeft}m ${secondsLeft}s before posting again.`,
          confessions_posted: confessions_count,
          confessions_limit: 5,
          time_remaining_seconds: timeLeft,
          premium_message: 'Upgrade to Premium for unlimited confessions!'
        });
      }
      
      // Update count
      await query(
        `UPDATE confession_rate_limits
         SET confessions_count = confessions_count + 1,
             last_confession_at = NOW()
         WHERE user_id = $1`,
        [userId]
      );
      
      console.log(`✅ Rate limit OK: ${confessions_count + 1}/5 confessions for user ${userId}`);
      
    } else {
      // Create new window
      await query(
        `INSERT INTO confession_rate_limits (user_id, confessions_count, window_start, last_confession_at)
         VALUES ($1, 1, NOW(), NOW())
         ON CONFLICT (user_id) 
         DO UPDATE SET 
           confessions_count = CASE 
             WHEN confession_rate_limits.window_start < NOW() - INTERVAL '1 hour'
             THEN 1
             ELSE confession_rate_limits.confessions_count + 1
           END,
           window_start = CASE 
             WHEN confession_rate_limits.window_start < NOW() - INTERVAL '1 hour'
             THEN NOW()
             ELSE confession_rate_limits.window_start
           END,
           last_confession_at = NOW()`,
        [userId]
      );
      
      console.log(`✅ New rate limit window started for user ${userId}: 1/5 confessions`);
    }
    
    next();
    
  } catch (error) {
    console.error('❌ Rate limit middleware error:', error);
    // Don't block user if rate limit check fails
    next();
  }
};

// ============================================
// ADMIN FUNCTION: DISABLE RATE LIMITING
// Call this endpoint to make confessions unlimited
// ============================================

export const disableRateLimiting = async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin only' });
    }
    
    // Clear all rate limits
    await query('TRUNCATE TABLE confession_rate_limits');
    
    // Set a global flag (you can add this to a settings table)
    // For now, just return success
    
    console.log('🚀 RATE LIMITING DISABLED BY ADMIN');
    
    res.json({
      success: true,
      message: 'Rate limiting disabled! All users can now post unlimited confessions.'
    });
    
  } catch (error) {
    console.error('Error disabling rate limiting:', error);
    res.status(500).json({ error: 'Failed to disable rate limiting' });
  }
};

// ============================================
// CHECK RATE LIMIT STATUS (for frontend)
// ============================================

export const getRateLimitStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Check if premium
    const userResult = await query(
      'SELECT is_premium FROM users WHERE id = $1',
      [userId]
    );
    
    const isPremium = userResult.rows[0]?.is_premium;
    
    if (isPremium) {
      return res.json({
        success: true,
        is_premium: true,
        unlimited: true,
        confessions_posted: 0,
        confessions_remaining: 'Unlimited'
      });
    }
    
    // Get current rate limit
    const rateLimitResult = await query(
      `SELECT confessions_count, window_start FROM confession_rate_limits
       WHERE user_id = $1
       AND window_start > NOW() - INTERVAL '1 hour'`,
      [userId]
    );
    
    if (rateLimitResult.rows.length > 0) {
      const { confessions_count, window_start } = rateLimitResult.rows[0];
      
      const windowStart = new Date(window_start);
      const now = new Date();
      const elapsed = Math.floor((now - windowStart) / 1000);
      const timeLeft = Math.max(3600 - elapsed, 0);
      
      return res.json({
        success: true,
        is_premium: false,
        confessions_posted: confessions_count,
        confessions_remaining: Math.max(5 - confessions_count, 0),
        confessions_limit: 5,
        time_remaining_seconds: timeLeft,
        window_resets_at: new Date(windowStart.getTime() + 3600000)
      });
    } else {
      return res.json({
        success: true,
        is_premium: false,
        confessions_posted: 0,
        confessions_remaining: 5,
        confessions_limit: 5
      });
    }
    
  } catch (error) {
    console.error('Error getting rate limit status:', error);
    res.status(500).json({ error: 'Failed to get rate limit status' });
  }
};
