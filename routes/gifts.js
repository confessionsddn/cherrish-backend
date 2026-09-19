// backend/routes/gifts.js
import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { query, getClient } from '../config/database.js';
import { enqueueNotification } from '../services/notificationService.js';

const router = express.Router();

// ============================================
// GIFT CONFIGURATION
// ============================================

// Each gift maps to a card skin (theme). unlock_at = how many of that gift a
// user must RECEIVE before the matching card skin unlocks. Thresholds are
// spread between 25 (min) and 100 (max) to vary the grind per skin.
const GIFT_CATALOG = {
  // EFFECTS (Awards)
  gold_hearts:  { name: 'Sparkle Hearts', price: 25,  type: 'effect', theme: 'sparkle',   emoji: '💖', unlock_at: 25 },
  cyber_glitch: { name: 'Cyber Glitch',   price: 35,  type: 'effect', theme: 'cyber',     emoji: '⚡', unlock_at: 60 },
  holo_foil:    { name: 'Holo Foil',      price: 50,  type: 'effect', theme: 'holo',      emoji: '🌈', unlock_at: 80 },
  sunset_bg:    { name: 'Vaporwave',      price: 40,  type: 'effect', theme: 'vaporwave', emoji: '🌆', unlock_at: 50 },
  starry_night: { name: 'Galactic Mode',  price: 45,  type: 'effect', theme: 'galaxy',    emoji: '🌌', unlock_at: 70 },
  retro_vhs:    { name: 'Retro VHS',      price: 30,  type: 'effect', theme: 'retro',     emoji: '📼', unlock_at: 40 },

  // PHYSICAL GIFTS
  roses:        { name: 'Mega Bouquet',   price: 20,  type: 'gift',   theme: 'rose',      emoji: '🌹', unlock_at: 35 },
  ring:         { name: 'Diamond Ring',   price: 100, type: 'gift',   theme: 'diamond',   emoji: '💍', unlock_at: 100 },
  chocolates:   { name: 'Luxury Box',     price: 15,  type: 'gift',   theme: 'chocolate', emoji: '🍫', unlock_at: 30 },
  teddy:        { name: 'Giant Teddy',    price: 40,  type: 'gift',   theme: 'teddy',     emoji: '🧸', unlock_at: 55 },
  mixtape:      { name: 'Lo-Fi Mixtape',  price: 15,  type: 'gift',   theme: 'lofi',      emoji: '🎧', unlock_at: 45 },
  poem:         { name: 'Epic Poem',      price: 25,  type: 'gift',   theme: 'poem',      emoji: '📜', unlock_at: 65 }
};

// Theme metadata keyed by theme name (the value stored in user_active_themes).
// Lets any endpoint resolve a theme_name back to a friendly label + emoji.
const THEME_META = Object.values(GIFT_CATALOG).reduce((acc, g) => {
  acc[g.theme] = { label: g.name, emoji: g.emoji, gift_type: null };
  return acc;
}, {});
// Attach the originating gift_type to each theme for reverse lookup.
for (const [giftType, g] of Object.entries(GIFT_CATALOG)) {
  THEME_META[g.theme].gift_type = giftType;
}

// All theme names in catalog order (used for admin "all unlocked" responses).
const ALL_THEMES = Object.values(GIFT_CATALOG).map((g) => g.theme);

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
      'SELECT id, user_id FROM confessions WHERE id = $1 AND status = $2',
      [confession_id, 'approved']
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
      
      // Notify gift recipient (async)
      const io = req.app.get('io');
      const senderName = senderResult.rows[0].is_premium ? senderResult.rows[0].username : 'Someone';
      enqueueNotification({
        userId: recipientId,
        type: 'gift',
        title: '🎁 Gift received!',
        message: `${senderName} sent you ${gift.name}!`,
        data: { confession_id, gift_type, url: '/' },
        io,
        authorId: senderId
      }).catch(err => console.error('Gift notif error:', err));
      
      // Notify theme unlock if applicable
      if (themeUnlocked) {
        enqueueNotification({
          userId: recipientId,
          type: 'theme_unlock',
          title: '🎨 Theme unlocked!',
          message: `You unlocked the ${gift.theme} theme! Go to settings to activate it.`,
          data: { theme: gift.theme, url: '/' },
          io
        }).catch(err => console.error('Theme unlock notif error:', err));
      }

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
    const isAdmin = !!req.user.is_admin;

    const result = await query(
      `SELECT 
        gift_type,
        total_received,
        unlocked_theme
       FROM user_gift_inventory
       WHERE user_id = $1`,
      [userId]
    );

    // Index received counts by gift_type for quick lookup.
    const receivedByType = {};
    result.rows.forEach((row) => {
      receivedByType[row.gift_type] = row;
    });

    // Return the FULL catalog so the UI can show every gift's progress bar,
    // even ones the user hasn't received yet (shows 0 / needed).
    const inventory = Object.entries(GIFT_CATALOG).map(([giftType, giftInfo]) => {
      const row = receivedByType[giftType];
      const totalReceived = row ? row.total_received : 0;
      // Admins have every skin unlocked with no grind.
      const unlocked = isAdmin ? true : (row ? row.unlocked_theme : false);
      return {
        gift_type: giftType,
        gift_name: giftInfo.name,
        emoji: giftInfo.emoji,
        total_received: totalReceived,
        needed_for_unlock: giftInfo.unlock_at,
        remaining: isAdmin ? 0 : Math.max(giftInfo.unlock_at - totalReceived, 0),
        progress_percentage: isAdmin ? 100 : Math.min((totalReceived / giftInfo.unlock_at) * 100, 100),
        theme_unlocked: unlocked,
        theme_name: giftInfo.theme
      };
    });

    res.json({
      success: true,
      is_admin: isAdmin,
      inventory
    });

  } catch (error) {
    console.error('Get inventory error:', error);
    res.status(500).json({ error: 'Failed to get inventory' });
  }
});

// ============================================
// GET GIFTS THE USER HAS SENT (history)
// ============================================

router.get('/sent', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50, offset = 0 } = req.query;

    const result = await query(
      `SELECT 
        g.id,
        g.gift_type,
        g.gift_price,
        g.message,
        g.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata' as created_at,
        g.confession_id,
        c.content AS confession_content,
        c.mood_zone,
        u.username AS recipient_username,
        u.user_number AS recipient_user_number
       FROM confession_gifts g
       JOIN confessions c ON g.confession_id = c.id
       JOIN users u ON c.user_id = u.id
       WHERE g.sender_id = $1
       ORDER BY g.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, parseInt(limit), parseInt(offset)]
    );

    const sent = result.rows.map((row) => {
      const giftInfo = GIFT_CATALOG[row.gift_type] || {};
      return {
        id: row.id,
        gift_type: row.gift_type,
        gift_name: giftInfo.name || row.gift_type,
        emoji: giftInfo.emoji || '🎁',
        gift_price: row.gift_price,
        message: row.message,
        created_at: row.created_at,
        confession_id: row.confession_id,
        // Short preview of the confession the gift was attached to.
        confession_preview: row.confession_content
          ? row.confession_content.slice(0, 80)
          : '',
        mood_zone: row.mood_zone,
        recipient_username: row.recipient_username,
        recipient_user_number: row.recipient_user_number
      };
    });

    res.json({ success: true, sent });

  } catch (error) {
    console.error('Get sent gifts error:', error);
    res.status(500).json({ error: 'Failed to get sent gifts' });
  }
});

// ============================================
// GET USER'S UNLOCKED THEMES
// ============================================

router.get('/themes', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const isAdmin = !!req.user.is_admin;

    // Which theme (if any) is currently active for this user.
    const activeResult = await query(
      `SELECT theme_name FROM user_active_themes 
       WHERE user_id = $1 AND is_active = true LIMIT 1`,
      [userId]
    );
    const activeTheme = activeResult.rows[0]?.theme_name || null;

    let themes;

    if (isAdmin) {
      // Admins have every theme unlocked, no grind required.
      themes = ALL_THEMES.map((themeName) => ({
        theme_name: themeName,
        label: THEME_META[themeName]?.label || themeName,
        emoji: THEME_META[themeName]?.emoji || '🎨',
        is_active: themeName === activeTheme,
        unlocked_at: null
      }));
    } else {
      const result = await query(
        `SELECT theme_name, is_active, unlocked_at
         FROM user_active_themes
         WHERE user_id = $1`,
        [userId]
      );
      themes = result.rows.map((row) => ({
        theme_name: row.theme_name,
        label: THEME_META[row.theme_name]?.label || row.theme_name,
        emoji: THEME_META[row.theme_name]?.emoji || '🎨',
        is_active: row.is_active,
        unlocked_at: row.unlocked_at
      }));
    }

    res.json({
      success: true,
      is_admin: isAdmin,
      active_theme: activeTheme,
      themes
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
    const isAdmin = !!req.user.is_admin;

    // Validate the theme name is real.
    if (!ALL_THEMES.includes(theme_name)) {
      return res.status(400).json({ error: 'Invalid theme' });
    }

    // Check if user has this theme unlocked.
    const themeResult = await query(
      'SELECT theme_name FROM user_active_themes WHERE user_id = $1 AND theme_name = $2',
      [userId, theme_name]
    );

    const hasTheme = themeResult.rows.length > 0;

    if (!hasTheme) {
      if (isAdmin) {
        // Admins can activate any theme; create the row on demand.
        await query(
          `INSERT INTO user_active_themes (user_id, theme_name, is_active)
           VALUES ($1, $2, false)
           ON CONFLICT (user_id, theme_name) DO NOTHING`,
          [userId, theme_name]
        );
      } else {
        return res.status(404).json({ error: 'Theme not unlocked' });
      }
    }

    // If activating, deactivate all other themes first (only one active at a time).
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
