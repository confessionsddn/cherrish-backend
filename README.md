# 💖 LOVECONFESS BACKEND API

**Anonymous College Confession Platform - Backend Server**

Node.js + Express + PostgreSQL backend for the LoveConfess platform.

---

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Setup environment variables
cp .env.example .env
# Edit .env with your credentials

# Run database migrations
npm run db:migrate

# Seed initial data
npm run db:seed

# Start development server
npm run dev
```

Server runs on: **http://localhost:3001**

---

## 📁 Project Structure

```
loveconfess-backend/
├── config/
│   ├── database.js          # PostgreSQL connection
│   └── cloudinary.js        # File upload config
├── middleware/
│   └── auth.js              # JWT + Google OAuth
├── routes/
│   ├── auth.js              # Authentication routes
│   ├── confessions.js       # Confession CRUD
│   └── payments.js          # Razorpay integration
├── scripts/
│   ├── migrate.js           # Database migrations
│   └── seed.js              # Seed data
├── server.js                # Main Express app
├── package.json
├── .env.example
├── SETUP_GUIDE.md           # Detailed setup instructions
└── API_DOCUMENTATION.md     # Complete API reference
```

---

## ✨ Features

- ✅ Google OAuth 2.0 authentication
- ✅ JWT token-based sessions
- ✅ PostgreSQL database with full schema
- ✅ Anonymous confession posting
- ✅ Reaction system (heart, like, cry, laugh)
- ✅ Voice confession uploads (Cloudinary)
- ✅ Credit system with Razorpay payments
- ✅ Confession boosting (paid feature)
- ✅ Username rename (paid feature)
- ✅ Rate limiting & security (Helmet)
- ✅ Access code system for controlled entry

---

## 🔧 Tech Stack

| Component | Technology |
|-----------|-----------|
| **Runtime** | Node.js 18+ |
| **Framework** | Express.js |
| **Database** | PostgreSQL 15+ |
| **Authentication** | Passport.js (Google OAuth) + JWT |
| **File Storage** | Cloudinary |
| **Payments** | Razorpay |
| **Security** | Helmet, CORS, Rate Limiting |

---

## 📋 Environment Variables

Required variables (see `.env.example`):

```env
# Server
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# Database
DATABASE_URL=postgresql://user:pass@host:port/db

# JWT
JWT_SECRET=your-secret-key

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-secret
GOOGLE_CALLBACK_URL=http://localhost:3001/api/auth/google/callback

# Cloudinary
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-key
CLOUDINARY_API_SECRET=your-secret

# Razorpay
RAZORPAY_KEY_ID=rzp_test_key
RAZORPAY_KEY_SECRET=your-secret
```

---

## 🗄️ Database Schema

**Tables:**
- `users` - User accounts with Google OAuth
- `access_codes` - One-time registration codes
- `confessions` - Anonymous confessions
- `reactions` - User reactions to confessions
- `comments` - Replies to confessions
- `transactions` - Payment history
- `rare_numbers` - Special user numbers for bidding

---

## 📡 API Endpoints

### Authentication
```
POST   /api/auth/register/verify-code   # Verify access code
POST   /api/auth/register/complete      # Complete registration
GET    /api/auth/google                 # Initiate OAuth
GET    /api/auth/google/callback        # OAuth callback
GET    /api/auth/me                     # Get current user
```

### Confessions
```
GET    /api/confessions                 # Get all confessions
GET    /api/confessions/:id             # Get single confession
POST   /api/confessions                 # Create confession
POST   /api/confessions/:id/react       # React to confession
DELETE /api/confessions/:id             # Delete confession
```

### Payments
```
POST   /api/payments/create-order       # Create Razorpay order
POST   /api/payments/verify-payment     # Verify payment
POST   /api/payments/boost-confession   # Boost confession (10 credits)
POST   /api/payments/rename-username    # Rename username (5 credits)
GET    /api/payments/transactions       # Get transaction history
```

See **API_DOCUMENTATION.md** for complete details.

---

## 🧪 Testing

**Test Access Codes:**
```
LOVE2024-DEMO-001
LOVE2024-DEMO-002
LOVE2024-DEMO-003
LOVE2024-DEMO-004
LOVE2024-DEMO-005
```

**Test API:**
```bash
# Health check
curl http://localhost:3001/health

# Get confessions
curl http://localhost:3001/api/confessions

# Verify access code
curl -X POST http://localhost:3001/api/auth/register/verify-code \
  -H "Content-Type: application/json" \
  -d '{"accessCode": "LOVE2024-DEMO-001"}'
```

---

## 🚢 Deployment

### Railway.app (Recommended)

1. Push code to GitHub
2. Connect Railway to your repo
3. Add PostgreSQL database (auto-configured)
4. Set environment variables
5. Deploy!

**Cost:** Free tier includes 500 hours + PostgreSQL

See **SETUP_GUIDE.md** for step-by-step instructions.

---

## 🔒 Security Features

- ✅ JWT tokens (7-day expiration)
- ✅ Google OAuth (no password storage)
- ✅ Helmet middleware (security headers)
- ✅ CORS (restricted to frontend only)
- ✅ Rate limiting (100 req/15min)
- ✅ Input validation
- ✅ SQL injection prevention (parameterized queries)
- ✅ Access code verification

---

## 📊 Monitoring

**Health Check:**
```
GET /health
```

**Response:**
```json
{
  "status": "OK",
  "timestamp": "2026-01-24T10:00:00.000Z",
  "uptime": 123.45
}
```

---

## 🐛 Common Issues

### Port already in use
```bash
npx kill-port 3001
```

### Database connection failed
- Check DATABASE_URL
- Verify PostgreSQL is running
- Check network/firewall

### OAuth redirect error
- Verify callback URL in Google Console
- Check GOOGLE_CALLBACK_URL in .env

See **SETUP_GUIDE.md** for more troubleshooting.

---

## 📝 Scripts

```bash
npm start          # Start production server
npm run dev        # Start development server (auto-restart)
npm run db:migrate # Run database migrations
npm run db:seed    # Seed initial data
```

---

## 📚 Documentation

- **SETUP_GUIDE.md** - Complete setup instructions
- **API_DOCUMENTATION.md** - API reference with examples
- **.env.example** - Environment variable template

---

## 🤝 Contributing

This is a student project for college use. If you want to contribute:

1. Fork the repo
2. Create feature branch
3. Make changes
4. Test thoroughly
5. Submit pull request

---

## 📄 License

MIT License - Free to use for educational purposes

---

## 🎯 What's Next?

After setting up backend:

1. ✅ Backend running locally
2. ⬜ Connect React frontend
3. ⬜ Test all features end-to-end
4. ⬜ Deploy to production
5. ⬜ Launch to students!

---

**Need help? Check SETUP_GUIDE.md or API_DOCUMENTATION.md!** 🚀
