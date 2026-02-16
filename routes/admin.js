// backend/routes/admin.js - COMPLETE ULTIMATE ADMIN PANEL ROUTES
import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { query, getClient } from '../config/database.js';
import { getClientIP } from '../middleware/ipTracking.js';

const router = express.Router();

// ============================================
// ADMIN MIDDLEWARE - CHECK IS ADMIN
// ============================================
const requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Apply to all routes
router.use(authenticateToken);
router.use(requireAdmin);

// ============================================
// DASHBOARD STATS
// ============================================
router.get('/stats', async (req, res) => {
  try {
    // Total users
    const usersResult = await query('SELECT COUNT(*) as total FROM users');
    
    // Total confessions
    const confessionsResult = await query('SELECT COUNT(*) as total FROM confessions WHERE status = $1', ['approved']);
    
    // Pending moderation
    const pendingResult = await query('SELECT COUNT(*) as total FROM confessions WHERE status = $1', ['pending']);
    
    // Active users (last 24h)
    const activeResult = await query(
      `SELECT COUNT(DISTINCT user_id) as total 
       FROM user_ip_logs 
       WHERE created_at > NOW() - INTERVAL '24 hours'`
    );
    
    // Total reactions
    const reactionsResult = await query('SELECT COUNT(*) as total FROM reactions');
    
    // Total replies
    const repliesResult = await query('SELECT COUNT(*) as total FROM confession_replies');
    
    // Credits in circulation
    const creditsResult = await query('SELECT SUM(credits) as total FROM users');
    
    // Premium users
    const premiumResult = await query('SELECT COUNT(*) as total FROM users WHERE is_premium = true');
    
    // Banned users
    const bannedResult = await query('SELECT COUNT(*) as total FROM users WHERE is_banned = true');
    
    // Total gifts sent
    const giftsResult = await query('SELECT COUNT(*) as total FROM confession_gifts');
    
    // Revenue today (mock - you need payment_receipts table)
    const revenueResult = await query(
      `SELECT COALESCE(SUM(amount), 0) as total 
       FROM credit_transactions 
       WHERE type = 'purchased' 
       AND created_at > NOW() - INTERVAL '24 hours'`
    );
    
    res.json({
      success: true,
      stats: {
        total_users: parseInt(usersResult.rows[0].total),
        total_confessions: parseInt(confessionsResult.rows[0].total),
        pending_moderation: parseInt(pendingResult.rows[0].total),
        active_users_24h: parseInt(activeResult.rows[0].total),
        total_reactions: parseInt(reactionsResult.rows[0].total),
        total_replies: parseInt(repliesResult.rows[0].total),
        credits_in_circulation: parseInt(creditsResult.rows[0].total || 0),
        premium_users: parseInt(premiumResult.rows[0].total),
        banned_users: parseInt(bannedResult.rows[0].total),
        total_gifts: parseInt(giftsResult.rows[0].total),
        revenue_today: parseInt(revenueResult.rows[0].total || 0)
      }
    });
    
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// ============================================
// ANALYTICS - DAILY ACTIVE USERS (CHART DATA)
// ============================================
router.get('/analytics/dau', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    
    const result = await query(
      `SELECT 
        DATE(created_at) as date,
        COUNT(DISTINCT user_id) as active_users
       FROM user_ip_logs
       WHERE created_at > NOW() - INTERVAL '${parseInt(days)} days'
       GROUP BY DATE(created_at)
       ORDER BY date DESC`
    );
    
    res.json({
      success: true,
      data: result.rows
    });
    
  } catch (error) {
    console.error('Get DAU error:', error);
    res.status(500).json({ error: 'Failed to get DAU' });
  }
});

// ============================================
// ANALYTICS - MOOD ZONE POPULARITY
// ============================================
router.get('/analytics/mood-zones', async (req, res) => {
  try {
    const result = await query(
      `SELECT 
        mood_zone,
        COUNT(*) as count,
        ROUND((COUNT(*) * 100.0 / (SELECT COUNT(*) FROM confessions WHERE status = 'approved')), 2) as percentage
       FROM confessions
       WHERE status = 'approved'
       GROUP BY mood_zone
       ORDER BY count DESC`
    );
    
    res.json({
      success: true,
      data: result.rows
    });
    
  } catch (error) {
    console.error('Get mood zones error:', error);
    res.status(500).json({ error: 'Failed to get mood zones' });
  }
});

// ============================================
// ANALYTICS - TOP USERS (LEADERBOARD)
// ============================================
router.get('/analytics/top-users', async (req, res) => {
  try {
    const result = await query(
      `SELECT 
        u.id,
        u.username,
        u.user_number,
        u.is_premium,
        COUNT(DISTINCT c.id) as confession_count,
        COUNT(DISTINCT r.id) as reaction_count,
        COUNT(DISTINCT cr.id) as reply_count,
        (COUNT(DISTINCT c.id) + COUNT(DISTINCT r.id) + COUNT(DISTINCT cr.id)) as total_activity
       FROM users u
       LEFT JOIN confessions c ON u.id = c.user_id AND c.status = 'approved'
       LEFT JOIN reactions r ON u.id = r.user_id
       LEFT JOIN confession_replies cr ON u.id = cr.user_id
       GROUP BY u.id
       ORDER BY total_activity DESC
       LIMIT 20`
    );
    
    res.json({
      success: true,
      users: result.rows
    });
    
  } catch (error) {
    console.error('Get top users error:', error);
    res.status(500).json({ error: 'Failed to get top users' });
  }
});

// ============================================
// USER MANAGEMENT - GET ALL USERS
// ============================================
router.get('/users', async (req, res) => {
  try {
    const { page = 1, limit = 50, search = '', filter = 'all' } = req.query;
    const offset = (page - 1) * limit;
    
    let queryText = `
      SELECT 
        u.id,
        u.email,
        u.username,
        u.user_number,
        u.credits,
        u.is_premium,
        u.is_banned,
        u.ban_until,
        u.is_admin,
        u.created_at,
        u.last_login,
        u.last_ip,
        u.registration_ip,
        u.username_changed,
        COUNT(DISTINCT c.id) as confession_count,
        COUNT(DISTINCT r.id) as reaction_count
      FROM users u
      LEFT JOIN confessions c ON u.id = c.user_id
      LEFT JOIN reactions r ON u.id = r.user_id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    // Search filter
    if (search) {
      queryText += ` AND (u.username ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex} OR CAST(u.user_number AS TEXT) ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    // Status filter
    if (filter === 'premium') {
      queryText += ` AND u.is_premium = true`;
    } else if (filter === 'banned') {
      queryText += ` AND u.is_banned = true`;
    } else if (filter === 'active') {
      queryText += ` AND u.last_login > NOW() - INTERVAL '7 days'`;
    }
    
    queryText += `
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    
    params.push(parseInt(limit), parseInt(offset));
    
    const result = await query(queryText, params);
    
    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM users WHERE 1=1';
    const countParams = [];
    
    if (search) {
      countQuery += ' AND (username ILIKE $1 OR email ILIKE $1 OR CAST(user_number AS TEXT) ILIKE $1)';
      countParams.push(`%${search}%`);
    }
    
    if (filter === 'premium') {
      countQuery += ' AND is_premium = true';
    } else if (filter === 'banned') {
      countQuery += ' AND is_banned = true';
    } else if (filter === 'active') {
      countQuery += ' AND last_login > NOW() - INTERVAL \'7 days\'';
    }
    
    const countResult = await query(countQuery, countParams);
    
    res.json({
      success: true,
      users: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].total),
        pages: Math.ceil(countResult.rows[0].total / limit)
      }
    });
    
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// ============================================
// USER MANAGEMENT - GET SINGLE USER DETAILS
// ============================================
router.get('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // User info
    const userResult = await query(
      `SELECT * FROM users WHERE id = $1`,
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Activity logs
    const activityResult = await query(
      `SELECT * FROM user_ip_logs 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [userId]
    );
    
    // Confessions
    const confessionsResult = await query(
      `SELECT id, content, mood_zone, status, created_at 
       FROM confessions 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 20`,
      [userId]
    );
    
    // Credit transactions
    const transactionsResult = await query(
      `SELECT * FROM credit_transactions 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 20`,
      [userId]
    );
    
    res.json({
      success: true,
      user: userResult.rows[0],
      activity: activityResult.rows,
      confessions: confessionsResult.rows,
      transactions: transactionsResult.rows
    });
    
  } catch (error) {
    console.error('Get user details error:', error);
    res.status(500).json({ error: 'Failed to get user details' });
  }
});

// ============================================
// USER MANAGEMENT - BAN USER
// ============================================
router.post('/users/:userId/ban', async (req, res) => {
  try {
    const { userId } = req.params;
    const { duration, reason } = req.body; // '3', '7', 'permanent'
    
    let banUntil = null;
    if (duration === '3') {
      banUntil = new Date();
      banUntil.setDate(banUntil.getDate() + 3);
    } else if (duration === '7') {
      banUntil = new Date();
      banUntil.setDate(banUntil.getDate() + 7);
    }
    
    await query(
      `UPDATE users 
       SET is_banned = true, ban_until = $1 
       WHERE id = $2`,
      [banUntil, userId]
    );
    
    // Log action
    await query(
      `INSERT INTO admin_action_logs (admin_id, action_type, target_type, target_id, details, ip_address)
       VALUES ($1, 'ban', 'user', $2, $3, $4)`,
      [
        req.user.id,
        userId,
        JSON.stringify({ duration, reason }),
        getClientIP(req)
      ]
    );
    
    res.json({
      success: true,
      message: `User banned for ${duration === 'permanent' ? 'permanently' : duration + ' days'}`
    });
    
  } catch (error) {
    console.error('Ban user error:', error);
    res.status(500).json({ error: 'Failed to ban user' });
  }
});

// ============================================
// USER MANAGEMENT - UNBAN USER
// ============================================
router.post('/users/:userId/unban', async (req, res) => {
  try {
    const { userId } = req.params;
    
    await query(
      `UPDATE users 
       SET is_banned = false, ban_until = NULL 
       WHERE id = $1`,
      [userId]
    );
    
    // Log action
    await query(
      `INSERT INTO admin_action_logs (admin_id, action_type, target_type, target_id, ip_address)
       VALUES ($1, 'unban', 'user', $2, $3)`,
      [req.user.id, userId, getClientIP(req)]
    );
    
    res.json({
      success: true,
      message: 'User unbanned successfully'
    });
    
  } catch (error) {
    console.error('Unban user error:', error);
    res.status(500).json({ error: 'Failed to unban user' });
  }
});

// ============================================
// USER MANAGEMENT - DELETE USER
// ============================================
router.delete('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Soft delete - mark as deleted
    await query(
      `UPDATE users 
       SET deleted_at = NOW(), email = email || '_DELETED_' || id 
       WHERE id = $1`,
      [userId]
    );
    
    // Log action
    await query(
      `INSERT INTO admin_action_logs (admin_id, action_type, target_type, target_id, ip_address)
       VALUES ($1, 'delete_user', 'user', $2, $3)`,
      [req.user.id, userId, getClientIP(req)]
    );
    
    res.json({
      success: true,
      message: 'User deleted successfully'
    });
    
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// ============================================
// CONFESSION MANAGEMENT - PIN CONFESSION
// ============================================
router.post('/confessions/:confessionId/pin', async (req, res) => {
  try {
    const { confessionId } = req.params;
    
    // Check current pinned count
    const pinnedCount = await query(
      'SELECT COUNT(*) as count FROM confessions WHERE is_pinned = true'
    );
    
    if (pinnedCount.rows[0].count >= 3) {
      return res.status(400).json({ 
        error: 'Maximum 3 confessions can be pinned',
        message: 'Please unpin one before pinning another'
      });
    }
    
    await query(
      `UPDATE confessions 
       SET is_pinned = true, pinned_at = NOW(), pinned_by = $1 
       WHERE id = $2`,
      [req.user.id, confessionId]
    );
    
    // Log action
    await query(
      `INSERT INTO admin_action_logs (admin_id, action_type, target_type, target_id, ip_address)
       VALUES ($1, 'pin', 'confession', $2, $3)`,
      [req.user.id, confessionId, getClientIP(req)]
    );
    
    res.json({
      success: true,
      message: 'Confession pinned successfully'
    });
    
  } catch (error) {
    console.error('Pin confession error:', error);
    res.status(500).json({ error: 'Failed to pin confession' });
  }
});

// ============================================
// CONFESSION MANAGEMENT - UNPIN CONFESSION
// ============================================
router.post('/confessions/:confessionId/unpin', async (req, res) => {
  try {
    const { confessionId } = req.params;
    
    await query(
      `UPDATE confessions 
       SET is_pinned = false, pinned_at = NULL, pinned_by = NULL 
       WHERE id = $1`,
      [confessionId]
    );
    
    // Log action
    await query(
      `INSERT INTO admin_action_logs (admin_id, action_type, target_type, target_id, ip_address)
       VALUES ($1, 'unpin', 'confession', $2, $3)`,
      [req.user.id, confessionId, getClientIP(req)]
    );
    
    res.json({
      success: true,
      message: 'Confession unpinned successfully'
    });
    
  } catch (error) {
    console.error('Unpin confession error:', error);
    res.status(500).json({ error: 'Failed to unpin confession' });
  }
});

// ============================================
// CONFESSION MANAGEMENT - FEATURE CONFESSION
// ============================================
router.post('/confessions/:confessionId/feature', async (req, res) => {
  try {
    const { confessionId } = req.params;
    
    await query(
      `UPDATE confessions 
       SET is_featured = true, featured_at = NOW(), featured_by = $1 
       WHERE id = $2`,
      [req.user.id, confessionId]
    );
    
    // Log action
    await query(
      `INSERT INTO admin_action_logs (admin_id, action_type, target_type, target_id, ip_address)
       VALUES ($1, 'feature', 'confession', $2, $3)`,
      [req.user.id, confessionId, getClientIP(req)]
    );
    
    res.json({
      success: true,
      message: 'Confession featured successfully'
    });
    
  } catch (error) {
    console.error('Feature confession error:', error);
    res.status(500).json({ error: 'Failed to feature confession' });
  }
});

// ============================================
// CONFESSION MANAGEMENT - UNFEATURE CONFESSION
// ============================================
router.post('/confessions/:confessionId/unfeature', async (req, res) => {
  try {
    const { confessionId } = req.params;
    
    await query(
      `UPDATE confessions 
       SET is_featured = false, featured_at = NULL, featured_by = NULL 
       WHERE id = $1`,
      [confessionId]
    );
    
    res.json({
      success: true,
      message: 'Confession unfeatured successfully'
    });
    
  } catch (error) {
    console.error('Unfeature confession error:', error);
    res.status(500).json({ error: 'Failed to unfeature confession' });
  }
});

// ============================================
// CONFESSION MANAGEMENT - SOFT DELETE
// ============================================
router.delete('/confessions/:confessionId', async (req, res) => {
  try {
    const { confessionId } = req.params;
    
    await query(
      `UPDATE confessions 
       SET deleted_at = NOW(), deleted_by = $1 
       WHERE id = $2`,
      [req.user.id, confessionId]
    );
    
    // Log action
    await query(
      `INSERT INTO admin_action_logs (admin_id, action_type, target_type, target_id, ip_address)
       VALUES ($1, 'delete', 'confession', $2, $3)`,
      [req.user.id, confessionId, getClientIP(req)]
    );
    
    res.json({
      success: true,
      message: 'Confession deleted successfully'
    });
    
  } catch (error) {
    console.error('Delete confession error:', error);
    res.status(500).json({ error: 'Failed to delete confession' });
  }
});

// ============================================
// ACTIVITY LOGS
// ============================================
router.get('/logs', async (req, res) => {
  try {
    const { page = 1, limit = 50, action_type = 'all' } = req.query;
    const offset = (page - 1) * limit;
    
    let queryText = `
      SELECT 
        l.*,
        u.username as admin_username,
        u.user_number as admin_user_number
      FROM admin_action_logs l
      JOIN users u ON l.admin_id = u.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (action_type !== 'all') {
      queryText += ` AND l.action_type = $${paramIndex}`;
      params.push(action_type);
      paramIndex++;
    }
    
    queryText += ` ORDER BY l.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), parseInt(offset));
    
    const result = await query(queryText, params);
    
    res.json({
      success: true,
      logs: result.rows
    });
    
  } catch (error) {
    console.error('Get logs error:', error);
    res.status(500).json({ error: 'Failed to get logs' });
  }
});

export default router;
