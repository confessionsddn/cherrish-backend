// backend/middleware/ipTracking.js
import { query } from '../config/database.js';

// ============================================
// IP TRACKING MIDDLEWARE
// Tracks IP addresses for security and analytics
// =============================================

// Extract IP address from request
export const getClientIP = (req) => {
  // Check common proxy headers first
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // x-forwarded-for can be a comma-separated list
    const ips = forwarded.split(',');
    return ips[0].trim();
  }
  
  // Check other common headers
  const realIP = req.headers['x-real-ip'];
  if (realIP) {
    return realIP.trim();
  }
  
  // Cloudflare specific
  const cfConnectingIP = req.headers['cf-connecting-ip'];
  if (cfConnectingIP) {
    return cfConnectingIP.trim();
  }
  
  // Fall back to socket IP
  return req.socket.remoteAddress || req.connection.remoteAddress || 'unknown';
};

// Get user agent
export const getUserAgent = (req) => {
  return req.headers['user-agent'] || 'unknown';
};

// Log IP action
export const logIPAction = async (userId, actionType, req) => {
  try {
    const ip = getClientIP(req);
    const userAgent = getUserAgent(req);
    
    await query(
      `INSERT INTO user_ip_logs (user_id, ip_address, user_agent, action_type)
       VALUES ($1, $2, $3, $4)`,
      [userId, ip, userAgent, actionType]
    );
    
    // Update last IP in users table
    await query(
      'UPDATE users SET last_ip = $1 WHERE id = $2',
      [ip, userId]
    );
    
    console.log(`📍 IP logged: ${ip} - ${actionType} by user ${userId}`);
    
  } catch (error) {
    console.error('❌ IP logging error:', error);
    // Don't block request if logging fails
  }
};

// Middleware: Track IP on registration
export const trackRegistrationIP = async (req, res, next) => {
  try {
    if (req.user && req.user.id) {
      const ip = getClientIP(req);
      
      // Check if this is a new registration (no registration_ip set)
      const userResult = await query(
        'SELECT registration_ip FROM users WHERE id = $1',
        [req.user.id]
      );
      
      if (userResult.rows.length > 0 && !userResult.rows[0].registration_ip) {
        await query(
          'UPDATE users SET registration_ip = $1, last_ip = $1 WHERE id = $2',
          [ip, req.user.id]
        );
        
        await logIPAction(req.user.id, 'registration', req);
        console.log(`✅ Registration IP saved: ${ip}`);
      }
    }
  } catch (error) {
    console.error('❌ Registration IP tracking error:', error);
  }
  
  next();
};

// Middleware: Track IP on important actions
export const trackActionIP = (actionType) => {
  return async (req, res, next) => {
    try {
      if (req.user && req.user.id) {
        await logIPAction(req.user.id, actionType, req);
      }
    } catch (error) {
      console.error(`❌ IP tracking error (${actionType}):`, error);
    }
    
    next();
  };
};

// ============================================
// ADMIN FUNCTIONS: IP-BASED SECURITY
// ============================================

// Get all IPs for a user
export const getUserIPs = async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin only' });
    }
    
    const result = await query(
      `SELECT 
        ip_address,
        user_agent,
        action_type,
        created_at,
        COUNT(*) OVER (PARTITION BY ip_address) as ip_usage_count
       FROM user_ip_logs
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [userId]
    );
    
    res.json({
      success: true,
      ip_logs: result.rows
    });
    
  } catch (error) {
    console.error('Error getting user IPs:', error);
    res.status(500).json({ error: 'Failed to get IP logs' });
  }
};

// Get all users from same IP (detect multi-accounting)
export const getUsersFromIP = async (req, res) => {
  try {
    const { ip } = req.params;
    
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin only' });
    }
    
    const result = await query(
      `SELECT DISTINCT
        u.id,
        u.username,
        u.user_number,
        u.email,
        u.is_banned,
        u.created_at,
        l.ip_address,
        l.action_type,
        l.created_at as last_seen
       FROM users u
       JOIN user_ip_logs l ON u.id = l.user_id
       WHERE l.ip_address = $1
       ORDER BY l.created_at DESC`,
      [ip]
    );
    
    res.json({
      success: true,
      users: result.rows,
      count: result.rows.length
    });
    
  } catch (error) {
    console.error('Error getting users from IP:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
};

// Ban all users from specific IP
export const banIP = async (req, res) => {
  try {
    const { ip } = req.params;
    const { duration = 'permanent', reason } = req.body;
    
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin only' });
    }
    
    // Get all users from this IP
    const usersResult = await query(
      `SELECT DISTINCT user_id FROM user_ip_logs WHERE ip_address = $1`,
      [ip]
    );
    
    if (usersResult.rows.length === 0) {
      return res.status(404).json({ error: 'No users found with this IP' });
    }
    
    // Calculate ban expiry
    let banUntil = null;
    if (duration === '3') {
      banUntil = new Date();
      banUntil.setDate(banUntil.getDate() + 3);
    } else if (duration === '7') {
      banUntil = new Date();
      banUntil.setDate(banUntil.getDate() + 7);
    }
    
    // Ban all users
    for (const row of usersResult.rows) {
      await query(
        `UPDATE users 
         SET is_banned = true, ban_until = $1
         WHERE id = $2`,
        [banUntil, row.user_id]
      );
    }
    
    // Log admin action
    await query(
      `INSERT INTO admin_action_logs (admin_id, action_type, target_type, details, ip_address)
       VALUES ($1, 'ip_ban', 'ip', $2, $3)`,
      [
        req.user.id,
        JSON.stringify({ ip, users_banned: usersResult.rows.length, duration, reason }),
        getClientIP(req)
      ]
    );
    
    console.log(`🚫 IP banned: ${ip} - ${usersResult.rows.length} users affected`);
    
    res.json({
      success: true,
      message: `Banned ${usersResult.rows.length} users from IP ${ip}`,
      users_banned: usersResult.rows.length
    });
    
  } catch (error) {
    console.error('Error banning IP:', error);
    res.status(500).json({ error: 'Failed to ban IP' });
  }
};

// Check if IP is suspicious (high velocity, multiple accounts)
export const checkSuspiciousIP = async (ip) => {
  try {
    // Check how many accounts created from this IP in last 24 hours
    const result = await query(
      `SELECT COUNT(DISTINCT user_id) as account_count
       FROM user_ip_logs
       WHERE ip_address = $1
       AND action_type = 'registration'
       AND created_at > NOW() - INTERVAL '24 hours'`,
      [ip]
    );
    
    const accountCount = result.rows[0]?.account_count || 0;
    
    // Flag as suspicious if more than 3 accounts in 24 hours
    if (accountCount > 3) {
      console.warn(`⚠️ Suspicious IP detected: ${ip} - ${accountCount} accounts in 24h`);
      return {
        is_suspicious: true,
        reason: 'multiple_accounts',
        account_count: accountCount
      };
    }
    
    return {
      is_suspicious: false
    };
    
  } catch (error) {
    console.error('Error checking suspicious IP:', error);
    return { is_suspicious: false };
  }
};

// Middleware: Block suspicious IPs
export const blockSuspiciousIP = async (req, res, next) => {
  try {
    const ip = getClientIP(req);
    const suspiciousCheck = await checkSuspiciousIP(ip);
    
    if (suspiciousCheck.is_suspicious) {
      console.warn(`🚫 Blocked suspicious IP: ${ip}`);
      return res.status(429).json({
        error: 'Too many accounts from this IP',
        message: 'Please contact admin if this is an error.'
      });
    }
    
  } catch (error) {
    console.error('Error in suspicious IP check:', error);
  }
  
  next();
};
