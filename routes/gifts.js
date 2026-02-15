// backend/routes/gifts.js
import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { query, getClient } from '../config/database.js';

const router = express.Router();

// ============================================
// GIFT CONFIGURATION
// ============================================

const GIFT_CATALOG = {
  // EFFECTS (Awards)
  gold_hearts: { name: 'Sparkle Hearts', price: 25, type: 'effect', theme: 'sparkle', unlock_at: 50 },
  cyber_glitch: { name: 'Cyber Glitch', price: 35, type: 'effect', theme: 'cyber', unlock_at: 50 },
  holo_foil: { name: 'Holo Foil', price: 50, type: 'effect', theme: 'holo', unlock_at: 50 },
  sunset_bg: { name: 'Vaporwave', price: 40, type: 'effect', theme: 'vaporwave', unlock_at: 50 },
  starry_night: { name: 'Galactic Mode', price: 45, type: 'effect', theme: 'galaxy', unlock_at: 50 },
  retro_vhs: { name: 'Retro VHS', price: 30, type: 'effect', theme: 'retro', unlock_at: 50 },
  
  // PHYSICAL GIFTS
  roses: { name: 'Mega Bouquet', price: 20, type: 'gift', theme: 'rose', unlock_at: 50 },
  ring: { name: 'Diamond Ring', price: 100, type: 'gift', theme: 'diamond', unlock_at: 50 },
  chocolates: { name: 'Luxury Box', price: 15, type: 'gift', theme: 'chocolate', unlock_at: 50 },
  teddy: { name: 'Giant Teddy', price: 40, type: 'gift', theme: 'teddy', unlock_at: 50 },
  mixtape: { name: 'Lo-Fi Mixtape', price: 15, type: 'gift', theme: 'lofi', unlock_at: 50 },
  poem: { name: 'Epic Poem', price: 25, type: 'gift', theme: 'poem', unlock_at: 50 }
};

// ============================================
// SEND GIFT TO CONFESSION
// ============================================

router.post('/send', authenticateToken, async (req, res) => {
  try {
    const { confession_id, gift_type, message } = req.body;
    const senderId = req.user.id;
    
    // Validate gift type
    if (!GIFT_CATALOG[gift_type]) {
      return res.status(400).json({ error: 'Invalid gift type' });
    }
    
    const gift = GIFT_CATALOG[gift_type];
    
    // Check if confession exists
    const confessionResult = await query(
      'SELECT id, user_id FROM confessions WHERE id = $1 AND status = $\'approved\'',
      [confession_id]
    );
    
    if (confessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Confession not found' });
    }
    
    const recipientId = confessionResult.rows[0].user_id;
    
    // Can't gift your own confession
    if (recipientId === senderId) {
      return res.status(400).json({ error: 'You cannot gift your own confession!' });
    }
    
    // Check sender has enough credits
    const senderResult = await query(
      'SELECT credits, username, user_number FROM users WHERE id = $1',
      [senderId]
    );
    
    if (senderResult.rows[0].credits < gift.price) {
      return res.status(400).json({ 
        error: `Not enough credits! You need ${gift.price} credits.`,
        required: gift.price,
        current: senderResult.rows[0].credits
      });
    }
    
    const client = await getClient();
    
    try {
      await client.query('BEGIN');
      
      // Deduct credits from sender
      await client.query(
        'UPDATE users SET credits = credits - $1 WHERE id = $2',
        [gift.price, senderId]
      );
      
      // Log transaction
      await client.query(
        `INSERT INTO credit_transactions (user_id, amount, type, description)
         VALUES ($1, $2, 'spent', $3)`,
        [senderId, -gift.price, `Sent ${gift.name} gift`]
      );
      
      // Create gift record
      const giftResult = await client.query(
        `INSERT INTO confession_gifts (confession_id, sender_id, gift_type, gift_price, message)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, created_at`,
        [confession_id, senderId, gift_type, gift.price, message || null]
      );
      
      // Update recipient's gift inventory
      const inventoryResult = await client.query(
        `INSERT INTO user_gift_inventory (user_id, gift_type, total_received)
         VALUES ($1, $2, 1)
         ON CONFLICT (user_id, gift_type)
         DO UPDATE SET total_received = user_gift_inventory.total_received + 1
         RETURNING total_received`,
        [recipientId, gift_type]
      );
      
      const totalReceived = inventoryResult.rows[0].total_received;
      
      // Check if theme unlocked
      let themeUnlocked = false;
      if (totalReceived >= gift.unlock_at) {
        // Unlock theme
        await client.query(
          `INSERT INTO user_active_themes (user_id, theme_name, is_active)
           VALUES ($1, $2, false)
           ON CONFLICT (user_id, theme_name) DO NOTHING`,
          [recipientId, gift.theme]
        );
        
        await client.query(
          `UPDATE user_gift_inventory 
           SET unlocked_theme = true 
           WHERE user_id = $1 AND gift_type = $2`,
          [recipientId, gift_type]
        );
        
        themeUnlocked = true;
      }
      
      await client.query('COMMIT');
      
      console.log(`🎁 Gift sent: ${gift.name} from ${senderId} to ${recipientId}`);
      
      // Create notification (we'll implement OneSignal in next batch)
      await query(
        `INSERT INTO notification_queue (user_id, notification_type, title, message, data)
         VALUES ($1, 'gift', $2, $3, $4)`,
        [
          recipientId,
          '🎁 Gift Received!',
          `${senderResult.rows[0].username} sent you ${gift.name}!`,
          JSON.stringify({
            confession_id,
            gift_type,
            sender_username: senderResult.rows[0].username,
            sender_user_number: senderResult.rows[0].user_number,
            theme_unlocked: themeUnlocked,
            total_received: totalReceived
          })
        ]
      );
      
      res.json({
        success: true,
        message: `${gift.name} sent successfully!`,
        gift_id: giftResult.rows[0].id,
        credits_spent: gift.price,
        credits_remaining: senderResult.rows[0].credits - gift.price,
        recipient_progress: {
          total_received: totalReceived,
          needed_for_theme: gift.unlock_at,
          theme_unlocked: themeUnlocked,
          theme_name: gift.theme
        }
      });
      
    } catch (dbError) {
      await client.query('ROLLBACK');
      throw dbError;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('Send gift error:', error);
    res.status(500).json({ error: 'Failed to send gift' });
  }
});

// ============================================
// GET GIFTS ON A CONFESSION
// ============================================

router.get('/confession/:confessionId', authenticateToken, async (req, res) => {
  try {
    const { confessionId } = req.params;
    
    // Get all gifts
    const result = await query(
      `SELECT 
        g.id,
        g.gift_type,
        g.gift_price,
        g.message,
        g.created_at,
        u.username as sender_username,
        u.user_number as sender_user_number,
        u.is_premium as sender_is_premium
       FROM confession_gifts g
       JOIN users u ON g.sender_id = u.id
       WHERE g.confession_id = $1
       ORDER BY g.created_at DESC`,
      [confessionId]
    );
    
    // Check if current user is confession owner or premium
    const confessionResult = await query(
      'SELECT user_id FROM confessions WHERE id = $1',
      [confessionId]
    );
    
    const userResult = await query(
      'SELECT is_premium FROM users WHERE id = $1',
      [req.user.id]
    );
    
    const isOwner = confessionResult.rows[0]?.user_id === req.user.id;
    const isPremium = userResult.rows[0]?.is_premium;
    
    // Hide sender info if not owner and not premium
    const gifts = result.rows.map(gift => {
      if (!isOwner && !isPremium) {
        return {
          ...gift,
          sender_username: 'Anonymous',
          sender_user_number: null,
          sender_is_premium: false
        };
      }
      return gift;
    });
    
    // Group by gift type
    const giftCounts = {};
    gifts.forEach(gift => {
      if (!giftCounts[gift.gift_type]) {
        giftCounts[gift.gift_type] = 0;
      }
      giftCounts[gift.gift_type]++;
    });
    
    res.json({
      success: true,
      gifts,
      gift_counts: giftCounts,
      total_gifts: gifts.length,
      can_see_senders: isOwner || isPremium
    });
    
  } catch (error) {
    console.error('Get gifts error:', error);
    res.status(500).json({ error: 'Failed to get gifts' });
  }
});

// ============================================
// GET USER'S GIFT INVENTORY
// ============================================

router.get('/inventory', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await query(
      `SELECT 
        gift_type,
        total_received,
        unlocked_theme
       FROM user_gift_inventory
       WHERE user_id = $1`,
      [userId]
    );
    
    // Format with progress
    const inventory = result.rows.map(item => {
      const giftInfo = GIFT_CATALOG[item.gift_type];
      return {
        gift_type: item.gift_type,
        gift_name: giftInfo.name,
        total_received: item.total_received,
        needed_for_unlock: giftInfo.unlock_at,
        remaining: Math.max(giftInfo.unlock_at - item.total_received, 0),
        progress_percentage: Math.min((item.total_received / giftInfo.unlock_at) * 100, 100),
        theme_unlocked: item.unlocked_theme,
        theme_name: giftInfo.theme
      };
    });
    
    res.json({
      success: true,
      inventory
    });
    
  } catch (error) {
    console.error('Get inventory error:', error);
    res.status(500).json({ error: 'Failed to get inventory' });
  }
});

// ============================================
// GET USER'S UNLOCKED THEMES
// ============================================

router.get('/themes', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await query(
      `SELECT 
        theme_name,
        is_active,
        unlocked_at
       FROM user_active_themes
       WHERE user_id = $1`,
      [userId]
    );
    
    res.json({
      success: true,
      themes: result.rows
    });
    
  } catch (error) {
    console.error('Get themes error:', error);
    res.status(500).json({ error: 'Failed to get themes' });
  }
});

// ============================================
// TOGGLE THEME ON/OFF
// ============================================

router.post('/themes/toggle', authenticateToken, async (req, res) => {
  try {
    const { theme_name, is_active } = req.body;
    const userId = req.user.id;
    
    // Check if user has this theme
    const themeResult = await query(
      'SELECT theme_name FROM user_active_themes WHERE user_id = $1 AND theme_name = $2',
      [userId, theme_name]
    );
    
    if (themeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Theme not unlocked' });
    }
    
    // If activating, deactivate all other themes first (only one active at a time)
    if (is_active) {
      await query(
        'UPDATE user_active_themes SET is_active = false WHERE user_id = $1',
        [userId]
      );
    }
    
    // Toggle theme
    await query(
      `UPDATE user_active_themes 
       SET is_active = $1 
       WHERE user_id = $2 AND theme_name = $3`,
      [is_active, userId, theme_name]
    );
    
    res.json({
      success: true,
      message: is_active ? `${theme_name} theme activated!` : `${theme_name} theme deactivated`,
      theme_name,
      is_active
    });
    
  } catch (error) {
    console.error('Toggle theme error:', error);
    res.status(500).json({ error: 'Failed to toggle theme' });
  }
});

// ============================================
// LEADERBOARD: MOST GIFTED CONFESSIONS
// ============================================

router.get('/leaderboard/confessions', async (req, res) => {
  try {
    const result = await query(
      `SELECT 
        c.id,
        c.content,
        c.mood_zone,
        u.username,
        u.user_number,
        COUNT(g.id) as gift_count,
        SUM(g.gift_price) as total_value
       FROM confessions c
       JOIN confession_gifts g ON c.id = g.confession_id
       JOIN users u ON c.user_id = u.id
       WHERE c.status = 'approved'
       GROUP BY c.id, c.content, c.mood_zone, u.username, u.user_number
       ORDER BY gift_count DESC
       LIMIT 10`
    );
    
    res.json({
      success: true,
      leaderboard: result.rows
    });
    
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
});

// ============================================
// LEADERBOARD: TOP GIFTERS
// ============================================

router.get('/leaderboard/gifters', async (req, res) => {
  try {
    const result = await query(
      `SELECT 
        u.id,
        u.username,
        u.user_number,
        COUNT(g.id) as total_gifts_sent,
        SUM(g.gift_price) as credits_spent
       FROM users u
       JOIN confession_gifts g ON u.id = g.sender_id
       GROUP BY u.id, u.username, u.user_number
       ORDER BY total_gifts_sent DESC
       LIMIT 10`
    );
    
    res.json({
      success: true,
      leaderboard: result.rows
    });
    
  } catch (error) {
    console.error('Gifters leaderboard error:', error);
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
});

// ============================================
// GET GIFT CATALOG (for frontend)
// ============================================

router.get('/catalog', async (req, res) => {
  try {
    // Convert catalog to array
    const catalog = Object.entries(GIFT_CATALOG).map(([id, data]) => ({
      id,
      ...data
    }));
    
    res.json({
      success: true,
      catalog
    });
    
  } catch (error) {
    console.error('Get catalog error:', error);
    res.status(500).json({ error: 'Failed to get catalog' });
  }
});

export default router;
