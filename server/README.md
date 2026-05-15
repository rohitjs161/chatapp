# ChatApp Backend

Professional Node.js backend for the ChatApp real-time messaging platform. Built with Express.js, Socket.IO, MongoDB, and Passport.js for secure, scalable messaging infrastructure.

---

## 📋 Overview

This is the server-side application for ChatApp, handling user authentication, message management, real-time communication via Socket.IO, and database operations. The backend provides a RESTful API with comprehensive security features, rate limiting, and email integration.

---

## ✨ Features

### Authentication & Security
- **JWT Authentication**: Token-based authentication with refresh tokens
- **Google OAuth 2.0**: Social login integration
- **Password Security**: Bcrypt hashing with salt rounds
- **OTP Verification**: Email-based OTP for registration and password reset
- **Rate Limiting**: DDoS protection with configurable rate limits
- **CORS Protection**: Configurable cross-origin resource sharing
- **Session Management**: Secure cookie-based sessions

### User Management
- **Registration**: Email verification with OTP
- **Login**: Email/password with automatic token refresh
- **Profile Management**: Update user information and profile pictures
- **Account Deletion**: Secure account removal with data cleanup
- **User Discovery**: Find and filter other users
- **Email Change**: Verify new email before changing
- **Password Reset**: Forgot password with OTP flow

### Real-Time Messaging
- **Socket.IO Integration**: WebSocket-based real-time communication
- **Online Status**: Track user presence in real-time
- **Typing Indicators**: Show when users are typing
- **Message Delivery**: Reliable message transmission
- **Read Receipts**: Track message read status
- **Online Users List**: Maintain list of active users

### Message Features
- **Create Messages**: Send text and media messages
- **Edit Messages**: Modify sent messages
- **Delete Messages**: Soft delete with content preservation
- **Read Status**: Mark messages as read
- **Media Handling**: Upload via Cloudinary integration
- **Message History**: Persistent storage with pagination

### Conversation Management
- **Conversation Requests**: Accept/reject conversation initiations
- **Conversation Muting**: Disable notifications for conversations
- **Multi-User Conversations**: Support group conversations
- **Conversation History**: Persistent conversation threads
- **Delete Conversations**: Remove conversation history

### Email Features
- **Brevo Integration**: Professional email service
- **OTP Delivery**: Send OTP for verification
- **Email Notifications**: Notify users of new messages
- **Email Templates**: Customizable email templates
- **Retry Logic**: Automatic retry for failed emails

### Database Features
- **MongoDB**: NoSQL database with Mongoose ODM
- **Indexing**: Optimized database queries
- **Validation**: Schema-level validation
- **Middleware**: Pre/post hooks for data consistency
- **Maintenance Scripts**: Database health and cleanup utilities

---

## 🛠️ Tech Stack

### Core Framework
- **Express.js**: 5.1.0 - Web framework
- **Node.js**: 20+ - JavaScript runtime

### Database & ODM
- **MongoDB**: NoSQL database
- **Mongoose**: 8.16.4 - MongoDB object modeling

### Authentication & Security
- **Passport.js**: 0.7.0 - Authentication middleware
- **Passport Google OAuth 2.0**: 2.0.0 - Google authentication
- **JWT**: 9.0.2 - JSON Web Token
- **Bcrypt**: 6.0.0 - Password hashing
- **Google Auth Library**: 10.6.2 - Google OAuth
- **XSS**: 1.0.15 - XSS protection

### Real-Time Communication
- **Socket.IO**: 4.8.3 - WebSocket framework

### File Upload & Storage
- **Cloudinary**: 2.7.0 - Cloud image storage
- **Multer**: 2.0.2 - File upload handling

### Email Service
- **Brevo**: 5.0.0 - Email service provider

### Middleware & Security
- **CORS**: 2.8.5 - Cross-origin resource sharing
- **Cookie Parser**: 1.4.7 - Cookie parsing
- **Express Rate Limit**: 8.4.0 - Request rate limiting
- **DotEnv**: 17.2.0 - Environment variables

### Development
- **Nodemon**: 3.1.10 - Auto-reload during development

---

## 📁 Project Structure

```
server/
├── src/
│   ├── api/                       # API endpoints (placeholder)
│   │
│   ├── config/                    # Configuration files
│   │   └── passport.js            # Passport strategies
│   │
│   ├── controllers/               # Route handlers
│   │   ├── user.controller.js     # User operations
│   │   ├── message.controller.js  # Message operations
│   │   └── conversation.controller.js # Conversation operations
│   │
│   ├── db/                        # Database setup
│   │   └── index.js               # MongoDB connection
│   │
│   ├── middlewares/               # Express middlewares
│   │   ├── auth.middleware.js     # JWT verification
│   │   ├── multer.middleware.js   # File upload config
│   │   └── rateLimit.middleware.js # Rate limiting rules
│   │
│   ├── models/                    # Mongoose schemas
│   │   ├── user.model.js          # User schema
│   │   ├── message.model.js       # Message schema
│   │   ├── conversation.model.js  # Conversation schema
│   │   └── pendingRegistration.model.js # Temp registration data
│   │
│   ├── routes/                    # API routes
│   │   ├── user.routes.js         # User endpoints
│   │   ├── message.routes.js      # Message endpoints
│   │   └── conversation.routes.js # Conversation endpoints
│   │
│   ├── scripts/                   # Utility scripts
│   │   ├── healLegacyConversationRequests.js # Migration
│   │   └── testEmailConfig.js     # Email testing
│   │
│   ├── socket/                    # Socket.IO setup
│   │   └── io.js                  # Socket configuration
│   │
│   ├── utils/                     # Utility functions
│   │   ├── apiError.js            # Error handling
│   │   ├── apiResponse.js         # Response formatting
│   │   ├── asyncHandler.js        # Async middleware
│   │   ├── cloudinary.js          # Cloudinary setup
│   │   ├── conversationRequest.js # Conversation logic
│   │   ├── indexManager.js        # Database indexing
│   │   ├── logger.js              # Logging utility
│   │   ├── otp.js                 # OTP generation
│   │   └── validation.js          # Input validation
│   │
│   ├── app.js                     # Express app setup
│   └── index.js                   # Server entry point
│
├── public/
│   └── temp/                      # Temporary file storage
│
├── .env                           # Environment variables
├── package.json                   # Dependencies
├── render.yaml                    # Render deployment
└── README.md                      # This file
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: 20.x or higher
- **npm**: Latest version
- **MongoDB**: Local or cloud (MongoDB Atlas)
- **Cloudinary Account**: For image storage
- **Brevo Account**: For email service
- **Google OAuth Credentials**: For OAuth integration

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd chatApp/server
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create .env file**
   ```bash
   cp .env.example .env
   ```

4. **Configure environment variables** (see below)

---

## 🔐 Environment Variables

Create a `.env` file in the server directory:

```env
# Server Configuration
NODE_ENV=development
PORT=8000

# Database
MONGODB_URI=mongodb://localhost:27017/chatapp
# OR for MongoDB Atlas:
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/chatapp

# JWT Configuration
JWT_SECRET=your_very_secure_jwt_secret_key_minimum_32_chars
JWT_EXPIRE=7d
REFRESH_TOKEN_SECRET=your_very_secure_refresh_token_secret_key
REFRESH_TOKEN_EXPIRE=30d

# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:8000/api/users/auth/google/callback

# Cloudinary (Image Storage)
CLOUDINARY_NAME=your_cloudinary_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret

# Brevo (Email Service)
BREVO_API_KEY=your_brevo_api_key
BREVO_FROM_EMAIL=noreply@yourdomain.com

# CORS & URLs
CORS_ORIGIN=http://localhost:5173
FRONTEND_URL=http://localhost:5173
CLIENT_URL=http://localhost:5173
VERCEL_URL=                    # For production Vercel deployment

# Email Configuration
EMAIL_VERIFICATION_EXPIRY=15   # Minutes
OTP_EXPIRY=10                  # Minutes
```

### Environment Variable Guide

| Variable | Description | Example |
|----------|-------------|---------|
| `MONGODB_URI` | Database connection string | `mongodb://localhost:27017/chatapp` |
| `JWT_SECRET` | Secret key for JWT signing | Random string |
| `JWT_EXPIRE` | JWT expiration time | `7d` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | From Google Cloud Console |
| `CLOUDINARY_NAME` | Cloudinary account name | From Cloudinary dashboard |
| `BREVO_API_KEY` | Brevo API key | From Brevo dashboard |

---

## 🔧 Development

### Start Development Server
```bash
npm run dev
```
Uses nodemon for auto-reload on file changes.
Server runs on `http://localhost:8000`

### Production Build
```bash
npm start
```

### Test Email Configuration
```bash
npm run test:email
```
Verifies Brevo email service is properly configured.

### Database Migration Scripts
```bash
# Heal legacy conversation requests
npm run migrate:heal-conversation-requests

# Dry run (preview changes without applying)
npm run migrate:heal-conversation-requests:dry
```

---

## 📚 API Documentation

### Base URL
```
http://localhost:8000/api
```

### Response Format
```json
{
  "success": true,
  "statusCode": 200,
  "data": { },
  "message": "Operation successful"
}
```

---

## 👤 User Endpoints

### Register User
```http
POST /users/register
Content-Type: application/json

{
  "email": "user@example.com",
  "username": "username",
  "password": "SecurePassword123!",
  "fullName": "John Doe"
}
```

### Login User
```http
POST /users/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

### Logout User
```http
POST /users/logout
Authorization: Bearer {token}
```

### Get Current User
```http
GET /users/me
Authorization: Bearer {token}
```

### Update Profile
```http
PATCH /users/profile
Authorization: Bearer {token}
Content-Type: application/json

{
  "fullName": "Jane Doe",
  "bio": "Hello world!",
  "username": "newusername"
}
```

### Update Profile Picture
```http
PATCH /users/profile-picture
Authorization: Bearer {token}
Content-Type: multipart/form-data

{
  "profilePicture": [file]
}
```

### Delete Account
```http
DELETE /users/account
Authorization: Bearer {token}
```

### Discover Users
```http
GET /users/discover?search=john&limit=20&skip=0
Authorization: Bearer {token}
```

### Verify Email
```http
POST /users/verify-email
Content-Type: application/json

{
  "email": "user@example.com",
  "otp": "123456"
}
```

### Forgot Password
```http
POST /users/forgot-password
Content-Type: application/json

{
  "email": "user@example.com"
}
```

### Reset Password
```http
POST /users/reset-password
Content-Type: application/json

{
  "email": "user@example.com",
  "otp": "123456",
  "newPassword": "NewPassword123!"
}
```

### Check Email Exists
```http
GET /users/check-email/user@example.com
```

### Check Username Exists
```http
GET /users/check-username/username
```

### Refresh Token
```http
POST /users/refresh
```

---

## 💬 Conversation Endpoints

### Get All Conversations
```http
GET /conversations
Authorization: Bearer {token}
```

### Get or Create Conversation
```http
GET /conversations/:receiverId
Authorization: Bearer {token}
```

### Delete Conversation
```http
DELETE /conversations/:conversationId
Authorization: Bearer {token}
```

### Mute/Unmute Conversation
```http
PATCH /conversations/:conversationId/mute
Authorization: Bearer {token}
Content-Type: application/json

{
  "isMuted": true
}
```

### Accept Conversation Request
```http
PATCH /conversations/:conversationId/accept
Authorization: Bearer {token}
```

### Reject Conversation Request
```http
PATCH /conversations/:conversationId/reject
Authorization: Bearer {token}
```

---

## 💌 Message Endpoints

### Send Message
```http
POST /messages/:conversationId
Authorization: Bearer {token}
Content-Type: multipart/form-data

{
  "content": "Hello!",
  "media": [file]  // Optional
}
```

### Get Messages
```http
GET /messages/:conversationId?limit=50&skip=0
Authorization: Bearer {token}
```

### Edit Message
```http
PATCH /messages/:messageId
Authorization: Bearer {token}
Content-Type: application/json

{
  "content": "Updated message"
}
```

### Delete Message
```http
DELETE /messages/:messageId
Authorization: Bearer {token}
```

### Mark as Read
```http
PATCH /messages/:messageId/read
Authorization: Bearer {token}
```

---

## 🔌 Socket.IO Events

### Server Emits

#### User Events
- `userOnline`: `{ userId, timestamp }`
- `userOffline`: `{ userId, timestamp }`

#### Message Events
- `newMessage`: `{ _id, content, sender, conversationId, timestamp }`
- `messageEdited`: `{ messageId, content, updatedAt }`
- `messageDeleted`: `{ messageId, conversationId }`
- `messageRead`: `{ messageId, readBy }`

#### Conversation Events
- `conversationCreated`: `{ conversationId, participants }`
- `conversationDeleted`: `{ conversationId }`

#### Typing Events
- `userTyping`: `{ userId, conversationId }`
- `userStoppedTyping`: `{ userId, conversationId }`

### Client Listens

- `connect`: Socket connection established
- `disconnect`: Socket disconnected
- `error`: Error occurred

---

## 🛡️ Security Features

### Authentication
- JWT tokens with expiration
- Refresh token rotation
- Secure password hashing with Bcrypt
- OTP-based email verification
- Google OAuth 2.0 integration

### Rate Limiting
- Registration: 5 requests per 15 minutes
- Login: 5 attempts per 15 minutes
- Password reset: 3 attempts per 24 hours
- General API: 100 requests per 15 minutes

### Data Protection
- XSS protection with XSS library
- MongoDB injection prevention with Mongoose
- CORS whitelist validation
- Input validation and sanitization
- Cookie security with HttpOnly flag

### Headers & Middleware
- X-Powered-By header disabled
- Trust proxy for reverse proxies
- Secure cookie handling
- CORS origin validation

---

## 🗄️ Database Schema

### User Model
```javascript
{
  email: String (unique),
  username: String (unique),
  fullName: String,
  password: String (hashed),
  profilePicture: String,
  bio: String,
  isEmailVerified: Boolean,
  createdAt: Date,
  updatedAt: Date,
  refreshTokens: [String]
}
```

### Message Model
```javascript
{
  content: String,
  sender: ObjectId (ref: User),
  conversation: ObjectId (ref: Conversation),
  mediaUrl: String,
  mediaType: String,
  readBy: [ObjectId],
  createdAt: Date,
  updatedAt: Date,
  isDeleted: Boolean
}
```

### Conversation Model
```javascript
{
  participants: [ObjectId],
  lastMessage: ObjectId,
  mutedBy: [ObjectId],
  isPending: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```

---

## 📊 Middleware

### Authentication Middleware
Verifies JWT tokens and attaches user to request.

```javascript
router.get('/protected', verifyJWT, controller);
```

### Rate Limiting Middleware
Prevents abuse with configurable limits per endpoint.

```javascript
router.post('/register', registerLimiter, registerUser);
```

### File Upload Middleware
Handles multipart file uploads with validation.

```javascript
router.patch('/profile-picture', upload.single('profilePicture'), updatePicture);
```

---

## 🔍 Error Handling

### Error Response Format
```json
{
  "success": false,
  "statusCode": 400,
  "data": null,
  "message": "Validation error message"
}
```

### Common Status Codes
- `200`: Success
- `201`: Created
- `400`: Bad Request
- `401`: Unauthorized
- `403`: Forbidden
- `404`: Not Found
- `429`: Too Many Requests (Rate Limited)
- `500`: Server Error

---

## 🧪 Testing

### Test Email Configuration
```bash
npm run test:email
```
Verifies:
- Brevo API key validity
- Email service connectivity
- From email configuration

### Database Testing
Connect to MongoDB and verify connection:
```bash
# In development, check console output
npm run dev
```

---

## 🚢 Deployment

### Render.com Deployment
The project includes `render.yaml` for automatic deployment:

1. **Connect Repository**: Link GitHub repository to Render
2. **Environment Setup**: Configure environment variables in Render dashboard
3. **Auto Deploy**: Pushes to main branch trigger automatic deployment

### Environment for Production
```env
NODE_ENV=production
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/chatapp
JWT_SECRET=long_secure_secret_key
CORS_ORIGIN=https://yourdomain.com
```

### Health Check
The server includes health check endpoint:
```http
GET /health
```

---

## 📈 Performance Optimization

### Database Indexing
Indexes created on frequently queried fields:
- User email and username
- Message conversation and sender
- Conversation participants

### Query Optimization
- Use lean() for read-only queries
- Pagination with limit and skip
- Proper field selection with projection

### Caching Opportunities
- User sessions with Redis (optional)
- Conversation metadata caching
- Online users list in memory

---

## 🐛 Debugging

### Logging
```javascript
import { logger } from './utils/logger.js';

logger.log('Info message', data);
logger.error('Error message', error);
```

### Environment Check
```bash
npm run test:email
```

### Database Connection
Check MongoDB connection status in server startup logs.

---

## 📝 Code Style

### Conventions
- **Functions**: camelCase (e.g., `getUserById`)
- **Constants**: UPPER_CASE (e.g., `MAX_FILE_SIZE`)
- **Classes**: PascalCase
- **Async/Await**: Preferred over promises
- **Error Handling**: Try-catch with asyncHandler wrapper

### Example Controller
```javascript
const getUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  
  if (!userId) {
    throw new apiError(400, 'User ID is required');
  }
  
  const user = await User.findById(userId);
  
  if (!user) {
    throw new apiError(404, 'User not found');
  }
  
  res.status(200).json(new apiResponse(200, user, 'User fetched'));
});
```

---

## 🤝 Contributing

1. Create a feature branch: `git checkout -b feature/AmazingFeature`
2. Commit changes: `git commit -m 'Add AmazingFeature'`
3. Push to branch: `git push origin feature/AmazingFeature`
4. Open a Pull Request

### Pull Request Guidelines
- Describe changes clearly
- Test before submitting
- Update documentation if needed
- Follow code style guidelines

---

## 📄 License

ISC License - See [LICENSE](../LICENSE)

---

## 🔗 Useful Resources

- [Express.js Documentation](https://expressjs.com)
- [MongoDB Documentation](https://docs.mongodb.com)
- [Mongoose ODM](https://mongoosejs.com)
- [Socket.IO Documentation](https://socket.io/docs)
- [Passport.js Strategies](http://www.passportjs.org)
- [Brevo Documentation](https://developers.brevo.com)
- [Cloudinary Upload](https://cloudinary.com/documentation)

---

## 🎯 Roadmap

- [ ] Implement message search
- [ ] Add message encryption
- [ ] Video/Audio call integration
- [ ] Message reactions
- [ ] User blocking feature
- [ ] Admin panel
- [ ] Analytics dashboard
- [ ] Message backup system

---

## 📞 Support & Troubleshooting

### Common Issues

#### Database Connection Error
```
Error: connect ECONNREFUSED 127.0.0.1:27017
```
**Solution**: Ensure MongoDB is running or check `MONGODB_URI`

#### Email Not Sending
```
Brevo API Error
```
**Solution**: Run `npm run test:email` to verify configuration

#### CORS Error
**Solution**: Check `CORS_ORIGIN` environment variable matches frontend URL

#### Token Expired
**Solution**: Use refresh token endpoint to get new access token

---

**Last Updated**: May 2026
**Version**: 1.0.0
