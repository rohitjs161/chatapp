import connectDB from "./db/index.js";
import dotenv from "dotenv";
import { app } from "./app.js";
import { createServer } from "http";
import { Server } from "socket.io";
import { User } from "./models/user.model.js";
import { Message } from "./models/message.model.js";
import { Conversation } from "./models/conversation.model.js";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { setSocketServer } from "./socket/io.js";
import { logger } from "./utils/logger.js";
import { reservePendingMessageSlot } from "./utils/requestReservation.js";

const emitConversationUnreadCountToUsers = (conversationId, participants, unreadCounters = {}) => {
    const participantIds = Array.isArray(participants)
        ? participants.map((participant) => String(participant?._id || participant)).filter(Boolean)
        : [];

    participantIds.forEach((participantId) => {
        const unreadCount = Number(unreadCounters?.[participantId] || 0);
        io.to(`user:${participantId}`).emit("conversation-unread-updated", {
            conversationId: String(conversationId),
            unreadCount: Number.isFinite(unreadCount) && unreadCount > 0 ? Math.floor(unreadCount) : 0,
        });
    });
};

const emitRequestExpiredToParticipants = (conversationId, participants = []) => {
    const participantIds = Array.isArray(participants)
        ? participants.map((participant) => String(participant?._id || participant)).filter(Boolean)
        : [];

    participantIds.forEach((participantId) => {
        io.to(`user:${participantId}`).emit("request_expired", {
            conversationId: String(conversationId),
            status: "expired",
        });
    });
};

// Load environment variables: prefer .env.<NODE_ENV> then fallback to .env
if (process.env.NODE_ENV) {
    try {
        dotenv.config({ path: `./.env.${process.env.NODE_ENV}` });
    } catch (e) {
        // ignore and continue to fallback
    }
}
dotenv.config({ path: "./.env" });

const requiredEnvVars = [
    "MONGODB_URI",
    "ACCESS_TOKEN_SECRET",
    "REFRESH_TOKEN_SECRET",
    "CORS_ORIGIN",
];

for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        logger.error(`❌ Missing required environment variable: ${envVar}`);
        process.exit(1);
    }
}

// --------------------------------------------------
// CONSTANTS & CONFIGURATION
// --------------------------------------------------

const MESSAGE_MAX_LENGTH = 1000;
const RATE_LIMIT_MESSAGES_PER_MINUTE = 30; // Per user, per conversation
const MAX_MARK_READ_MESSAGE_IDS = 500;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_STALE_ENTRY_MS = 10 * 60 * 1000;
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX_ENTRIES = 100000;
const RATE_LIMIT_TARGET_ENTRIES = 90000;
const RATE_LIMIT_FORCE_CLEANUP_COOLDOWN_MS = 5000;
const SOCKET_AUTH_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const SOCKET_AUTH_RATE_LIMIT_MAX_ATTEMPTS = 25;
const SOCKET_AUTH_RATE_LIMIT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const SOCKET_AUTH_RATE_LIMIT_STALE_ENTRY_MS = 10 * 60 * 1000;
const REQUEST_EXPIRY_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

// --------------------------------------------------
// VALIDATION & UTILITY FUNCTIONS
// --------------------------------------------------

/**
 * Validate MongoDB ObjectId using Mongoose utility
 */
const isValidObjectId = (id) => {
    return mongoose.Types.ObjectId.isValid(id);
};

/**
 * Validate required fields in event data
 */
const validateEventData = (data, requiredFields = []) => {
    if (!data || typeof data !== "object") return false;
    return requiredFields.every(field => 
        data[field] !== undefined && data[field] !== null && String(data[field]).trim() !== ""
    );
};

/**
 * Sanitize message content
 */
const sanitizeMessage = (content) => {
    if (typeof content !== "string") return "";
    return content.trim().slice(0, MESSAGE_MAX_LENGTH);
};

/**
 * Validate media URL to avoid unsafe schemes and malformed values
 */
const sanitizeMediaUrl = (mediaUrl) => {
    if (!mediaUrl) return null;

    if (typeof mediaUrl !== "string") return null;

    const trimmedUrl = mediaUrl.trim();
    if (!trimmedUrl) return null;

    try {
        const parsedUrl = new URL(trimmedUrl);
        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
            return null;
        }

        return parsedUrl.toString();
    } catch {
        return null;
    }
};

/**
 * Rate limiter: Track messages per user per conversation
 * { "userId:conversationId": { count, windowStart, lastSeen } }
 */
const messageRateLimits = new Map();
const socketAuthAttempts = new Map();
let lastForcedRateLimitCleanupAt = 0;

const cleanupSocketAuthAttempts = (now = Date.now()) => {
    for (const [key, value] of socketAuthAttempts.entries()) {
        if (!value || now - value.lastSeen > SOCKET_AUTH_RATE_LIMIT_STALE_ENTRY_MS) {
            socketAuthAttempts.delete(key);
        }
    }
};

const getSocketClientIp = (socket) => {
    const forwardedFor = socket.handshake.headers?.["x-forwarded-for"];

    if (typeof forwardedFor === "string" && forwardedFor.trim()) {
        return forwardedFor.split(",")[0].trim();
    }

    return socket.handshake.address || "unknown";
};

const registerSocketAuthAttempt = (socket) => {
    const now = Date.now();
    const ip = getSocketClientIp(socket);
    const current = socketAuthAttempts.get(ip);

    if (!current || now - current.windowStart >= SOCKET_AUTH_RATE_LIMIT_WINDOW_MS) {
        socketAuthAttempts.set(ip, {
            count: 1,
            windowStart: now,
            lastSeen: now,
        });
        return true;
    }

    current.count += 1;
    current.lastSeen = now;
    socketAuthAttempts.set(ip, current);

    return current.count <= SOCKET_AUTH_RATE_LIMIT_MAX_ATTEMPTS;
};

const clearSocketAuthAttempts = (socket) => {
    const ip = getSocketClientIp(socket);
    socketAuthAttempts.delete(ip);
};

const enforceRateLimitMapBounds = (now) => {
    if (messageRateLimits.size <= RATE_LIMIT_MAX_ENTRIES) {
        return;
    }

    if (now - lastForcedRateLimitCleanupAt < RATE_LIMIT_FORCE_CLEANUP_COOLDOWN_MS) {
        return;
    }

    lastForcedRateLimitCleanupAt = now;
    cleanupRateLimitEntries({ force: true, now });
};

const checkRateLimit = (userId, conversationId) => {
    const key = `${userId}:${conversationId}`;
    const now = Date.now();

    enforceRateLimitMapBounds(now);
    
    let limit = messageRateLimits.get(key);
    
    if (!limit || now - limit.windowStart >= RATE_LIMIT_WINDOW_MS) {
        // Reset the counter every 60 seconds for this user/conversation pair
        limit = { count: 0, windowStart: now, lastSeen: now };
    }
    
    if (limit.count >= RATE_LIMIT_MESSAGES_PER_MINUTE) {
        limit.lastSeen = now;
        messageRateLimits.set(key, limit);
        return false; // Rate limited
    }
    
    limit.count++;
    limit.lastSeen = now;
    messageRateLimits.set(key, limit);
    return true;
};

const cleanupRateLimitEntries = ({ force = false, now = Date.now() } = {}) => {

    for (const [key, limit] of messageRateLimits.entries()) {
        if (!limit || now - limit.lastSeen > RATE_LIMIT_STALE_ENTRY_MS) {
            messageRateLimits.delete(key);
        }
    }

    if (!force || messageRateLimits.size <= RATE_LIMIT_TARGET_ENTRIES) {
        return;
    }

    const entries = [];
    for (const [key, limit] of messageRateLimits.entries()) {
        entries.push([key, limit?.lastSeen || 0]);
    }

    entries.sort((a, b) => a[1] - b[1]);
    const deleteCount = Math.max(0, messageRateLimits.size - RATE_LIMIT_TARGET_ENTRIES);

    for (let i = 0; i < deleteCount; i++) {
        messageRateLimits.delete(entries[i][0]);
    }
};

const cleanupUserRateLimitEntries = (userId) => {
    const prefix = `${userId}:`;

    for (const key of messageRateLimits.keys()) {
        if (key.startsWith(prefix)) {
            messageRateLimits.delete(key);
        }
    }
};

const rateLimitCleanupTimer = setInterval(() => {
    cleanupRateLimitEntries();
}, RATE_LIMIT_CLEANUP_INTERVAL_MS);

const socketAuthCleanupTimer = setInterval(() => {
    cleanupSocketAuthAttempts();
}, SOCKET_AUTH_RATE_LIMIT_CLEANUP_INTERVAL_MS);

const requestExpirySweepTimer = setInterval(async () => {
    try {
        const expiredConversations = await Conversation.find({
            status: "pending",
            expiresAt: { $lt: new Date() },
        }).select("_id participants").lean();

        if (!expiredConversations.length) return;

        const expiredIds = expiredConversations.map((conversation) => conversation._id);

        await Conversation.updateMany(
            { _id: { $in: expiredIds } },
            { $set: { status: "expired" } }
        );

        expiredConversations.forEach((conversation) => {
            emitRequestExpiredToParticipants(conversation._id, conversation.participants);
        });
    } catch (error) {
        logger.error("❌ Request expiry sweep failed:", error?.message || error);
    }
}, REQUEST_EXPIRY_SWEEP_INTERVAL_MS);

if (typeof rateLimitCleanupTimer.unref === "function") {
    rateLimitCleanupTimer.unref();
}

if (typeof socketAuthCleanupTimer.unref === "function") {
    socketAuthCleanupTimer.unref();
}

if (typeof requestExpirySweepTimer.unref === "function") {
    requestExpirySweepTimer.unref();
}

const replyAck = (ack, payload) => {
    if (typeof ack === "function") {
        ack(payload);
    }
};

/**
 * Extract a bearer token from socket auth or headers
 */
const getSocketToken = (socket) => {
    const authToken = socket.handshake.auth?.token || socket.handshake.auth?.accessToken;

    if (authToken) {
        return String(authToken).replace(/^Bearer\s+/i, "").trim();
    }

    const headerToken = socket.handshake.headers?.authorization || socket.handshake.headers?.Authorization;
    if (typeof headerToken === "string" && headerToken.trim()) {
        return headerToken.replace(/^Bearer\s+/i, "").trim();
    }

    return null;
};

// --------------------------------------------------
// CREATE HTTP SERVER & SOCKET.IO
// --------------------------------------------------

const httpServer = createServer(app);

const io = new Server(httpServer, {
    cors: {
        origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()) : undefined,
        methods: ["GET", "POST"],
        credentials: true,
    },
    transports: ["websocket", "polling"],
});

/**
 * Store online users with their socket information
 * { userId: { socketIds: Set, fullName, email, lastOnline } }
 */
const onlineUsers = new Map();

const getOnlineUserIds = () => Array.from(onlineUsers.keys());

const emitOnlineUsers = () => {
    io.emit("get-online-users", getOnlineUserIds());
};

const markSocketOnline = (socket) => {
    const userId = socket.userId;
    const existingUser = onlineUsers.get(userId);
    const isFirstPresence = !existingUser;

    if (existingUser) {
        existingUser.socketIds.add(socket.id);
        existingUser.lastOnline = new Date();
        return { isFirstPresence: false, socketCount: existingUser.socketIds.size };
    }

    onlineUsers.set(userId, {
        socketIds: new Set([socket.id]),
        fullName: socket.userFullName,
        email: socket.userEmail,
        lastOnline: new Date(),
    });

    return { isFirstPresence, socketCount: 1 };
};

const markSocketOffline = (socket) => {
    const userId = socket.userId;
    const user = onlineUsers.get(userId);

    if (!user) {
        return { removed: false, isFullyOffline: false, socketCount: 0 };
    }

    const socketRemoved = user.socketIds.delete(socket.id);

    if (!socketRemoved && user.socketIds.size === 0) {
        onlineUsers.delete(userId);
        return { removed: true, isFullyOffline: true, socketCount: 0 };
    }

    if (user.socketIds.size > 0) {
        return { removed: socketRemoved, isFullyOffline: false, socketCount: user.socketIds.size };
    }

    onlineUsers.delete(userId);
    return { removed: socketRemoved, isFullyOffline: true, socketCount: 0 };
};

const isSocketInConversationRoom = (socket, conversationId) => {
    return socket.rooms.has(conversationId) || socket.data.joinedConversationIds?.has(conversationId);
};

const ensureConversationAccess = async (
    socket,
    conversationId,
    { autoJoinIfMissing = false, verifyDbOnRoomHit = false } = {}
) => {
    const inRoom = isSocketInConversationRoom(socket, conversationId);

    // Fast path: room is already joined and caller does not require DB re-validation.
    if (inRoom && !verifyDbOnRoomHit) {
        return { ok: true, inRoom: true, autoJoined: false };
    }

    const hasAccess = await Conversation.exists({
        _id: conversationId,
        participants: socket.userId,
    });

    if (!hasAccess) {
        return {
            ok: false,
            code: "CONV_ACCESS_DENIED",
            message: "Access denied or conversation not found",
            inRoom,
        };
    }

    if (!inRoom) {
        if (!autoJoinIfMissing) {
            return {
                ok: false,
                code: "ROOM_NOT_JOINED",
                message: "Join the conversation before this action",
                inRoom: false,
            };
        }

        // Race-safe fallback: if user has DB access but room is not yet joined, join now.
        socket.join(conversationId);
        if (!socket.data.joinedConversationIds) {
            socket.data.joinedConversationIds = new Set();
        }
        socket.data.joinedConversationIds.add(conversationId);
        return { ok: true, inRoom: false, autoJoined: true };
    }

    return { ok: true, inRoom: true, autoJoined: false };
};

// --------------------------------------------------
// SOCKET AUTHENTICATION MIDDLEWARE
// --------------------------------------------------

io.use(async (socket, next) => {
    try {
        if (!registerSocketAuthAttempt(socket)) {
            const error = new Error("Too many connection attempts");
            error.data = { code: "AUTH_RATE_LIMITED" };
            return next(error);
        }

        const token = getSocketToken(socket);

        if (!token) {
            const error = new Error("Authentication token missing");
            error.data = { code: "AUTH_TOKEN_MISSING" };
            return next(error);
        }

        if (!process.env.ACCESS_TOKEN_SECRET) {
            const error = new Error("Server authentication is not configured");
            error.data = { code: "AUTH_CONFIG_ERROR" };
            return next(error);
        }

        // Verify JWT token securely
        const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

        if (!decodedToken || typeof decodedToken !== "object" || !decodedToken._id) {
            const error = new Error("Invalid token payload");
            error.data = { code: "AUTH_TOKEN_INVALID" };
            return next(error);
        }

        // Validate ObjectId format before querying MongoDB
        if (!isValidObjectId(decodedToken._id)) {
            const error = new Error("Invalid user ID format");
            error.data = { code: "AUTH_USER_ID_INVALID" };
            return next(error);
        }

        // Fetch only safe fields from database
        const user = await User.findById(decodedToken._id)
            .select("fullName username email profilePicture bio");

        if (!user) {
            const error = new Error("User not found");
            error.data = { code: "AUTH_USER_NOT_FOUND" };
            return next(error);
        }

        // Attach sanitized user info to socket
        socket.userId = user._id.toString();
        socket.userFullName = user.fullName;
        socket.userEmail = user.email;
        socket.user = {
            _id: user._id.toString(),
            fullName: user.fullName,
            username: user.username,
            email: user.email,
            profilePicture: user.profilePicture,
            bio: user.bio,
        };
        socket.data.user = socket.user;

        clearSocketAuthAttempts(socket);

        next();
    } catch (error) {
        const isTokenExpired = error?.name === "TokenExpiredError";
        const isInvalidToken = error?.name === "JsonWebTokenError" || error?.name === "NotBeforeError";

        logger.error("🔐 Socket auth error:", {
            message: error?.message,
            name: error?.name,
        });

        const authError = new Error(
            isTokenExpired ? "Token expired" : isInvalidToken ? "Invalid token" : "Authentication failed"
        );
        authError.data = {
            code: isTokenExpired
                ? "AUTH_TOKEN_EXPIRED"
                : isInvalidToken
                    ? "AUTH_TOKEN_INVALID"
                    : "AUTH_FAILED",
        };
        next(authError);
    }
});

// --------------------------------------------------
// SOCKET.IO CONNECTION EVENTS
// --------------------------------------------------

io.on("connection", (socket) => {
    socket.data.joinedConversationIds = new Set();
    socket.join(`user:${socket.userId}`);

    logger.log(`✅ User connected - ID: ${socket.userId}, Socket: ${socket.id}`);

    // --------------------------------------------------
    // USER COMES ONLINE (Handle Multiple Tabs)
    // --------------------------------------------------
    socket.on("user-online", (_, ack) => {
        try {
            const isAlreadyTracked = onlineUsers.has(socket.userId);

            if (socket.data.isOnlineRegistered && isAlreadyTracked) {
                const onlineStatus = {
                    userId: socket.userId,
                    online: true,
                    tabCount: onlineUsers.get(socket.userId)?.socketIds?.size || 1,
                };
                socket.emit("get-online-users", getOnlineUserIds());
                socket.emit("online-status", onlineStatus);
                replyAck(ack, { success: true, code: "SUCCESS", data: onlineStatus });
                return;
            }

            // Track multiple sockets per user (multi-tab support)
            const { isFirstPresence, socketCount } = markSocketOnline(socket);
            socket.data.isOnlineRegistered = true;

            if (isFirstPresence) {
                emitOnlineUsers();
            }

            const onlineStatus = {
                userId: socket.userId,
                online: true,
                tabCount: socketCount,
                firstPresence: isFirstPresence,
            };

            socket.emit("get-online-users", getOnlineUserIds());
            socket.emit("online-status", onlineStatus);
            replyAck(ack, { success: true, code: "SUCCESS", data: onlineStatus });

            logger.log(`📍 User online: ${socket.userId} (${socketCount} tab(s)) | Total online: ${getOnlineUserIds().length}`);
        } catch (error) {
            logger.error("❌ Error in user-online:", error.message);
            socket.emit("error", { message: "Failed to mark user online", code: "ONLINE_ERROR" });
            replyAck(ack, { success: false, code: "ONLINE_ERROR", message: "Failed to mark user online" });
        }
    });

    // --------------------------------------------------
    // REQUEST ONLINE USERS SNAPSHOT
    // --------------------------------------------------
    socket.on("request-online-users", (_, ack) => {
        try {
            const userIds = getOnlineUserIds();
            socket.emit("get-online-users", userIds);
            replyAck(ack, { success: true, code: "SUCCESS", data: { userIds } });
        } catch (error) {
            logger.error("❌ Error in request-online-users:", error.message);
            replyAck(ack, {
                success: false,
                code: "ONLINE_USERS_FETCH_ERROR",
                message: "Failed to fetch online users",
            });
        }
    });

    // --------------------------------------------------
    // JOIN CONVERSATION ROOM (Validate Access)
    // --------------------------------------------------
    socket.on("join-conversation", async (conversationId, ack) => {
        try {
            const trimmedConversationId = typeof conversationId === "string" ? conversationId.trim() : "";

            // Validate conversationId format
            if (!trimmedConversationId || !isValidObjectId(trimmedConversationId)) {
                socket.emit("error", { message: "Invalid conversation ID format", code: "INVALID_CONV_ID" });
                replyAck(ack, { success: false, code: "INVALID_CONV_ID", message: "Invalid conversation ID format" });
                return;
            }

            // Security: Verify user is authenticated (double-check token is still valid)
            if (!socket.userId || !socket.user) {
                socket.emit("error", { message: "Authentication required", code: "AUTH_REQUIRED" });
                replyAck(ack, { success: false, code: "AUTH_REQUIRED", message: "Authentication required" });
                return;
            }

            // Verify conversation exists and user is a participant in a single query
            const conversation = await Conversation.findOne({
                _id: trimmedConversationId,
                participants: socket.userId,
            }).select("_id participants");

            if (!conversation) {
                logger.warn(`🚨 SECURITY: Unauthorized join attempt - User ${socket.userId} tried to join conversation ${trimmedConversationId}`);
                socket.emit("error", { message: "Access denied or conversation not found", code: "CONV_ACCESS_DENIED" });
                replyAck(ack, { success: false, code: "CONV_ACCESS_DENIED", message: "Access denied or conversation not found" });
                return;
            }

            // Additional security: Verify socket user ID matches database participant
            const isParticipant = conversation.participants.some(p => String(p) === String(socket.userId));
            if (!isParticipant) {
                logger.warn(`🚨 SECURITY: Participant mismatch - User ${socket.userId} claimed access to conversation ${trimmedConversationId}`);
                socket.emit("error", { message: "Access denied", code: "CONV_ACCESS_DENIED" });
                replyAck(ack, { success: false, code: "CONV_ACCESS_DENIED", message: "Access denied" });
                return;
            }

            socket.join(trimmedConversationId);
            socket.data.joinedConversationIds.add(trimmedConversationId);
            socket.emit("conversation-joined", { conversationId: trimmedConversationId, success: true });
            replyAck(ack, { success: true, code: "SUCCESS", data: { conversationId: trimmedConversationId } });
            logger.log(`✅ User ${socket.userId} securely joined conversation: ${trimmedConversationId}`);
        } catch (error) {
            logger.error("❌ Error joining conversation:", error.message);
            socket.emit("error", { message: "Failed to join conversation", code: "JOIN_ERROR" });
            replyAck(ack, { success: false, code: "JOIN_ERROR", message: "Failed to join conversation" });
        }
    });

    // --------------------------------------------------
    // LEAVE CONVERSATION ROOM (Verify Authorization)
    // --------------------------------------------------
    socket.on("leave-conversation", async (conversationId, ack) => {
        try {
            const trimmedConversationId = typeof conversationId === "string" ? conversationId.trim() : "";

            if (!trimmedConversationId || !isValidObjectId(trimmedConversationId)) {
                socket.emit("error", { message: "Invalid conversation ID format", code: "INVALID_CONV_ID" });
                replyAck(ack, { success: false, code: "INVALID_CONV_ID", message: "Invalid conversation ID format" });
                return;
            }

            // Security: Verify user is actually a participant before allowing leave
            const conversation = await Conversation.findOne({
                _id: trimmedConversationId,
                participants: socket.userId,
            }).select("_id");

            if (!conversation) {
                logger.warn(`🚨 SECURITY: Unauthorized leave attempt - User ${socket.userId} tried to leave conversation ${trimmedConversationId}`);
                socket.emit("error", { message: "Access denied or conversation not found", code: "CONV_ACCESS_DENIED" });
                replyAck(ack, { success: false, code: "CONV_ACCESS_DENIED", message: "Access denied or conversation not found" });
                return;
            }

            socket.leave(trimmedConversationId);
            socket.data.joinedConversationIds.delete(trimmedConversationId);
            socket.emit("conversation-left", { conversationId: trimmedConversationId, success: true });
            replyAck(ack, { success: true, code: "SUCCESS", data: { conversationId: trimmedConversationId } });
            logger.log(`✅ User ${socket.userId} left conversation: ${trimmedConversationId}`);
        } catch (error) {
            logger.error("❌ Error leaving conversation:", error.message);
            socket.emit("error", { message: "Failed to leave conversation", code: "LEAVE_ERROR" });
            replyAck(ack, { success: false, code: "LEAVE_ERROR", message: "Failed to leave conversation" });
        }
    });

    // --------------------------------------------------
    // SEND MESSAGE (With Database Persistence)
    // --------------------------------------------------
    socket.on("send-message", async (messageData, ack) => {
        try {
            // Validate message data
            if (!validateEventData(messageData, ["conversation", "content"])) {
                socket.emit("message-failed", { 
                    message: "Message data incomplete or invalid",
                    code: "INVALID_DATA"
                });
                replyAck(ack, { success: false, code: "INVALID_DATA", message: "Message data incomplete or invalid" });
                return;
            }

            const { conversation, content, mediaUrl } = messageData;
            const sender = socket.userId;
            const trimmedConversationId = typeof conversation === "string" ? conversation.trim() : "";

            // Validate ObjectIds
            if (!trimmedConversationId || !isValidObjectId(trimmedConversationId) || !isValidObjectId(sender)) {
                socket.emit("message-failed", { 
                    message: "Invalid conversation ID format",
                    code: "INVALID_ID_FORMAT"
                });
                replyAck(ack, { success: false, code: "INVALID_ID_FORMAT", message: "Invalid conversation ID format" });
                return;
            }

            const access = await ensureConversationAccess(socket, trimmedConversationId, {
                autoJoinIfMissing: true,
                verifyDbOnRoomHit: true,
            });

            if (!access.ok) {
                socket.emit("message-failed", {
                    message: access.message,
                    code: access.code,
                });
                replyAck(ack, { success: false, code: access.code, message: access.message });
                return;
            }

            const requestConversation = await Conversation.findById(trimmedConversationId)
                .select("participants status initiator pendingMessageCount expiresAt")
                .lean();

            if (!requestConversation) {
                socket.emit("message-failed", {
                    message: "Conversation not found",
                    code: "CONV_NOT_FOUND",
                });
                replyAck(ack, { success: false, code: "CONV_NOT_FOUND", message: "Conversation not found" });
                return;
            }

            let effectiveStatus = requestConversation.status || "pending";
            const now = Date.now();

            if (
                effectiveStatus === "pending" &&
                requestConversation.expiresAt &&
                new Date(requestConversation.expiresAt).getTime() < now
            ) {
                await Conversation.updateOne(
                    { _id: trimmedConversationId },
                    { $set: { status: "expired" } }
                );
                effectiveStatus = "expired";
                emitRequestExpiredToParticipants(trimmedConversationId, requestConversation.participants);
            }

            if (effectiveStatus === "expired") {
                socket.emit("message-failed", {
                    message: "Request expired. Send again.",
                    code: "REQUEST_EXPIRED",
                });
                replyAck(ack, { success: false, code: "REQUEST_EXPIRED", message: "Request expired. Send again." });
                return;
            }

            if (effectiveStatus === "rejected") {
                socket.emit("message-failed", {
                    message: "Chat request was rejected.",
                    code: "REQUEST_REJECTED",
                });
                replyAck(ack, { success: false, code: "REQUEST_REJECTED", message: "Chat request was rejected." });
                return;
            }

            // Sanitize message content
            const sanitizedContent = sanitizeMessage(content);
            const safeMediaUrl = sanitizeMediaUrl(mediaUrl);
            if (mediaUrl && !safeMediaUrl) {
                socket.emit("message-failed", {
                    message: "Invalid media URL",
                    code: "INVALID_MEDIA_URL",
                });
                replyAck(ack, { success: false, code: "INVALID_MEDIA_URL", message: "Invalid media URL" });
                return;
            }

            if (effectiveStatus === "pending") {
                const initiatorId = requestConversation.initiator ? String(requestConversation.initiator) : "";

                if (initiatorId && String(sender) !== initiatorId) {
                    socket.emit("message-failed", {
                        message: "Accept request to reply",
                        code: "REQUEST_REPLY_BLOCKED",
                    });
                    replyAck(ack, { success: false, code: "REQUEST_REPLY_BLOCKED", message: "Accept request to reply" });
                    return;
                }

                if (safeMediaUrl) {
                    socket.emit("message-failed", {
                        message: "Media not allowed before acceptance",
                        code: "REQUEST_PENDING_TEXT_ONLY",
                    });
                    replyAck(ack, {
                        success: false,
                        code: "REQUEST_PENDING_TEXT_ONLY",
                        message: "Media not allowed before acceptance",
                    });
                    return;
                }

                if (!sanitizedContent) {
                    socket.emit("message-failed", {
                        message: "Only text messages are allowed before acceptance",
                        code: "REQUEST_PENDING_TEXT_ONLY",
                    });
                    replyAck(ack, {
                        success: false,
                        code: "REQUEST_PENDING_TEXT_ONLY",
                        message: "Only text messages are allowed before acceptance",
                    });
                    return;
                }

                // Atomically reserve a pending-message slot to prevent race conditions
                try {
                    await reservePendingMessageSlot(trimmedConversationId, sender, Conversation);
                } catch (err) {
                    if (err?.statusCode === 403) {
                        socket.emit("message-failed", {
                            message: "Message request limit reached",
                            code: "REQUEST_PENDING_LIMIT",
                        });
                        replyAck(ack, { success: false, code: "REQUEST_PENDING_LIMIT", message: "Message request limit reached" });
                        return;
                    }

                    logger.error("❌ Error reserving request slot:", err?.message || err);
                    socket.emit("message-failed", {
                        message: "Failed to reserve request slot",
                        code: "REQUEST_RESERVATION_ERROR",
                    });
                    replyAck(ack, { success: false, code: "REQUEST_RESERVATION_ERROR", message: "Failed to reserve request slot" });
                    return;
                }
            } else if (!sanitizedContent && !safeMediaUrl) {
                socket.emit("message-failed", { 
                    message: "Message cannot be empty",
                    code: "EMPTY_MESSAGE"
                });
                replyAck(ack, { success: false, code: "EMPTY_MESSAGE", message: "Message cannot be empty" });
                return;
            }

            // Check rate limiting
            if (!checkRateLimit(sender, trimmedConversationId)) {
                socket.emit("message-failed", { 
                    message: `Rate limited: max ${RATE_LIMIT_MESSAGES_PER_MINUTE} messages per minute`,
                    code: "RATE_LIMITED"
                });
                replyAck(ack, { success: false, code: "RATE_LIMITED", message: `Rate limited: max ${RATE_LIMIT_MESSAGES_PER_MINUTE} messages per minute` });
                return;
            }

            // Save message to database
            const newMessage = await Message.create({
                sender,
                conversation: trimmedConversationId,
                content: sanitizedContent,
                mediaUrl: safeMediaUrl,
                deliveredTo: [sender],
                readBy: [sender], // Mark as read by sender
            });

            // Populate sender details
            await newMessage.populate("sender", "fullName email");

            const conversationParticipants = await Conversation.findById(trimmedConversationId)
                .select("participants status initiator pendingMessageCount expiresAt")
                .lean();

            if (conversationParticipants?.status === "pending") {
                const initiatorId = String(conversationParticipants?.initiator || "");
                const receiverId = Array.isArray(conversationParticipants?.participants)
                    ? conversationParticipants.participants
                        .map((participant) => String(participant?._id || participant))
                        .find((participantId) => participantId && participantId !== initiatorId)
                    : null;

                if (receiverId) {
                    io.to(`user:${receiverId}`).emit("new_message_request", {
                        conversationId: trimmedConversationId,
                        status: "pending",
                        pendingMessageCount: Number(conversationParticipants?.pendingMessageCount || 0),
                        initiator: initiatorId,
                        expiresAt: conversationParticipants?.expiresAt || null,
                    });
                }
            }

            const participantIds = Array.isArray(conversationParticipants?.participants)
                ? conversationParticipants.participants.map((participant) => String(participant?._id || participant)).filter(Boolean)
                : [];

            // Update conversation's lastMessage
            const incUpdate = {};

            participantIds.forEach((participantId) => {
                if (participantId === String(sender)) return;
                incUpdate[`unreadCounters.${participantId}`] = 1;
            });

            await Conversation.updateOne(
                { _id: trimmedConversationId },
                {
                    $set: { lastMessage: newMessage._id },
                    ...(Object.keys(incUpdate).length > 0 ? { $inc: incUpdate } : {}),
                }
            );

            const unreadState = await Conversation.findById(trimmedConversationId)
                .select("participants unreadCounters")
                .lean();

            emitConversationUnreadCountToUsers(
                trimmedConversationId,
                unreadState?.participants,
                unreadState?.unreadCounters || {}
            );

            // Prepare message payload for socket emission
            const messagePayload = {
                _id: newMessage._id,
                sender: newMessage.sender,
                conversation: newMessage.conversation,
                content: newMessage.content,
                mediaUrl: newMessage.mediaUrl,
                createdAt: newMessage.createdAt,
                isEdited: false,
                isDeleted: false,
                deliveredTo: newMessage.deliveredTo,
                readBy: newMessage.readBy,
            };

            const uniqueParticipantIds = [...new Set(participantIds)];
            uniqueParticipantIds.forEach((participantId) => {
                io.to(`user:${participantId}`).emit("receive-message", messagePayload);
            });

            // Send acknowledgment to sender
            socket.emit("message-sent", {
                messageId: newMessage._id,
                conversationId: trimmedConversationId,
                code: "SUCCESS"
            });
            replyAck(ack, {
                success: true,
                code: "SUCCESS",
                data: {
                    messageId: newMessage._id,
                    conversationId: trimmedConversationId,
                },
            });

            logger.log(`💬 Message saved: ${newMessage._id} in conversation: ${trimmedConversationId}`);

        } catch (error) {
            logger.error("❌ Error sending message:", {
                message: error?.message,
                name: error?.name,
            });
            socket.emit("message-failed", { 
                message: "Failed to send message. Please try again.",
                code: "SERVER_ERROR"
            });
            replyAck(ack, { success: false, code: "SERVER_ERROR", message: "Failed to send message. Please try again." });
        }
    });

    // --------------------------------------------------
    // TYPING INDICATOR (No Changes, Already Good)
    // --------------------------------------------------
    socket.on("typing", async ({ conversationId }) => {
        try {
            const trimmedConversationId = typeof conversationId === "string" ? conversationId.trim() : "";

            if (!trimmedConversationId || !isValidObjectId(trimmedConversationId)) {
                socket.emit("error", { message: "Invalid typing data", code: "INVALID_DATA" });
                return;
            }

            const access = await ensureConversationAccess(socket, trimmedConversationId, {
                autoJoinIfMissing: true,
                verifyDbOnRoomHit: true,
            });

            if (!access.ok) {
                socket.emit("error", { message: access.message, code: access.code || "CONV_ACCESS_DENIED" });
                return;
            }

            // Keep payload lightweight and source identity from the authenticated socket
            socket.to(trimmedConversationId).emit("user-typing", {
                conversationId: trimmedConversationId,
                userId: socket.userId,
                fullName: socket.userFullName,
            });
        } catch (error) {
            logger.error("❌ Error in typing event:", error.message);
            socket.emit("error", { message: "Failed to send typing indicator", code: "TYPING_ERROR" });
        }
    });

    // --------------------------------------------------
    // STOP TYPING (No Changes, Already Good)
    // --------------------------------------------------
    socket.on("stop-typing", async ({ conversationId }) => {
        try {
            const trimmedConversationId = typeof conversationId === "string" ? conversationId.trim() : "";

            if (!trimmedConversationId || !isValidObjectId(trimmedConversationId)) {
                socket.emit("error", { message: "Invalid conversation ID format", code: "INVALID_CONV_ID" });
                return;
            }

            const access = await ensureConversationAccess(socket, trimmedConversationId, {
                autoJoinIfMissing: true,
                verifyDbOnRoomHit: true,
            });

            if (!access.ok) {
                socket.emit("error", { message: access.message, code: access.code || "CONV_ACCESS_DENIED" });
                return;
            }

            // Emit to everyone else in the room, keeping the payload lightweight
            socket.to(trimmedConversationId).emit("user-stop-typing", {
                conversationId: trimmedConversationId,
                userId: socket.userId,
            });
        } catch (error) {
            logger.error("❌ Error in stop-typing event:", error.message);
            socket.emit("error", { message: "Failed to stop typing", code: "STOP_TYPING_ERROR" });
        }
    });

    // --------------------------------------------------
    // MARK MESSAGES AS DELIVERED
    // --------------------------------------------------
    socket.on("mark-delivered", async ({ conversationId, messageIds }, ack) => {
        try {
            const trimmedConversationId = typeof conversationId === "string" ? conversationId.trim() : "";

            if (!trimmedConversationId || !isValidObjectId(trimmedConversationId)) {
                replyAck(ack, { success: false, code: "INVALID_CONV_ID", message: "Invalid conversation ID format" });
                return;
            }

            const access = await ensureConversationAccess(socket, trimmedConversationId, {
                autoJoinIfMissing: true,
                verifyDbOnRoomHit: true,
            });

            if (!access.ok) {
                replyAck(ack, { success: false, code: access.code, message: access.message });
                return;
            }

            if (!Array.isArray(messageIds) || messageIds.length === 0) {
                replyAck(ack, { success: false, code: "INVALID_MESSAGE_IDS", message: "messageIds must be a non-empty array" });
                return;
            }

            const validMessageIds = [...new Set(
                messageIds
                    .map((messageId) => (typeof messageId === "string" ? messageId.trim() : ""))
                    .filter((messageId) => messageId && isValidObjectId(messageId))
            )];

            if (!validMessageIds.length) {
                replyAck(ack, { success: false, code: "INVALID_MESSAGE_ID", message: "No valid message IDs provided" });
                return;
            }

            const result = await Message.updateMany(
                {
                    _id: { $in: validMessageIds },
                    conversation: trimmedConversationId,
                    isDeleted: false,
                },
                {
                    $addToSet: { deliveredTo: socket.userId },
                }
            );

            if (!result.matchedCount) {
                replyAck(ack, { success: false, code: "NO_MESSAGES_MATCHED", message: "No messages matched this conversation" });
                return;
            }

            socket.to(trimmedConversationId).emit("messages-delivered", {
                conversationId: trimmedConversationId,
                userId: socket.userId,
                messageIds: validMessageIds,
            });

            replyAck(ack, {
                success: true,
                code: "SUCCESS",
                data: {
                    conversationId: trimmedConversationId,
                    messageIds: validMessageIds,
                    matchedCount: result.matchedCount,
                    modifiedCount: result.modifiedCount,
                },
            });
        } catch (error) {
            logger.error("❌ Error marking messages delivered:", error.message);
            replyAck(ack, { success: false, code: "DELIVERY_ERROR", message: "Failed to mark messages delivered" });
        }
    });

    // --------------------------------------------------
    // MARK MESSAGES AS READ
    // --------------------------------------------------
    socket.on("mark-read", async ({ conversationId, messageIds }, ack) => {
        try {
            const trimmedConversationId = typeof conversationId === "string" ? conversationId.trim() : "";

            if (!trimmedConversationId || !isValidObjectId(trimmedConversationId)) {
                socket.emit("error", { message: "Invalid conversation ID format", code: "INVALID_CONV_ID" });
                replyAck(ack, { success: false, code: "INVALID_CONV_ID", message: "Invalid conversation ID format" });
                return;
            }

            const access = await ensureConversationAccess(socket, trimmedConversationId, {
                autoJoinIfMissing: true,
                verifyDbOnRoomHit: true,
            });

            if (!access.ok) {
                socket.emit("error", { message: access.message, code: access.code });
                replyAck(ack, { success: false, code: access.code, message: access.message });
                return;
            }

            if (!Array.isArray(messageIds) || messageIds.length === 0) {
                socket.emit("error", { message: "messageIds must be a non-empty array", code: "INVALID_MESSAGE_IDS" });
                replyAck(ack, { success: false, code: "INVALID_MESSAGE_IDS", message: "messageIds must be a non-empty array" });
                return;
            }

            if (messageIds.length > MAX_MARK_READ_MESSAGE_IDS) {
                socket.emit("error", {
                    message: `Too many message IDs. Maximum is ${MAX_MARK_READ_MESSAGE_IDS}.`,
                    code: "TOO_MANY_MESSAGE_IDS",
                });
                replyAck(ack, { success: false, code: "TOO_MANY_MESSAGE_IDS", message: `Too many message IDs. Maximum is ${MAX_MARK_READ_MESSAGE_IDS}.` });
                return;
            }

            const uniqueMessageIds = [...new Set(messageIds.map((messageId) => {
                if (typeof messageId !== "string") return null;
                const trimmedMessageId = messageId.trim();
                return trimmedMessageId && isValidObjectId(trimmedMessageId) ? trimmedMessageId : null;
            }))].filter(Boolean);

            if (!uniqueMessageIds.length) {
                socket.emit("error", { message: "No valid message IDs provided", code: "INVALID_MESSAGE_ID" });
                replyAck(ack, { success: false, code: "INVALID_MESSAGE_ID", message: "No valid message IDs provided" });
                return;
            }

            if (uniqueMessageIds.length !== messageIds.length) {
                socket.emit("error", { message: "One or more message IDs are invalid", code: "INVALID_MESSAGE_ID" });
                replyAck(ack, { success: false, code: "INVALID_MESSAGE_ID", message: "One or more message IDs are invalid" });
                return;
            }

            // Get only message IDs that belong to this conversation for partial-match handling.
            const matchedMessages = await Message.find(
                {
                    _id: { $in: uniqueMessageIds },
                    conversation: trimmedConversationId,
                },
                { _id: 1 }
            ).lean();

            const matchedMessageIds = matchedMessages.map((msg) => msg._id.toString());

            // Update only messages that belong to this conversation and add the reader once
            const updateResult = await Message.updateMany(
                {
                    _id: { $in: matchedMessageIds },
                    conversation: trimmedConversationId,
                },
                {
                    $addToSet: { readBy: socket.userId },
                }
            );

            await Conversation.updateOne(
                {
                    _id: trimmedConversationId,
                    participants: socket.userId,
                },
                {
                    $set: {
                        [`unreadCounters.${socket.userId}`]: 0,
                    },
                }
            );

            io.to(`user:${socket.userId}`).emit("conversation-unread-updated", {
                conversationId: trimmedConversationId,
                unreadCount: 0,
            });

            if (!updateResult.matchedCount) {
                socket.emit("error", {
                    message: "No messages matched this conversation",
                    code: "NO_MESSAGES_MATCHED",
                });
                replyAck(ack, { success: false, code: "NO_MESSAGES_MATCHED", message: "No messages matched this conversation" });
                return;
            }

            // Notify other users in the room only; sender is excluded by socket.to()
            socket.to(trimmedConversationId).emit("messages-read", {
                conversationId: trimmedConversationId,
                userId: socket.userId,
                messageIds: matchedMessageIds,
            });

            replyAck(ack, {
                success: true,
                code: "SUCCESS",
                data: {
                    conversationId: trimmedConversationId,
                    messageIds: matchedMessageIds,
                    matchedCount: updateResult.matchedCount,
                    modifiedCount: updateResult.modifiedCount,
                },
            });

            logger.log(`✅ Messages marked as read in conversation: ${trimmedConversationId}`);
        } catch (error) {
            logger.error("❌ Error marking messages as read:", error.message);
            socket.emit("error", { message: "Failed to mark messages as read", code: "READ_ERROR" });
            replyAck(ack, { success: false, code: "READ_ERROR", message: "Failed to mark messages as read" });
        }
    });

    // --------------------------------------------------
    // USER DISCONNECTS (Handle Multi-Tab)
    // --------------------------------------------------
    socket.on("disconnect", () => {
        try {
            if (!socket.userId) return;

            if (socket.data.joinedConversationIds) {
                socket.data.joinedConversationIds.clear();
            }

            const { removed, isFullyOffline, socketCount } = markSocketOffline(socket);

            if (!removed) {
                return;
            }

            if (isFullyOffline) {
                emitOnlineUsers();
                cleanupUserRateLimitEntries(socket.userId);
                logger.log(`❌ User fully disconnected: ${socket.userId} | Total online: ${getOnlineUserIds().length}`);
            } else if (socketCount > 0) {
                logger.log(`📌 User has ${socketCount} remaining tab(s): ${socket.userId}`);
            }
        } catch (error) {
            logger.error("❌ Error during disconnect:", error.message);
        }
    });

    // --------------------------------------------------
    // ERROR HANDLING
    // --------------------------------------------------
    socket.on("error", (error) => {
        logger.error(`🔴 Socket error for user ${socket.userId}:`, error);
    });
});

// --------------------------------------------------
// EXPORT IO INSTANCE
// --------------------------------------------------

export { io };

// --------------------------------------------------
// CONNECT TO MONGODB & START SERVER
// --------------------------------------------------

const PORT = process.env.PORT || 8000;

httpServer.on("error", (error) => {
    if (error?.code === "EADDRINUSE") {
        logger.error(`❌ Port ${PORT} is already in use. Stop the existing process or change PORT in .env.`);
        process.exit(1);
    }

    logger.error("❌ HTTP server error:", error?.message || error);
});

connectDB()
    .then(() => {
        return User.syncIndexes();
    })
    .then(() => {
        httpServer.listen(PORT, () => {
            logger.log(`
╔════════════════════════════════════════╗
║                                        ║
║   🚀 SERVER STARTED SUCCESSFULLY      ║
║   Port: ${PORT}                        ║
║   Mode: ${process.env.NODE_ENV || "development"}                     ║
╚════════════════════════════════════════╝
            `);
        });
    })
    .catch((error) => {
        logger.error("❌ MongoDB connection failed:", error.message);
        process.exit(1);
    });

// --------------------------------------------------
// GRACEFUL SHUTDOWN
// --------------------------------------------------

process.on("SIGINT", () => {
    logger.log("🛑 SIGINT signal received: closing HTTP server");
    clearInterval(rateLimitCleanupTimer);
    clearInterval(socketAuthCleanupTimer);
    clearInterval(requestExpirySweepTimer);
    httpServer.close(() => {
        logger.log("🛑 HTTP server closed");
        process.exit(0);
    });
});

setSocketServer(io);