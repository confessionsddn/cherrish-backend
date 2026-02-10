# 🔌 LOVECONFESS API DOCUMENTATION

Complete API reference for the LoveConfess backend.

**Base URL:** `http://localhost:3001` (development) or `https://your-app.railway.app` (production)

---

## 📋 TABLE OF CONTENTS

1. [Authentication](#authentication)
2. [Confessions](#confessions)
3. [Payments](#payments)
4. [Error Handling](#error-handling)

---

## 🔐 AUTHENTICATION

All authenticated endpoints require a JWT token in the Authorization header:

```
Authorization: Bearer YOUR_JWT_TOKEN
```

### Register with Access Code

**Endpoint:** `POST /api/auth/register/verify-code`

**Description:** Verify that an access code is valid before registration.

**Request Body:**
```json
{
  "accessCode": "LOVE2024-DEMO-001"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Access code verified! You can now sign in with Google.",
  "codeId": "uuid"
}
```

---

### Complete Registration

**Endpoint:** `POST /api/auth/register/complete`

**Description:** Complete registration with Google OAuth data.

**Request Body:**
```json
{
  "accessCode": "LOVE2024-DEMO-001",
  "googleId": "1234567890",
  "email": "student@college.edu",
  "displayName": "Student Name"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Registration successful!",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "student@college.edu",
    "username": "PINK_LION1234",
    "user_number": 77,
    "credits": 150,
    "is_premium": false
  }
}
```

---

### Google OAuth Login

**Endpoint:** `GET /api/auth/google`

**Description:** Initiate Google OAuth flow.

**Response:** Redirects to Google login page.

---

### Google OAuth Callback

**Endpoint:** `GET /api/auth/google/callback`

**Description:** Handle Google OAuth callback.

**Response:** Redirects to frontend with token: `http://localhost:3000/auth/callback?token=JWT_TOKEN`

---

### Get Current User

**Endpoint:** `GET /api/auth/me`

**Auth:** Required

**Response:**
```json
{
  "user": {
    "id": "uuid",
    "email": "student@college.edu",
    "username": "PINK_LION1234",
    "user_number": 77,
    "credits": 150,
    "is_premium": false,
    "is_banned": false,
    "created_at": "2026-01-24T10:00:00.000Z"
  }
}
```

---

## 💭 CONFESSIONS

### Get All Confessions

**Endpoint:** `GET /api/confessions`

**Auth:** Optional (reactions visible only if authenticated)

**Query Parameters:**
- `mood_zone` (optional): Filter by mood (Crush, Heartbreak, Secret Admirer, Love Stories, or "all")
- `limit` (optional): Number of confessions to return (default: 50)
- `offset` (optional): Pagination offset (default: 0)

**Example:**
```
GET /api/confessions?mood_zone=Crush&limit=20&offset=0
```

**Response:**
```json
{
  "confessions": [
    {
      "id": "uuid",
      "content": "I've been secretly crushing on someone...",
      "mood_zone": "Crush",
      "is_boosted": false,
      "audio_url": null,
      "gender_revealed": false,
      "gender": null,
      "created_at": "2026-01-24T10:00:00.000Z",
      "timestamp": "2 HOURS AGO",
      "reactions": {
        "heart": 23,
        "like": 45,
        "cry": 2,
        "laugh": 5
      },
      "premium": false,
      "spotlight": false
    }
  ]
}
```

---

### Get Single Confession

**Endpoint:** `GET /api/confessions/:id`

**Auth:** Optional

**Response:**
```json
{
  "confession": {
    "id": "uuid",
    "content": "...",
    "mood_zone": "Crush",
    "reactions": { ... },
    "timestamp": "2 HOURS AGO"
  }
}
```

---

### Create Confession

**Endpoint:** `POST /api/confessions`

**Auth:** Required

**Content-Type:** `multipart/form-data` (if uploading audio)

**Request Body (Form Data):**
- `content` (required): Confession text
- `mood_zone` (required): Crush | Heartbreak | Secret Admirer | Love Stories
- `gender_revealed` (optional): true | false
- `gender` (optional): Male | Female | Other
- `audio` (optional): Audio file (max 5MB)

**Example (JavaScript):**
```javascript
const formData = new FormData();
formData.append('content', 'My confession text...');
formData.append('mood_zone', 'Crush');
formData.append('gender_revealed', 'false');
// formData.append('audio', audioBlob); // if recording exists

const response = await fetch('/api/confessions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Confession posted successfully!",
  "confession": {
    "id": "uuid",
    "content": "...",
    "mood_zone": "Crush",
    "audio_url": "https://cloudinary.com/...",
    "timestamp": "JUST NOW",
    "reactions": {
      "heart": 0,
      "like": 0,
      "cry": 0,
      "laugh": 0
    },
    "premium": true,
    "spotlight": false
  }
}
```

---

### React to Confession

**Endpoint:** `POST /api/confessions/:id/react`

**Auth:** Required

**Request Body:**
```json
{
  "reaction_type": "heart"
}
```

**Valid reaction types:** `heart`, `like`, `cry`, `laugh`

**Response (Added):**
```json
{
  "success": true,
  "action": "added",
  "reactions": {
    "heart": 24,
    "like": 45,
    "cry": 2,
    "laugh": 5
  }
}
```

**Response (Removed - toggle):**
```json
{
  "success": true,
  "action": "removed",
  "reactions": {
    "heart": 23,
    "like": 45,
    "cry": 2,
    "laugh": 5
  }
}
```

---

### Delete Confession

**Endpoint:** `DELETE /api/confessions/:id`

**Auth:** Required (can only delete own confessions)

**Response:**
```json
{
  "success": true,
  "message": "Confession deleted successfully"
}
```

---

## 💰 PAYMENTS

### Create Payment Order

**Endpoint:** `POST /api/payments/create-order`

**Auth:** Required

**Request Body:**
```json
{
  "packageType": "small"
}
```

**Package Types:**
- `small`: 50 credits for ₹10
- `medium`: 150 credits for ₹25
- `large`: 500 credits for ₹75

**Response:**
```json
{
  "success": true,
  "orderId": "order_abc123",
  "amount": 1000,
  "currency": "INR",
  "credits": 50
}
```

---

### Verify Payment

**Endpoint:** `POST /api/payments/verify-payment`

**Auth:** Required

**Request Body:**
```json
{
  "razorpay_order_id": "order_abc123",
  "razorpay_payment_id": "pay_xyz789",
  "razorpay_signature": "signature_hash"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Payment verified and credits added!",
  "creditsAdded": 50,
  "totalCredits": 200
}
```

---

### Boost Confession

**Endpoint:** `POST /api/payments/boost-confession`

**Auth:** Required

**Cost:** 10 credits

**Request Body:**
```json
{
  "confessionId": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Confession boosted for 24 hours!",
  "creditsRemaining": 140
}
```

---

### Rename Username

**Endpoint:** `POST /api/payments/rename-username`

**Auth:** Required

**Cost:** 5 credits

**Request Body:**
```json
{
  "newUsername": "COOL_STAR9999"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Username updated successfully!",
  "newUsername": "COOL_STAR9999",
  "creditsRemaining": 145
}
```

---

### Get Transaction History

**Endpoint:** `GET /api/payments/transactions`

**Auth:** Required

**Query Parameters:**
- `limit` (optional): Number of transactions (default: 20)
- `offset` (optional): Pagination offset (default: 0)

**Response:**
```json
{
  "transactions": [
    {
      "id": "uuid",
      "type": "credit_purchase",
      "amount": 10,
      "credits": 50,
      "status": "completed",
      "created_at": "2026-01-24T10:00:00.000Z",
      "metadata": { "packageType": "small" }
    }
  ]
}
```

---

## ⚠️ ERROR HANDLING

All errors follow this format:

```json
{
  "error": "Error message",
  "details": "Optional additional details"
}
```

### Common HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request (validation error) |
| 401 | Unauthorized (no token or invalid token) |
| 403 | Forbidden (banned user or insufficient permissions) |
| 404 | Not Found |
| 409 | Conflict (duplicate entry) |
| 429 | Too Many Requests (rate limited) |
| 500 | Internal Server Error |

### Example Error Response

```json
{
  "error": "Invalid token"
}
```

---

## 🔄 RATE LIMITING

The API is rate-limited to prevent abuse:

- **Limit:** 100 requests per 15 minutes per IP
- **Response when exceeded:**

```json
{
  "error": "Too many requests from this IP, please try again later."
}
```

---

## 🛡️ SECURITY

1. **JWT Tokens:** Expire after 7 days
2. **Password Hashing:** Not applicable (Google OAuth only)
3. **HTTPS:** Required in production
4. **CORS:** Restricted to frontend URL only
5. **Helmet:** Security headers enabled
6. **Rate Limiting:** Prevents DDoS attacks

---

## 📝 NOTES

- All timestamps are in ISO 8601 format (UTC)
- File uploads limited to 5MB
- Audio files are automatically converted to MP3
- Confession boosts last 24 hours
- Access codes are one-time use only
- User numbers are assigned sequentially (can't be changed except via rare number bidding)

---

## 🧪 TESTING

**Test Access Codes:**
```
LOVE2024-DEMO-001
LOVE2024-DEMO-002
LOVE2024-DEMO-003
LOVE2024-DEMO-004
LOVE2024-DEMO-005
```

**Test Razorpay Credentials:**
Use Razorpay test mode keys for development.

Test card: `4111 1111 1111 1111`  
CVV: Any 3 digits  
Expiry: Any future date

---

**Questions? Check the setup guide or contact the admin!** 🚀
