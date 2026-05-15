# ChatApp Frontend

Modern React-based frontend for the ChatApp real-time messaging platform. Built with Vite, React 19, Tailwind CSS, and Socket.IO for seamless user experience.

---

## 📋 Overview

This is the client-side application for ChatApp, providing a responsive and intuitive interface for real-time communication. The frontend handles user authentication, message display, real-time updates, and profile management through a modern React architecture with Zustand for state management.

---

## ✨ Features

### User Experience
- **Fast Loading**: Vite-based development and production builds
- **Responsive Design**: Mobile-first approach with Tailwind CSS
- **Real-Time Updates**: Socket.IO integration for instant messaging
- **Dark Mode Ready**: Tailwind CSS built-in dark mode support
- **Accessible**: ARIA-compliant components

### Authentication
- **Email/Password Login**: Secure authentication with JWT
- **Google OAuth**: One-click Google sign-in
- **Email Verification**: OTP-based email verification
- **Password Reset**: Forgot password with OTP flow
- **Session Management**: Automatic token refresh

### Messaging Features
- **Real-Time Chat**: Instant message delivery and display
- **Message Editing**: Edit sent messages
- **Message Deletion**: Delete messages (soft delete)
- **Read Receipts**: Track message read status
- **Typing Indicators**: See when others are typing
- **Media Sharing**: Upload and share images/files
- **Emoji Support**: Rich emoji picker integration

### User Management
- **Profile Management**: Update profile information
- **Profile Pictures**: Upload and change profile pictures
- **User Discovery**: Find and connect with other users
- **Online Status**: Real-time online/offline indicators
- **Notification Preferences**: Control notification settings

### Security
- **XSS Protection**: DOMPurify and XSS library integration
- **Secure Storage**: Proper cookie handling
- **Input Validation**: Comprehensive client-side validation
- **Password Security**: Secure password input handling

---

## 🛠️ Tech Stack

### Core Dependencies
- **React**: 19.1.0 - UI library
- **Vite**: 5.4.2 - Build tool and dev server
- **Tailwind CSS**: 4.1.11 - Utility-first CSS framework
- **React Router DOM**: 7.6.3 - Client-side routing
- **Socket.IO Client**: 4.8.3 - Real-time communication

### State Management & API
- **Zustand**: 5.0.12 - Lightweight state management
- **Axios**: 1.15.2 - HTTP client for API calls

### Security & Utilities
- **XSS**: 1.0.15 - XSS protection
- **DOMPurify**: 3.4.1 - HTML sanitization
- **Emoji Picker React**: 4.18.0 - Emoji selection

### Development Tools
- **ESLint**: 9.30.1 - Code linting
- **Terser**: 5.46.2 - Code minification
- **Vitejs Plugin React**: 4.6.0 - React Fast Refresh

### Engine Requirements
- **Node.js**: 24.x

---

## 📁 Project Structure

```
client/
├── src/
│   ├── api/                    # API client configuration
│   │   ├── auth.api.js         # Authentication endpoints
│   │   ├── axios.js            # Axios instance setup
│   │   ├── conversation.api.js # Conversation endpoints
│   │   ├── message.api.js      # Message endpoints
│   │   └── user.api.js         # User endpoints
│   │
│   ├── components/             # Reusable React components
│   │   ├── ChatContainer/      # Main chat interface
│   │   ├── ChatHome/           # Chat home page
│   │   ├── common/             # Common shared components
│   │   ├── ForgotPassword/     # Password reset flow
│   │   ├── Home/               # Home page
│   │   ├── LeftSidebar/        # Conversation list
│   │   ├── Login/              # Login component
│   │   ├── MobileBlock/        # Mobile warning
│   │   ├── OAuthCallback/      # OAuth handling
│   │   ├── Policies/           # Terms/Privacy policies
│   │   ├── Profile/            # User profile
│   │   ├── ResetPassword/      # Password reset
│   │   ├── RightSidebar/       # User profile sidebar
│   │   ├── SignUp/             # Registration
│   │   └── VerifyEmail/        # Email verification
│   │
│   ├── hooks/                  # Custom React hooks
│   │   └── useActionLock.js    # Action debouncing hook
│   │
│   ├── routes/                 # Route configuration
│   │   └── ProtectedRoute.jsx  # Route protection
│   │
│   ├── socket/                 # Socket.IO setup
│   │   ├── socket.js           # Socket initialization
│   │   └── useOnlineUsers.js   # Online status hook
│   │
│   ├── store/                  # Zustand stores
│   │   ├── auth.store.js       # Authentication state
│   │   ├── conversation.store.js # Conversation state
│   │   ├── message.store.js    # Message state
│   │   └── notification.store.js # Notification state
│   │
│   ├── styles/                 # CSS stylesheets
│   │   ├── ForgotPassword.css
│   │   └── ResetPassword.css
│   │
│   ├── utils/                  # Utility functions
│   │   ├── authLinks.js        # Authentication links
│   │   ├── desktopNotification.js # Browser notifications
│   │   ├── logger.js           # Logging utility
│   │   └── validation.js       # Input validation
│   │
│   ├── App.jsx                 # Main App component
│   ├── App.css                 # App styles
│   ├── main.jsx                # Entry point
│   └── index.css               # Global styles
│
├── public/                     # Static assets
├── index.html                  # HTML template
├── package.json                # Dependencies
├── vite.config.js              # Vite configuration
├── eslint.config.js            # ESLint rules
├── vercel.json                 # Vercel deployment
└── README.md                   # This file
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: 24.x or compatible
- **npm**: Latest version
- **Backend Server**: Running on http://localhost:8000

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd chatApp/client
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   Create `.env.local` file:
   ```env
   VITE_API_URL=http://localhost:8000
   VITE_APP_ENV=development
   ```

---

## 🔧 Development

### Start Development Server
```bash
npm run dev
```
The application opens at `http://localhost:5173` with hot module replacement.

### Build for Production
```bash
npm run build
```
Creates optimized production build in `dist/` directory.

### Preview Production Build
```bash
npm start
```
Serves the production build locally for testing.

### Run Linter
```bash
npm run lint
```
Check code quality with ESLint.

---

## 📁 API Integration

### Configuration
The frontend communicates with the backend through Axios-based API clients in the `src/api/` directory.

### Main API Endpoints Used
- **Authentication**: `/api/users/register`, `/api/users/login`, `/api/users/logout`
- **Users**: `/api/users/me`, `/api/users/profile`, `/api/users/discover`
- **Conversations**: `/api/conversations`, `/api/conversations/:id`
- **Messages**: `/api/messages/:conversationId`

### Example API Call
```javascript
import { loginUser } from '@/api/auth.api.js';

const response = await loginUser(email, password);
```

---

## 🔄 State Management (Zustand)

### Available Stores

#### Authentication Store (`auth.store.js`)
```javascript
import { useAuthStore } from '@/store/auth.store.js';

const { user, token, login, logout, isAuthenticated } = useAuthStore();
```

#### Conversation Store (`conversation.store.js`)
```javascript
import { useConversationStore } from '@/store/conversation.store.js';

const { conversations, activeConversation, addConversation } = useConversationStore();
```

#### Message Store (`message.store.js`)
```javascript
import { useMessageStore } from '@/store/message.store.js';

const { messages, addMessage, editMessage, deleteMessage } = useMessageStore();
```

#### Notification Store (`notification.store.js`)
```javascript
import { useNotificationStore } from '@/store/notification.store.js';

const { notifications, addNotification } = useNotificationStore();
```

---

## 🔌 Socket.IO Integration

### Socket Connection
Real-time communication is initialized in `src/socket/socket.js`.

### Listening to Events
```javascript
import { socket } from '@/socket/socket.js';

socket.on('newMessage', (message) => {
  // Handle new message
});

socket.on('userOnline', (userId) => {
  // Handle user online status
});
```

### Emitting Events
```javascript
socket.emit('typingStart', { conversationId });
socket.emit('sendMessage', messageData);
```

### Available Socket Events
- `newMessage`: New message received
- `messageRead`: Message marked as read
- `messageEdited`: Message was edited
- `messageDeleted`: Message was deleted
- `userOnline`: User comes online
- `userOffline`: User goes offline
- `typingStart`: User starts typing
- `typingStop`: User stops typing

---

## 🛡️ Security Features

### XSS Protection
```javascript
import DOMPurify from 'dompurify';

const cleanHTML = DOMPurify.sanitize(userInput);
```

### Input Validation
```javascript
import { validateEmail, validateUsername } from '@/utils/validation.js';

if (!validateEmail(email)) {
  // Show error
}
```

### Secure Storage
- JWT tokens stored in HTTP-only cookies
- Sensitive data not stored in localStorage
- Automatic token refresh on expiration

---

## 📱 Responsive Design

### Breakpoints (Tailwind CSS)
- **Mobile**: < 640px (sm)
- **Tablet**: 640px - 1024px (md, lg)
- **Desktop**: > 1024px (xl, 2xl)

### Mobile-First Components
- Responsive sidebar with mobile menu
- Touch-friendly buttons and inputs
- Optimized layouts for small screens

---

## 🧪 Testing

### Testing with ESLint
```bash
npm run lint
```

### Browser Testing
- Tested on Chrome, Firefox, Safari, Edge
- Mobile testing on iOS and Android browsers

---

## 🚢 Deployment

### Vercel Deployment
The project includes `vercel.json` for one-click Vercel deployment.

1. **Connect Repository**: Connect GitHub/GitLab to Vercel
2. **Configure Environment**: Add `VITE_API_URL` environment variable
3. **Deploy**: Click deploy button

### Manual Deployment
```bash
# Build the application
npm run build

# Deploy the dist/ folder to your hosting provider
```

---

## 🔍 Performance Optimization

### Features
- **Code Splitting**: Vite handles automatic code splitting
- **Tree Shaking**: Unused code removed in production
- **Minification**: Terser minifies JavaScript
- **CSS Purging**: Tailwind CSS purges unused styles
- **Lazy Loading**: Components loaded on demand

### Build Output
```
dist/index.html          # Main HTML file
dist/assets/             # Bundled JS, CSS, images
```

---

## 🐛 Debugging

### Logging
```javascript
import { logger } from '@/utils/logger.js';

logger.log('Message', data);
logger.error('Error', error);
```

### Browser DevTools
- React Developer Tools (Chrome Extension)
- Redux DevTools (for Zustand inspection)
- Network tab for API debugging
- Console for error tracking

---

## 📚 Component Documentation

### Main Components

#### ChatContainer
Displays the active conversation with message list and input area.

#### LeftSidebar
Shows list of conversations with search and create new chat.

#### RightSidebar
Displays user profile information and conversation details.

#### Login/SignUp
Authentication components for user registration and login.

#### Profile
User profile management component.

---

## 🤝 Contributing

1. Create a feature branch: `git checkout -b feature/AmazingFeature`
2. Commit changes: `git commit -m 'Add AmazingFeature'`
3. Push to branch: `git push origin feature/AmazingFeature`
4. Open a Pull Request

---

## 📝 Code Style

### Formatting
- **Tabs**: 4 spaces
- **Semicolons**: Required
- **Quotes**: Double quotes for strings
- **Arrow Functions**: Preferred over function declarations

### Component Naming
- Components: PascalCase (e.g., `ChatContainer`)
- Utilities: camelCase (e.g., `validateEmail`)
- Constants: UPPER_CASE (e.g., `API_BASE_URL`)

---

## 🔗 Useful Links

- [React Documentation](https://react.dev)
- [Vite Documentation](https://vitejs.dev)
- [Tailwind CSS](https://tailwindcss.com)
- [Zustand Documentation](https://github.com/pmndrs/zustand)
- [Socket.IO Client](https://socket.io/docs/v4/client-api/)

---

## 📄 License

ISC License - See [LICENSE](../LICENSE)

---

## 🎯 Roadmap

- [ ] Dark mode toggle
- [ ] Message search functionality
- [ ] Call/Video integration
- [ ] Message reactions
- [ ] End-to-end encryption
- [ ] Multi-language support

---

**Last Updated**: May 2026
