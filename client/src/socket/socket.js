import { io } from "socket.io-client";
import { logger } from "../utils/logger.js";

let socket = null;

/**
 * Resolve Socket URL safely
 */
const getSocketUrl = () => {
    // 1. Explicit socket URL (highest priority)
    if (import.meta.env.VITE_SOCKET_URL) {
        return import.meta.env.VITE_SOCKET_URL;
    }

    // 2. Derive from API URL
    const apiUrl = import.meta.env.VITE_API_URL;
    if (apiUrl) {
        return apiUrl.replace(/\/api\/v1\/?$/, "");
    }

    // 3. Browser fallback (only if available)
    if (typeof window !== "undefined" && window.location?.origin) {
        return window.location.origin;
    }

    // 4. Fail explicitly
    return null;
};

/**
 * Register user as online (presence system)
 */
const registerSocketPresence = () => {
    if (!socket) return;

    socket.emit("user-online", null, (response) => {
        if (response?.success === false) {
            logger.error(
                "Socket presence failed:",
                response?.message || "Unknown error"
            );
        }
    });
};

/**
 * Connect socket with auth token
 */
export const connectSocket = (token) => {
    if (!token) {
        logger.warn("Socket: No token provided");
        return null;
    }

    // Already connected
    if (socket?.connected) {
        logger.log("Socket: Already connected");
        return socket;
    }

    // Reuse existing instance
    if (socket && !socket.connected) {
        logger.log("Socket: Reconnecting...");
        socket.auth = { token };
        socket.connect();
        return socket;
    }

    const socketUrl = getSocketUrl();

    if (!socketUrl) {
        logger.error("Socket URL not configured");
        return null;
    }

    logger.log("Socket: Connecting to", socketUrl);

    socket = io(socketUrl, {
        auth: { token },
        transports: ["websocket", "polling"],
        withCredentials: true,

        // Reconnection strategy
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
    });

    // ================= EVENTS =================

    socket.on("connect", () => {
        logger.log("Socket connected:", socket.id);
        registerSocketPresence();
    });

    socket.on("connect_error", (error) => {
        logger.error("Socket connect error:", error.message);
    });

    socket.on("disconnect", (reason) => {
        logger.warn("Socket disconnected:", reason);

        // Optional: handle forced logout cases
        if (reason === "io server disconnect") {
            logger.warn("Socket: Server forced disconnect");
        }
    });

    socket.on("reconnect_attempt", (attempt) => {
        logger.log("Socket reconnect attempt:", attempt);
    });

    socket.on("reconnect_failed", () => {
        logger.error("Socket: Reconnect failed");
    });

    socket.on("socket-error", (error) => {
        logger.error(
            "Socket server error:",
            error?.message,
            error?.code
        );
    });

    return socket;
};

/**
 * Disconnect socket safely
 */
export const disconnectSocket = () => {
    if (!socket) return;

    logger.log("Socket: Disconnecting...");

    socket.removeAllListeners();
    socket.io.opts.reconnection = false;
    socket.disconnect();

    socket = null;
};

/**
 * Update auth token (used after refresh token)
 */
export const updateSocketToken = (token) => {
    if (!socket || !token) return;

    logger.log("Socket: Updating token...");

    socket.auth = { token };

    // If already connected → no need to reconnect immediately
    if (socket.connected) {
        return;
    }

    // Ensure reconnection is enabled
    socket.io.opts.reconnection = true;
    socket.connect();
};

/**
 * Get current socket instance
 */
export const getSocket = () => socket;