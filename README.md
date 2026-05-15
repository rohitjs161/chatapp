# ChatApp - Real-Time Messaging Platform

A modern, full-stack real-time chat application built with React, Node.js, Express, and Socket.IO. Experience seamless communication with features like real-time messaging, user discovery, email authentication, OAuth integration, and more.

---

## 🌟 Features

### Core Messaging Features
- **Real-Time Messaging**: Instant message delivery using Socket.IO
- **Message Management**: Edit and delete messages after sending
- **Read Receipts**: Track message read status
- **Media Sharing**: Upload and share images, files with Cloudinary integration
- **Typing Indicators**: See when others are typing
- **Online Status**: Real-time user online/offline status

### User Management
- **Email Authentication**: Secure registration with OTP verification
- **OAuth Integration**: Google authentication support
- **User Discovery**: Find and connect with other users
- **Profile Management**: Update profile information and profile pictures
- **Account Security**: Password reset with OTP, account deletion

### Conversation Features
- **Conversation Requests**: Accept/reject conversation requests
- **Mute Notifications**: Control notification settings per conversation
- **Conversation History**: Persistent message history
- **Multi-User Conversations**: Support for group conversations

### Additional Features
- **Email Notifications**: Brevo email service integration
- **Rate Limiting**: API request throttling for security
- **Input Validation**: XSS protection and data validation
- **Mobile Responsive**: Fully responsive design for all devices
- **Desktop Notifications**: Browser notification support

---

## 📋 Tech Stack

### Frontend
- **Framework**: React 19.x with Vite
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **HTTP Client**: Axios
- **Real-Time**: Socket.IO Client
- **Routing**: React Router DOM
- **Security**: XSS, DOMPurify
- **Additional**: Emoji Picker, React Hooks

### Backend
- **Runtime**: Node.js (v20+)
- **Framework**: Express.js
- **Real-Time**: Socket.IO
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: Passport.js (JWT, Google OAuth20)
- **Password Security**: Bcrypt
- **File Upload**: Cloudinary, Multer
- **Email Service**: Brevo API
- **Security**: Rate Limiting, CORS, Cookie Parser, XSS Protection
- **Development**: Nodemon

---

## 📁 Project Structure

```
chatApp/
├── client/                 # Frontend application
│   ├── src/
│   │   ├── api/           # API client configurations
│   │   ├── components/    # React components
│   │   ├── hooks/         # Custom React hooks
│   │   ├── routes/        # Route components
│   │   ├── socket/        # Socket.IO integration
│   │   ├── store/         # Zustand state stores
│   │   ├── styles/        # CSS stylesheets
│   │   └── utils/         # Utility functions
│   ├── package.json
│   └── vite.config.js
│
└── server/                # Backend application
    ├── src/
    │   ├── api/           # API implementations
    │   ├── config/        # Passport configuration
    │   ├── controllers/   # Route controllers
    │   ├── db/            # Database setup
    │   ├── middlewares/   # Express middlewares
    │   ├── models/        # MongoDB schemas
    │   ├── routes/        # API routes
    │   ├── scripts/       # Utility scripts
    │   ├── socket/        # Socket.IO setup
    │   ├── utils/         # Helper utilities
    │   ├── app.js         # Express app configuration
    │   └── index.js       # Server entry point
    ├── package.json
    └── render.yaml        # Render deployment config
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: Version 20.x or higher
- **npm**: Latest version
- **MongoDB**: Local or cloud instance
- **Environment Variables**: Required .env files

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd chatApp
   ```

2. **Setup Backend**
   ```bash
   cd server
   npm install
   ```

3. **Setup Frontend**
   ```bash
   cd ../client
   npm install
   ```

### Environment Configuration

#### Backend (.env)
```env
# MongoDB
MONGODB_URI=mongodb://localhost:27017/chatapp

# JWT
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRE=7d
REFRESH_TOKEN_SECRET=your_refresh_secret
REFRESH_TOKEN_EXPIRE=30d

# OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:8000/api/users/auth/google/callback

# Email Service (Brevo)
BREVO_API_KEY=your_brevo_api_key
BREVO_FROM_EMAIL=noreply@yourdomain.com

# Cloudinary
CLOUDINARY_NAME=your_cloudinary_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret

# CORS & URLs
CORS_ORIGIN=http://localhost:5173
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
PORT=8000
```

#### Frontend (.env.local)
```env
VITE_API_URL=http://localhost:8000
VITE_APP_ENV=development
```

---

## 🔧 Running the Application

### Backend Development
```bash
cd server
npm run dev
```
Server runs on `http://localhost:8000`

### Frontend Development
```bash
cd client
npm run dev
```
Client runs on `http://localhost:5173`

### Production Build
```bash
# Frontend
cd client
npm run build

# Backend
cd server
npm start
```

---

## 📚 API Documentation

### Base URL
```
http://localhost:8000/api
```

### User Endpoints
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/users/register` | Register new user | ❌ |
| POST | `/users/login` | Login user | ❌ |
| POST | `/users/logout` | Logout user | ✅ |
| POST | `/users/refresh` | Refresh access token | ❌ |
| GET | `/users/me` | Get current user | ✅ |
| PATCH | `/users/profile` | Update profile | ✅ |
| PATCH | `/users/profile-picture` | Update profile picture | ✅ |
| DELETE | `/users/account` | Delete account | ✅ |
| POST | `/users/forgot-password` | Request password reset | ❌ |
| POST | `/users/reset-password` | Reset password with OTP | ❌ |
| POST | `/users/verify-email` | Verify email with OTP | ❌ |
| GET | `/users/discover` | Discover other users | ✅ |
| GET | `/users/check-email/:email` | Check if email exists | ❌ |
| GET | `/users/check-username/:username` | Check if username exists | ❌ |

### Conversation Endpoints
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/conversations` | Get user's conversations | ✅ |
| GET | `/conversations/:receiverId` | Get/create conversation | ✅ |
| DELETE | `/conversations/:conversationId` | Delete conversation | ✅ |
| PATCH | `/conversations/:conversationId/mute` | Mute conversation | ✅ |
| PATCH | `/conversations/:conversationId/accept` | Accept conversation request | ✅ |
| PATCH | `/conversations/:conversationId/reject` | Reject conversation request | ✅ |

### Message Endpoints
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/messages/:conversationId` | Send message | ✅ |
| GET | `/messages/:conversationId` | Get messages | ✅ |
| PATCH | `/messages/:messageId` | Edit message | ✅ |
| DELETE | `/messages/:messageId` | Delete message | ✅ |
| PATCH | `/messages/:messageId/read` | Mark message as read | ✅ |

### Socket Events
- `userOnline`: User comes online
- `userOffline`: User goes offline
- `typingStart`: User starts typing
- `typingStop`: User stops typing
- `newMessage`: New message received
- `messageRead`: Message marked as read
- `messageEdited`: Message was edited
- `messageDeleted`: Message was deleted

---

## 🔒 Security Features

- **JWT Authentication**: Secure token-based authentication
- **Password Hashing**: Bcrypt for password security
- **CORS Protection**: Configurable cross-origin resource sharing
- **Rate Limiting**: DDoS protection with request throttling
- **XSS Protection**: Input sanitization with XSS library
- **SQL Injection Prevention**: MongoDB with Mongoose (no SQL)
- **Secure Headers**: X-powered-by header disabled
- **HTTPS Ready**: SSL/TLS support for production

---

## 📦 Scripts

### Backend Scripts
```bash
npm run dev                                # Development with auto-reload
npm run start                              # Production start
npm run test:email                         # Test email configuration
npm run migrate:heal-conversation-requests # Heal legacy conversation requests
npm run migrate:heal-conversation-requests:dry # Dry run for migration
```

### Frontend Scripts
```bash
npm run dev    # Development server
npm run build  # Production build
npm run start  # Preview production build
npm run lint   # Run ESLint
```

---

## 🧪 Testing

### Backend Email Testing
```bash
cd server
npm run test:email
```

---

## 🚢 Deployment

### Render.yaml Configuration
The project includes `render.yaml` for Render.com deployment with:
- Automatic builds on push
- Environment configuration
- Health checks
- Database setup

### Vercel Deployment (Frontend)
The frontend includes `vercel.json` configuration for one-click Vercel deployment.

---

## 📝 Contributing

1. Create a feature branch: `git checkout -b feature/AmazingFeature`
2. Commit changes: `git commit -m 'Add AmazingFeature'`
3. Push to branch: `git push origin feature/AmazingFeature`
4. Open a Pull Request

---

## 📄 License

This project is licensed under the ISC License.

---

## 👨‍💻 Author

**Rohit**

---

## 📞 Support

For support, email your-email@example.com or create an issue in the repository.

---

## 🔗 Links

- [Frontend README](./client/README.md)
- [Backend README](./server/README.md)
- [Render Documentation](https://render.com/docs)
- [Vercel Documentation](https://vercel.com/docs)

---

**Last Updated**: May 2026
