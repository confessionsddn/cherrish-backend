//middleware/auth.js
import jwt from 'jsonwebtoken';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { query } from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

// Configure Google OAuth Strategy
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL,
    passReqToCallback: true  // ADD THIS - allows us to access req in callback
  },
  async (req, accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails[0].value;
      const googleId = profile.id;
      
      console.log('🔍 Google OAuth - Email:', email, 'ID:', googleId);
      
      // Attach to request so we can access in route handler
      req.oauthProfile = { email, googleId };
      
      // Check if user exists
      const userResult = await query(
        'SELECT * FROM users WHERE google_id = $1 OR email = $2',
        [googleId, email]
      );
      
      if (userResult.rows.length > 0) {
        // User exists, update last login
        const user = userResult.rows[0];
        console.log('✅ User found:', user.username);
        
        await query(
          'UPDATE users SET last_login = NOW(), google_id = $1 WHERE id = $2',
          [googleId, user.id]
        );
        
        return done(null, user);
      }
      
      // User doesn't exist - needs registration
      console.log('⚠️ User not found - needs registration');
      return done(null, false);
      
    } catch (error) {
      console.error('❌ Passport strategy error:', error);
      return done(error, null);
    }
  }
));

// Serialize account data to request
passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

// Generate JWT token
export const generateToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      username: user.username,
      user_number: user.user_number
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    
    try {
      // UPDATE LAST LOGIN HERE - EVERY TIME TOKEN IS VERIFIED!
      await query(
        'UPDATE users SET last_login = NOW() WHERE id = $1',
        [decoded.id]
      );
      
     const userResult = await query(
    'SELECT id, email, username, user_number, credits, is_premium, is_banned, is_admin, ban_until FROM users WHERE id = $1',
    [decoded.id]
     );
      
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      const user = userResult.rows[0];
      
      // CHECK IF BAN IS EXPIRED
      if (user.is_banned && user.ban_until) {
        const now = new Date();
        const banUntil = new Date(user.ban_until);
        
        if (now > banUntil) {
          // Ban expired, unban automatically
          await query(
            'UPDATE users SET is_banned = false, ban_until = NULL WHERE id = $1',
            [user.id]
          );
          user.is_banned = false;
          console.log('✅ Auto-unbanned (ban expired):', user.email);
        }
      }
      
      // CHECK IF CURRENTLY BANNED
      if (user.is_banned) {
        return res.status(403).json({ 
          error: 'Your account has been banned',
          ban_until: user.ban_until 
        });
      }
      
      req.user = user;
      next();
    } catch (error) {
      console.error('Auth middleware error:', error);
      return res.status(500).json({ error: 'Authentication failed' });
    }
  });
};

// Optional authentication
export const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    req.user = null;
    return next();
  }
  
  jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
    if (err) {
      req.user = null;
      return next();
    }
    
    try {
      const userResult = await query(
        'SELECT id, email, username, user_number, credits, is_premium, is_banned FROM users WHERE id = $1',
        [decoded.id]
      );
      
      req.user = userResult.rows.length > 0 ? userResult.rows[0] : null;
      next();
    } catch (error) {
      req.user = null;
      next();
    }
  });
};

export default passport;