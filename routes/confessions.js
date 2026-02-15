//confession.js
import express from 'express';
import { authenticateToken, optionalAuth } from '../middleware/auth.js';
import { query } from '../config/database.js';
import { uploadAudio } from '../config/cloudinary.js';
import multer from 'multer';

const router = express.Router();

// Configure multer for audio uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'));
    }
  }
});

// Helper function for voice cost
function calculateVoiceCost(duration) {
  let cost = 3; // First 10 seconds
  if (duration > 10) {
    const remaining = duration - 10;
    const additionalChunks = Math.ceil(remaining / 5);
    cost += additionalChunks * 4;
  }
  return cost;
}

// Get all approved confessions
// ============================================
// UPDATED GET CONFESSIONS ENDPOINT
// Update the router.get('/') in confessions.js to include total_impressions
// ============================================

// Get all approved confessions
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { mood_zone, limit = 50, offset = 0, sort = 'recent', user_only, filter_type } = req.query;
    
    let queryText = `
      SELECT 
        c.id,
        c.content,
        c.mood_zone,
        c.is_boosted,
        c.audio_url,
        c.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata' as created_at,
        c.heart_count,
        c.like_count,
        c.cry_count,
        c.laugh_count,
        c.status,
        c.trending_score,
        c.is_spotlight,
        c.spotlight_expires_at,
        c.boost_multiplier,
        c.boost_expires_at,
        c.views_count,
        c.total_impressions,  -- ADD THIS LINE
        c.user_id,
        u.username,
        u.user_number,
        u.is_premium as is_premium_user,
        (c.heart_count + c.like_count + c.cry_count + c.laugh_count) as total_reactions
      FROM confessions c
      JOIN users u ON c.user_id = u.id
      WHERE c.status = 'approved'
    `;
    
    const params = [];
    let paramIndex = 1;
    
    // Filter by user's own posts
    if ((user_only === 'true' || req.query.my_posts === 'true') && req.user) {
      queryText += ` AND c.user_id = $${paramIndex}`;
      params.push(req.user.id);
      paramIndex++;
    }
    
    // Filter by spotlight/boosted
    if (filter_type === 'spotlight') {
      queryText += ` AND c.is_spotlight = true AND c.spotlight_expires_at > NOW()`;
    } else if (filter_type === 'boosted') {
      queryText += ` AND c.boost_expires_at > NOW()`;
    }
    
    // Filter by mood zone
    if (mood_zone && mood_zone !== 'all') {
      queryText += ` AND c.mood_zone = $${paramIndex}`;
      params.push(mood_zone);
      paramIndex++;
    }
    
    // Sorting
    if (sort === 'trending') {
      queryText += ` ORDER BY 
        CASE WHEN c.boost_expires_at > NOW() THEN c.trending_score * c.boost_multiplier ELSE c.trending_score END DESC,
        c.created_at DESC`;
    } else {
      queryText += ` ORDER BY c.created_at DESC`;
    }
    
    queryText += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), parseInt(offset));
    
    const result = await query(queryText, params);
    
    // Format confessions
    const confessions = result.rows.map(confession => ({
      ...confession,
      timestamp: formatTimestamp(confession.created_at),
      reactions: {
        heart: confession.heart_count,
        like: confession.like_count,
        cry: confession.cry_count,
        laugh: confession.laugh_count
      },
      premium: confession.audio_url !== null,
      spotlight: confession.is_spotlight && new Date(confession.spotlight_expires_at) > new Date()
    }));
    
    res.json({ confessions });
    
  } catch (error) {
    console.error('Get confessions error:', error);
    res.status(500).json({ error: 'Failed to fetch confessions' });
  }
});

// Get single confession by ID
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query(
      `SELECT 
        c.id,
        c.content,
        c.mood_zone,
        c.is_boosted,
        c.audio_url,
        c.gender_revealed,
        c.gender,
        c.created_at,
        c.heart_count,
        c.like_count,
        c.cry_count,
        c.laugh_count,
        c.status,
        u.username,
        u.user_number
        FROM confessions c
        JOIN users u ON c.user_id = u.id
        WHERE c.id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Confession not found' });
    }
    
    const confession = result.rows[0];
    
    res.json({
      confession: {
        ...confession,
        timestamp: formatTimestamp(confession.created_at),
        reactions: {
          heart: confession.heart_count,
          like: confession.like_count,
          cry: confession.cry_count,
          laugh: confession.laugh_count
        }
      }
    });
    
  } catch (error) {
    console.error('Get confession error:', error);
    res.status(500).json({ error: 'Failed to fetch confession' });
  }
});


router.get('/:id/reactors', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { reaction_type } = req.query; // Optional: filter by type
    
    // Check if user is premium or owns the confession
    const userResult = await query(
      `SELECT is_premium FROM users WHERE id = $1`,
      [req.user.id]
    );
    
    const confessionResult = await query(
      `SELECT user_id FROM confessions WHERE id = $1`,
      [id]
    );
    
    const isPremium = userResult.rows[0]?.is_premium;
    const isOwner = confessionResult.rows[0]?.user_id === req.user.id;
    
    if (!isPremium && !isOwner) {
      return res.status(403).json({ 
        error: 'Premium feature',
        message: 'Upgrade to premium to see who reacted'
      });
    }
    
    // Fetch reactors
    let sqlQuery = `
      SELECT 
        username,
        user_number,
        is_premium,
        reaction_type,
        created_at
      FROM reactions
      WHERE confession_id = $1
    `;
    
    const params = [id];
    
    if (reaction_type) {
      sqlQuery += ` AND reaction_type = $2`;
      params.push(reaction_type);
    }
    
    sqlQuery += ` ORDER BY created_at DESC LIMIT 100`;
    
    const result = await query(sqlQuery, params);
    
    // Group by reaction type
    const grouped = result.rows.reduce((acc, row) => {
      if (!acc[row.reaction_type]) {
        acc[row.reaction_type] = [];
      }
      acc[row.reaction_type].push({
        username: row.username,
        user_number: row.user_number,
        is_premium: row.is_premium,
        reacted_at: row.created_at
      });
      return acc;
    }, {});
    
    res.json({
      success: true,
      reactors: grouped,
      total: result.rows.length
    });
    
  } catch (error) {
    console.error('Error fetching reactors:', error);
    res.status(500).json({ error: 'Failed to fetch reactors' });
  }
});
// Create new confession (with premium support)
// Create new confession (with premium support)
router.post('/', authenticateToken, upload.single('audio'), async (req, res) => {
  try {
    const { content, mood_zone, voice_duration } = req.body;
    const userId = req.user.id;
    
    if (!content || !mood_zone) {
      return res.status(400).json({ error: 'Content and mood zone are required' });
    }
    
    const validMoodZones = ['Crush', 'Heartbreak', 'Secret Admirer', 'Love Stories'];
    if (!validMoodZones.includes(mood_zone)) {
      return res.status(400).json({ error: 'Invalid mood zone' });
    }
    
    // --- FIX 1: Fetch username and user_number here ---
    const userResult = await query(
      'SELECT credits, is_premium, username, user_number FROM users WHERE id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
    }

    const userData = userResult.rows[0];
    const isPremium = userData.is_premium;
    
    // Calculate cost
// Calculate cost - TEXT IS FREE, ONLY VOICE COSTS CREDITS
// Calculate cost - TEXT IS FREE, ONLY VOICE COSTS CREDITS
let totalCost = 0;
let voiceCost = 0;
let voiceDuration = 0;

// Voice note pricing (ONLY IF VOICE IS ATTACHED)
if (req.file && voice_duration) {
  voiceDuration = parseInt(voice_duration);
  
  console.log(`🎤 Voice detected: ${voiceDuration} seconds`);
  
  if (voiceDuration > 0) {
    if (isPremium) {
      // Check premium daily voice
      const subCheck = await query(
        `SELECT daily_voice_used, last_reset_date FROM premium_subscriptions 
         WHERE user_id = $1 AND is_active = true AND end_date > NOW()
         ORDER BY end_date DESC LIMIT 1`,
        [userId]
      );
      
      if (subCheck.rows.length > 0) {
        const today = new Date().toISOString().split('T')[0];
        const lastReset = subCheck.rows[0].last_reset_date ? 
          new Date(subCheck.rows[0].last_reset_date).toISOString().split('T')[0] : 
          null;
        
        // New day or never used
        if (today !== lastReset || !subCheck.rows[0].daily_voice_used) {
          if (voiceDuration <= 30) {
            voiceCost = 0;
            console.log('👑 Premium: FREE 30s voice used');
          } else {
            const extraSeconds = voiceDuration - 30;
            voiceCost = calculateVoiceCost(extraSeconds);
            console.log(`👑 Premium: 30s FREE + ${extraSeconds}s = ${voiceCost} credits`);
          }
          
          // Mark as used
          await query(
            `UPDATE premium_subscriptions 
             SET daily_voice_used = true, last_reset_date = CURRENT_DATE
             WHERE user_id = $1 AND is_active = true`,
            [userId]
          );
        } else {
          // Already used today
          voiceCost = calculateVoiceCost(voiceDuration);
          console.log(`👑 Premium: Daily voice used, charging ${voiceCost} credits`);
        }
      } else {
        voiceCost = calculateVoiceCost(voiceDuration);
        console.log(`💰 Premium expired, charging ${voiceCost} credits`);
      }
    } else {
      // FREE USER - ALWAYS CHARGE
      voiceCost = calculateVoiceCost(voiceDuration);
      console.log(`💰 Free user: Charging ${voiceCost} credits for ${voiceDuration}s voice`);
    }
    
    totalCost = voiceCost;
  }
}

console.log(`💵 FINAL COST: ${totalCost} credits (Text: FREE, Voice: ${voiceCost})`);
    
    // Check credits
    if (userData.credits < totalCost) {
      return res.status(400).json({ 
        error: `Not enough credits! You need ${totalCost} credits.`,
        required: totalCost,
        current: userData.credits
      });
    }
    
    // Deduct credits
    if (totalCost > 0) {
      await query(
        'UPDATE users SET credits = credits - $1 WHERE id = $2',
        [totalCost, userId]
      );
      
      await query(
        `INSERT INTO credit_transactions (user_id, amount, type, description)
         VALUES ($1, $2, 'spent', $3)`,
        [userId, -totalCost, `Posted confession${voiceCost > 0 ? ` with voice` : ''}`]
      );
    }
    
    let audioUrl = null;
    
    // Upload audio
    if (req.file) {
      try {
        const result = await uploadAudio(
          req.file.buffer,
          `confession_${Date.now()}_${userId}`
        );
        audioUrl = result.secure_url;
      } catch (uploadError) {
        console.error('Audio upload error:', uploadError);
        if (voiceCost > 0) {
          await query('UPDATE users SET credits = credits + $1 WHERE id = $2', [voiceCost, userId]);
        }
      }
    }
    
    // Create confession
    const result = await query(
      `INSERT INTO confessions (user_id, content, mood_zone, audio_url, status)
       VALUES ($1, $2, $3, $4, 'approved')
       RETURNING id, content, mood_zone, audio_url, 
       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
       status, heart_count, like_count, cry_count, laugh_count`,
      [userId, content, mood_zone, audioUrl]
    );
    
    const confession = result.rows[0];
    
    console.log(`✅ Confession created (cost: ${totalCost} credits):`, userId);
    
    // --- FIX 2: Include username and user_number in response ---
    res.status(201).json({
      success: true,
      message: isPremium && totalCost === 0 ? 'Confession submitted! (FREE for premium)' : `Confession submitted! (Cost: ${totalCost} credits)`,
      credits_spent: totalCost,
      credits_remaining: userData.credits - totalCost,
      confession: {
        ...confession,
        username: userData.username,      // <--- ADDED
        user_number: userData.user_number, // <--- ADDED
        timestamp: formatTimestamp(new Date()), // Use local time for immediate feedback
        created_at: confession.created_at,      // Use DB time for logic
        reactions: {
          heart: 0,
          like: 0,
          cry: 0,
          laugh: 0
        },
        premium: confession.audio_url !== null,
        spotlight: false,
        is_premium_user: isPremium,
        is_own_confession: true // Useful for frontend logic
      }
    });
    
  } catch (error) {
    console.error('Create confession error:', error);
    res.status(500).json({ error: 'Failed to create confession' });
  }
}); 

// React to confession (NO TOGGLE)
// React to confession (NO TOGGLE)
router.post('/:id/react', authenticateToken, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { id } = req.params;
    const { reaction_type, action } = req.body;
    const userId = req.user.id;
    
    const validReactions = ['heart', 'like', 'cry', 'laugh'];
    if (!validReactions.includes(reaction_type)) {
      return res.status(400).json({ error: 'Invalid reaction type' });
    }
    
    const actionType = action || 'add';
    
    // REMOVE_ALL (Long Press)
    if (actionType === 'remove_all') {
      const deleteResult = await query(
        `DELETE FROM reactions 
         WHERE user_id = $1 AND confession_id = $2 AND reaction_type = $3
         RETURNING id`,
        [userId, id, reaction_type]
      );
      
      const removedCount = deleteResult.rows.length;
      
      if (removedCount > 0) {
        await query(
          `UPDATE confessions 
           SET ${reaction_type}_count = GREATEST(${reaction_type}_count - $1, 0) 
           WHERE id = $2`,
          [removedCount, id]
        );
      }
      
      const finalResult = await query(
        `SELECT heart_count, like_count, cry_count, laugh_count,
                (SELECT credits FROM users WHERE id = $1) as user_credits
         FROM confessions WHERE id = $2`,
        [userId, id]
      );
      
      const result = finalResult.rows[0];
      
      updateTrendingScore(id).catch(err => console.error('Trending error:', err));
      
      return res.json({
        success: true,
        action: 'removed_all',
        removed_count: removedCount,
        credits_refunded: 0,
        credits_remaining: result.user_credits,
        reactions: {
          heart: result.heart_count,
          like: result.like_count,
          cry: result.cry_count,
          laugh: result.laugh_count
        }
      });
    }
    
    // ADD REACTION - Check cooldown first
    const cooldownCheck = await query(
      `SELECT total_reactions, window_start FROM reaction_cooldowns 
       WHERE user_id = $1 
       AND window_start > NOW() - INTERVAL '1 minute'`,
      [userId]
    );
    
    if (cooldownCheck.rows.length > 0) {
      const cooldown = cooldownCheck.rows[0];
      
      if (cooldown.total_reactions >= 20) {
        const windowStart = new Date(cooldown.window_start);
        const now = new Date();
        const elapsed = Math.floor((now - windowStart) / 1000);
        const timeLeft = Math.max(60 - elapsed, 0);
        
        return res.status(429).json({ 
          error: `⏰ YOU CAN REACT ONLY 20 TIMES PER MINUTE! Wait ${timeLeft}s.`,
          cooldown_seconds: timeLeft,
          reactions_used: cooldown.total_reactions,
          reactions_limit: 20
        });
      }
    }
    
    // Check credits
    const userResult = await query(
      `SELECT credits FROM users WHERE id = $1`,
      [userId]
    );
    
    if (userResult.rows[0].credits < 1) {
      return res.status(400).json({ 
        error: 'Not enough credits! Need 1 credit to react.',
        required: 1,
        current: userResult.rows[0].credits
      });
    }
    
    // Add reaction (atomic operations)
    await query(
      `INSERT INTO reactions (user_id, confession_id, reaction_type) 
       VALUES ($1, $2, $3)`,
      [userId, id, reaction_type]
    );
    
    await query(
      `UPDATE confessions 
       SET ${reaction_type}_count = ${reaction_type}_count + 1 
       WHERE id = $1`,
      [id]
    );
    
    await query(
      `UPDATE users SET credits = credits - 1 WHERE id = $1`,
      [userId]
    );
    
    await query(
      `INSERT INTO credit_transactions (user_id, amount, type, description)
       VALUES ($1, -1, 'spent', $2)`,
      [userId, `Reacted ${reaction_type}`]
    );
    
    // Update cooldown
    try {
      await query(
        `INSERT INTO reaction_cooldowns (user_id, total_reactions, window_start, last_reaction_at)
         VALUES ($1, 1, NOW(), NOW())
         ON CONFLICT (user_id) 
         DO UPDATE SET 
           total_reactions = CASE 
             WHEN reaction_cooldowns.window_start < NOW() - INTERVAL '1 minute'
             THEN 1
             ELSE reaction_cooldowns.total_reactions + 1
           END,
           window_start = CASE 
             WHEN reaction_cooldowns.window_start < NOW() - INTERVAL '1 minute'
             THEN NOW()
             ELSE reaction_cooldowns.window_start
           END,
           last_reaction_at = NOW()`,
        [userId]
      );
    } catch (cooldownError) {
      console.error('Cooldown update error (non-critical):', cooldownError);
    }
    
    const duration = Date.now() - startTime;
    console.log(`✅ Reaction added (${duration}ms):`, userId, '->', id, `(${reaction_type})`);
    
    // Get final counts
    const finalResult = await query(
      `SELECT heart_count, like_count, cry_count, laugh_count,
              (SELECT credits FROM users WHERE id = $1) as user_credits
       FROM confessions WHERE id = $2`,
      [userId, id]
    );
    
    const result = finalResult.rows[0];
    
    // Update trending (async)
    updateTrendingScore(id).catch(err => console.error('Trending error:', err));
    
    // Cleanup old cooldowns async
    query(`DELETE FROM reaction_cooldowns 
           WHERE window_start < NOW() - INTERVAL '2 minutes'`)
      .catch(err => console.error('Cooldown cleanup error:', err));
    
    res.json({
      success: true,
      action: 'added',
      credits_spent: 1,
      credits_remaining: result.user_credits,
      reactions: {
        heart: result.heart_count,
        like: result.like_count,
        cry: result.cry_count,
        laugh: result.laugh_count
      }
    });
    
  } catch (error) {
    console.error('❌ React error:', error);
    res.status(500).json({ 
      error: 'Failed to react', 
      details: error.message
    });
  }
});


// Report confession
router.post('/:id/report', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, details } = req.body;
    
    const validReasons = ['spam', 'harassment', 'inappropriate', 'false_info', 'other'];
    
    if (!validReasons.includes(reason)) {
      return res.status(400).json({ error: 'Invalid reason' });
    }
    
    const existing = await query(
      'SELECT * FROM confession_reports WHERE confession_id = $1 AND reported_by = $2',
      [id, req.user.id]
    );
    
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'You have already reported this confession' });
    }
    
    await query(
      `INSERT INTO confession_reports (confession_id, reported_by, reason, details)
       VALUES ($1, $2, $3, $4)`,
      [id, req.user.id, reason, details || null]
    );
    
    console.log('🚩 Confession reported:', id, 'Reason:', reason);
    
    res.json({
      success: true,
      message: 'Report submitted. Admin will review it shortly.'
    });
    
  } catch (error) {
    console.error('Report error:', error);
    res.status(500).json({ error: 'Failed to report confession' });
  }
});

// Delete confession
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const confessionResult = await query(
      'SELECT user_id, audio_url, status FROM confessions WHERE id = $1',
      [id]
    );
    
    if (confessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Confession not found' });
    }
    
    if (confessionResult.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'You can only delete your own confessions' });
    }
    
    await query('UPDATE users SET credits = credits + 5 WHERE id = $1', [userId]);
    await query('DELETE FROM confessions WHERE id = $1', [id]);
    
    res.json({
      success: true,
      message: 'Confession deleted successfully. 5 credits refunded.'
    });
    
  } catch (error) {
    console.error('Delete confession error:', error);
    res.status(500).json({ error: 'Failed to delete confession' });
  }
});

// Helper: Update trending score
async function updateTrendingScore(confessionId) {
  try {
    const result = await query(
      `SELECT 
        created_at,
        heart_count,
        like_count,
        cry_count,
        laugh_count
       FROM confessions
       WHERE id = $1`,
      [confessionId]
    );
    
    if (result.rows.length === 0) return;
    
    const confession = result.rows[0];
    const now = new Date();
    const ageInHours = (now - new Date(confession.created_at)) / (1000 * 60 * 60);
    
    const totalReactions = 
      (confession.heart_count * 3) +
      (confession.like_count * 2) +
      (confession.cry_count * 2) +
      (confession.laugh_count * 1);
    
    const ageFactor = Math.max(1, ageInHours);
    const trendingScore = totalReactions / Math.pow(ageFactor, 1.5);
    
    await query(
      'UPDATE confessions SET trending_score = $1 WHERE id = $2',
      [trendingScore, confessionId]
    );
    
  } catch (error) {
    console.error('Update trending score error:', error);
  }
}

// Helper function to format timestamp - REAL-TIME VERSION
function formatTimestamp(date) {
  const now = new Date();
  const confessionDate = new Date(date);
  const diffMs = now - confessionDate;
  const diffSeconds = Math.floor(diffMs / 1000);
  
  if (diffSeconds < 0) return 'JUST NOW'; // Future dates
  if (diffSeconds < 10) return 'JUST NOW';
  if (diffSeconds < 60) return `${diffSeconds} SECONDS AGO`;
  
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes === 1) return '1 MINUTE AGO';
  if (diffMinutes < 60) return `${diffMinutes} MINUTES AGO`;
  
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours === 1) return '1 HOUR AGO';
  if (diffHours < 24) return `${diffHours} HOURS AGO`;
  
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'YESTERDAY';
  if (diffDays < 7) return `${diffDays} DAYS AGO`;
  
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks === 1) return '1 WEEK AGO';
  if (diffWeeks < 4) return `${diffWeeks} WEEKS AGO`;
  
  // For older than 4 weeks, show actual date
  return confessionDate.toLocaleDateString('en-IN', { 
    day: 'numeric', 
    month: 'short', 
    year: 'numeric' 
  });
}

// Boost confession (Premium only - 10 per month)
router.post('/:id/boost', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Check if user owns this confession
    const confessionCheck = await query(
      'SELECT user_id, is_boosted FROM confessions WHERE id = $1',
      [id]
    );
    
    if (confessionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Confession not found' });
    }
    
    if (confessionCheck.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'You can only boost your own confessions' });
    }
    
    if (confessionCheck.rows[0].is_boosted) {
      return res.status(400).json({ error: 'This confession is already boosted!' });
    }
    
    // Check premium status and spotlight uses
    const premiumCheck = await query(
      `SELECT spotlight_uses_remaining, is_active, end_date 
       FROM premium_subscriptions 
       WHERE user_id = $1 AND is_active = true AND end_date > NOW()`,
      [userId]
    );
    
    if (premiumCheck.rows.length === 0) {
      return res.status(403).json({ 
        error: 'Premium subscription required!',
        message: 'Subscribe to AURA PASS to use spotlight boosts'
      });
    }
    
    const remaining = premiumCheck.rows[0].spotlight_uses_remaining;
    
    if (remaining <= 0) {
      return res.status(400).json({ 
        error: 'No spotlight boosts remaining!',
        message: 'Your monthly boosts will reset on subscription renewal'
      });
    }
    
    // Apply boost (24 hours)
    const boostExpiry = new Date();
    boostExpiry.setHours(boostExpiry.getHours() + 24);
    
    await query(
      'UPDATE confessions SET is_boosted = true, boost_expires_at = $1 WHERE id = $2',
      [boostExpiry, id]
    );
    
    // Deduct one spotlight use
    await query(
      'UPDATE premium_subscriptions SET spotlight_uses_remaining = spotlight_uses_remaining - 1 WHERE user_id = $1',
      [userId]
    );
    
    console.log(`⭐ Spotlight boosted: ${userId} | Remaining: ${remaining - 1}`);
    
    res.json({
      success: true,
      message: 'Confession boosted to spotlight! 🌟',
      spotlight_remaining: remaining - 1,
      boost_expires_at: boostExpiry
    });
    
  } catch (error) {
    console.error('Boost error:', error);
    res.status(500).json({ error: 'Failed to boost confession' });
  }
});

// Track view (one per user per confession)
// ============================================
// UPDATED VIEW TRACKING ENDPOINT
// Replace the existing router.post('/:id/view') in confessions.js
// ============================================

// Track view - EVERY scroll counts!
router.post('/:id/view', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // ALWAYS insert a new view record (no conflict check)
    await query(
      `INSERT INTO confession_views (confession_id, user_id, viewed_at)
       VALUES ($1, $2, NOW())`,
      [id, userId]
    );
    
    // ALWAYS increment total_impressions
    await query(
      `UPDATE confessions 
       SET total_impressions = total_impressions + 1 
       WHERE id = $1`,
      [id]
    );
    
    // Check if this is a UNIQUE view (first time this user viewed)
    const uniqueViewCheck = await query(
      `SELECT COUNT(*) as view_count 
       FROM confession_views 
       WHERE confession_id = $1 AND user_id = $2`,
      [id, userId]
    );
    
    const isFirstView = uniqueViewCheck.rows[0].view_count === 1;
    
    // If first view, increment unique views_count
    if (isFirstView) {
      await query(
        `UPDATE confessions 
         SET views_count = views_count + 1 
         WHERE id = $1`,
        [id]
      );
    }
    
    // Get updated counts
    const countResult = await query(
      `SELECT views_count, total_impressions 
       FROM confessions 
       WHERE id = $1`,
      [id]
    );
    
    res.json({
      success: true,
      views_count: countResult.rows[0].views_count,
      total_impressions: countResult.rows[0].total_impressions,
      is_new_view: isFirstView
    });
    
  } catch (error) {
    console.error('View tracking error:', error);
    res.status(500).json({ error: 'Failed to track view' });
  }
});


export default router;
