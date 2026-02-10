# 🚀 LOVECONFESS BACKEND - SETUP GUIDE

Complete guide to set up and deploy the LoveConfess backend API.

---

## 📋 PREREQUISITES

Before you start, you need:

1. **Node.js 18+** installed
   - Check: `node --version`
   - Download: https://nodejs.org/

2. **PostgreSQL database** (one of these):
   - Railway.app (recommended - includes free PostgreSQL)
   - Local PostgreSQL installation
   - Supabase free tier

3. **API Keys** (we'll get these):
   - Google OAuth credentials
   - Cloudinary account
   - Razorpay account

---

## 🎯 QUICK START (Local Development)

### Step 1: Install Dependencies

```bash
cd loveconfess-backend
npm install
```

### Step 2: Set Up Environment Variables

```bash
# Copy example env file
cp .env.example .env

# Edit .env with your values
nano .env  # or use your editor
```

### Step 3: Get API Keys (detailed below)

### Step 4: Set Up Database

```bash
# Run migrations (creates tables)
npm run db:migrate

# Seed initial data (optional)
npm run db:seed
```

### Step 5: Start Server

```bash
npm run dev
```

Server runs on: **http://localhost:3001**

---

## 🔑 GETTING API KEYS

### 1. Google OAuth Credentials

**Why:** For user authentication with Google accounts.

**Steps:**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable "Google+ API"
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Configure consent screen:
   - Application name: "LoveConfess"
   - User support email: Your email
   - Developer contact: Your email
6. Create OAuth client:
   - Application type: **Web application**
   - Name: "LoveConfess Backend"
   - Authorized redirect URIs:
     - `http://localhost:3001/api/auth/google/callback` (development)
     - `https://your-app.railway.app/api/auth/google/callback` (production)
7. Copy **Client ID** and **Client Secret**

**Add to .env:**
```env
GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-abc123xyz
GOOGLE_CALLBACK_URL=http://localhost:3001/api/auth/google/callback
```

---

### 2. Cloudinary (File Storage)

**Why:** For storing voice confession audio files.

**Steps:**

1. Go to [Cloudinary](https://cloudinary.com/)
2. Sign up for free account
3. Go to **Dashboard**
4. Copy:
   - Cloud Name
   - API Key
   - API Secret

**Add to .env:**
```env
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=123456789012345
CLOUDINARY_API_SECRET=abcdefghijklmnopqrstuvwxyz12
```

**Free tier includes:**
- 25GB storage
- 25GB bandwidth/month
- More than enough for your use case!

---

### 3. Razorpay (Payments)

**Why:** For processing credit purchases (India-focused payment gateway).

**Steps:**

1. Go to [Razorpay Dashboard](https://dashboard.razorpay.com/)
2. Sign up (requires KYC verification for live mode)
3. Use **Test Mode** for development
4. Go to **Settings** → **API Keys**
5. Generate Test API Keys

**Add to .env:**
```env
RAZORPAY_KEY_ID=rzp_test_abc123xyz
RAZORPAY_KEY_SECRET=your_secret_key_here
```

**Important:**
- Test mode is free and unlimited
- Live mode requires KYC verification
- Keep test and live keys separate!

---

### 4. PostgreSQL Database

**Option A: Railway.app (Recommended)**

1. Go to [Railway.app](https://railway.app/)
2. Sign up with GitHub
3. Create new project
4. Add **PostgreSQL** database
5. Copy **DATABASE_URL** from variables

**Add to .env:**
```env
DATABASE_URL=postgresql://postgres:password@host:port/railway
```

**Option B: Local PostgreSQL**

1. Install PostgreSQL locally
2. Create database:
   ```sql
   CREATE DATABASE loveconfess;
   ```
3. Create .env:
   ```env
   DATABASE_URL=postgresql://username:password@localhost:5432/loveconfess
   ```

---

### 5. JWT Secret

**Generate a secure random secret:**

```bash
# On Mac/Linux:
openssl rand -base64 32

# Or use Node.js:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Add to .env:**
```env
JWT_SECRET=your-generated-secret-key-here-32-characters-long
```

---

## 🗄️ DATABASE SETUP

### Run Migrations

This creates all database tables:

```bash
npm run db:migrate
```

**Expected output:**
```
🔨 Creating database tables...
✅ Users table created
✅ Access codes table created
✅ Confessions table created
✅ Reactions table created
✅ Comments table created
✅ Transactions table created
✅ Rare numbers table created
✅ Database indexes created
✅ Triggers created
🎉 Database migration completed successfully!
```

---

### Seed Sample Data

This adds test access codes and rare numbers:

```bash
npm run db:seed
```

**Expected output:**
```
🌱 Seeding database...
✅ Inserted 11 rare numbers
✅ Inserted 5 sample access codes
📝 Sample codes: LOVE2024-DEMO-001, LOVE2024-DEMO-002, ...
🎉 Database seeding completed successfully!
```

---

## ▶️ RUNNING THE SERVER

### Development Mode (with auto-restart)

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

**Expected output:**
```
🚀 ═══════════════════════════════════════════
🚀  LOVECONFESS BACKEND SERVER STARTED
🚀 ═══════════════════════════════════════════

   📡  Server running on port: 3001
   🌍  Environment: development
   🔗  Frontend URL: http://localhost:3000

   API Endpoints:
   ├─ Health: http://localhost:3001/health
   ├─ Auth: http://localhost:3001/api/auth
   ├─ Confessions: http://localhost:3001/api/confessions
   └─ Payments: http://localhost:3001/api/payments

🚀 ═══════════════════════════════════════════
```

---

## ✅ TESTING THE API

### 1. Health Check

```bash
curl http://localhost:3001/health
```

**Response:**
```json
{
  "status": "OK",
  "timestamp": "2026-01-24T10:00:00.000Z",
  "uptime": 123.45
}
```

### 2. Test Registration

```bash
curl -X POST http://localhost:3001/api/auth/register/verify-code \
  -H "Content-Type: application/json" \
  -d '{"accessCode": "LOVE2024-DEMO-001"}'
```

### 3. Test Get Confessions

```bash
curl http://localhost:3001/api/confessions
```

---

## 🚢 DEPLOYMENT TO RAILWAY

### Step 1: Push Code to GitHub

```bash
git init
git add .
git commit -m "Initial backend setup"
git remote add origin https://github.com/yourusername/loveconfess-backend.git
git push -u origin main
```

### Step 2: Deploy on Railway

1. Go to [Railway.app](https://railway.app/)
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Choose your `loveconfess-backend` repo
5. Railway will auto-detect Node.js

### Step 3: Add PostgreSQL

1. In your Railway project, click **"New"** → **"Database"** → **"PostgreSQL"**
2. Railway auto-generates `DATABASE_URL` and links it

### Step 4: Add Environment Variables

In Railway project settings → **Variables**, add:

```env
NODE_ENV=production
FRONTEND_URL=https://your-app.vercel.app
JWT_SECRET=your-secret-from-step-5
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-secret
GOOGLE_CALLBACK_URL=https://your-app.railway.app/api/auth/google/callback
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-cloudinary-key
CLOUDINARY_API_SECRET=your-cloudinary-secret
RAZORPAY_KEY_ID=your-razorpay-key
RAZORPAY_KEY_SECRET=your-razorpay-secret
```

### Step 5: Run Migrations

In Railway terminal or locally with production DATABASE_URL:

```bash
npm run db:migrate
npm run db:seed
```

### Step 6: Deploy!

Railway auto-deploys on git push. Your API will be live at:
`https://your-app.railway.app`

---

## 🔗 CONNECTING FRONTEND TO BACKEND

Update your React frontend's API configuration:

**Create `src/config/api.js`:**

```javascript
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const api = {
  // Auth endpoints
  verifyAccessCode: async (code) => {
    const res = await fetch(`${API_URL}/api/auth/register/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessCode: code })
    });
    return res.json();
  },

  // Confessions endpoints
  getConfessions: async (moodZone = 'all') => {
    const res = await fetch(`${API_URL}/api/confessions?mood_zone=${moodZone}`);
    return res.json();
  },

  createConfession: async (formData, token) => {
    const res = await fetch(`${API_URL}/api/confessions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    return res.json();
  },

  reactToConfession: async (id, reactionType, token) => {
    const res = await fetch(`${API_URL}/api/confessions/${id}/react`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ reaction_type: reactionType })
    });
    return res.json();
  }
};

export default API_URL;
```

**Add to frontend `.env`:**

```env
VITE_API_URL=http://localhost:3001
```

(For production: `VITE_API_URL=https://your-app.railway.app`)

---

## 🐛 TROUBLESHOOTING

### Database Connection Failed

**Error:** `Error: connect ECONNREFUSED`

**Fix:**
1. Check DATABASE_URL is correct
2. Make sure PostgreSQL is running
3. Check firewall settings

### Port Already in Use

**Error:** `Error: listen EADDRINUSE: address already in use :::3001`

**Fix:**
```bash
# Kill process on port 3001
npx kill-port 3001
```

### Google OAuth Not Working

**Error:** `redirect_uri_mismatch`

**Fix:**
1. Check GOOGLE_CALLBACK_URL matches exactly what's in Google Console
2. Make sure URL includes `/api/auth/google/callback`
3. Add both localhost and production URLs

### Cloudinary Upload Fails

**Error:** `Upload failed`

**Fix:**
1. Verify all 3 Cloudinary credentials are correct
2. Check file size < 5MB
3. Ensure file is audio format

### Razorpay Signature Mismatch

**Error:** `Invalid payment signature`

**Fix:**
1. Verify RAZORPAY_KEY_SECRET matches dashboard
2. Check you're using test mode keys in development
3. Don't mix test and live keys

---

## 📊 MONITORING

### Check Server Status

```bash
curl https://your-app.railway.app/health
```

### View Logs

**Railway:**
- Go to your project → Deployments → View Logs

**Local:**
- Logs appear in terminal where you ran `npm run dev`

---

## 🔒 SECURITY CHECKLIST

Before going live:

- [ ] JWT_SECRET is a strong random string
- [ ] DATABASE_URL contains secure password
- [ ] CORS origin is set to your frontend URL only
- [ ] Rate limiting is enabled
- [ ] Helmet middleware is active
- [ ] HTTPS is enforced in production
- [ ] Environment variables are not in git
- [ ] Google OAuth redirect URIs are production URLs
- [ ] Razorpay is in live mode (after KYC)

---

## 💰 COST BREAKDOWN

| Service | Free Tier | Paid Tier |
|---------|-----------|-----------|
| **Railway** | 500 hours/month | ~₹500/month after free tier |
| **PostgreSQL** | Included with Railway | Included |
| **Cloudinary** | 25GB storage, 25GB bandwidth | ₹0-2000/month |
| **Google OAuth** | FREE forever | FREE |
| **Razorpay** | FREE (2% transaction fee) | 2% per transaction |

**Total:** ₹0-500/month for up to 500 users

---

## 📝 NEXT STEPS

1. ✅ Backend is running locally
2. ⬜ Test all API endpoints
3. ⬜ Connect frontend to backend
4. ⬜ Deploy to Railway
5. ⬜ Test production deployment
6. ⬜ Launch to students!

---

**Questions? Issues? Check the API documentation or create an issue!** 🚀
