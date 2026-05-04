import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Home from "./components/Home/Home";
import ChatHome from "./components/ChatHome/ChatHome";
import Profile from "./components/Profile/Profile";
import Login from "./components/Login/Login";
import SignUp from "./components/SignUp/SignUp";
import VerifyEmail from "./components/VerifyEmail/VerifyEmail";
import ForgotPassword from "./components/ForgotPassword/ForgotPassword";
import ResetPassword from "./components/ResetPassword/ResetPassword";
import OAuthCallback from "./components/OAuthCallback/OAuthCallback.jsx";
import AuthLoadingScreen from "./components/common/AuthLoadingScreen.jsx";
import MobileBlock from "./components/MobileBlock/MobileBlock.jsx";
import ProtectedRoute from "./routes/ProtectedRoute.jsx";
import useAuthStore from "./store/auth.store.js";
import { AUTH_SYNC_KEY } from "./store/auth.store.js";
import { connectSocket, getSocket } from "./socket/socket.js";
import useNotificationStore from "./store/notification.store.js";
import "./index.css";
import { logger } from "./utils/logger.js";

const AuthSyncListener = () => {
    const navigate = useNavigate();

    useEffect(() => {
        const handleLogout = () => {
            const { syncLogout } = useAuthStore.getState();
            syncLogout();
            navigate("/login", { replace: true });
        };

        const handleStorageEvent = (event) => {
            if (event.key !== AUTH_SYNC_KEY || !event.newValue) return;

            try {
                const payload = JSON.parse(event.newValue);

                if (payload?.type === "logout") {
                    handleLogout();
                }
            } catch {
                // Ignore malformed sync payloads
            }
        };

        const authChannel = typeof BroadcastChannel !== "undefined"
            ? new BroadcastChannel("chatapp-auth-sync")
            : null;

        const handleChannelMessage = (event) => {
            try {
                const payload = typeof event.data === "string" ? JSON.parse(event.data) : event.data;

                if (payload?.type === "logout") {
                    handleLogout();
                }
            } catch {
                // Ignore malformed sync payloads
            }
        };

        window.addEventListener("storage", handleStorageEvent);
        authChannel?.addEventListener("message", handleChannelMessage);

        return () => {
            window.removeEventListener("storage", handleStorageEvent);
            authChannel?.removeEventListener("message", handleChannelMessage);
            authChannel?.close();
        };
    }, [navigate]);

    return null;
};

const isMobileViewport = () => {
    if (typeof window === "undefined") {
        return false;
    }

    const isNarrowScreen = window.innerWidth < 768;
    const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent || ""
    );

    return isNarrowScreen || mobileUserAgent;
};

const MainApp = () => {
    const { user, accessToken, isBootstrapping, hasBootstrapped } = useAuthStore();
    const bootstrapAuth = useAuthStore((state) => state.bootstrapAuth);
    const userId = user?._id;
    const fetchPreferences = useNotificationStore((state) => state.fetchPreferences);
    const applyServerPreferences = useNotificationStore((state) => state.applyServerPreferences);
    const isAuthHydrating = isBootstrapping || !hasBootstrapped;
    const authLoadingScreen = (
        <AuthLoadingScreen
            title="Restoring your session"
            subtitle="We’re checking your sign-in and loading your chats."
            detail="If you just signed in with Google, this usually takes a second or two."
        />
    );

    // Bootstrap auth on mount
    useEffect(() => {
        bootstrapAuth();
    }, [bootstrapAuth]);

    // Connect socket after auth is ready (non-blocking)
    useEffect(() => {
        if (accessToken) {
            // Give socket a little time to connect, but don't block on it
            const timer = setTimeout(() => {
                connectSocket(accessToken);
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [accessToken]);

    // Fetch notification preferences after user is available
    useEffect(() => {
        if (!userId || !accessToken) return;

        fetchPreferences().catch((error) => {
            logger.warn('Failed to fetch notification preferences:', error);
            // Keep local hydrated preferences if API fetch fails.
        });
    }, [accessToken, fetchPreferences, userId]);

    // Listen for preference updates from socket
    useEffect(() => {
        const socket = getSocket();
        if (!socket) return;

        const handlePreferenceSync = (preferences) => {
            applyServerPreferences(preferences);
        };

        socket.on("notification-preferences-updated", handlePreferenceSync);

        return () => {
            socket.off("notification-preferences-updated", handlePreferenceSync);
        };
    }, [applyServerPreferences, accessToken]);

    return (
        <BrowserRouter>
            <AuthSyncListener />
            <Routes>
                <Route path="/" element={<Home />} />
                <Route
                    path="/chat"
                    element={
                        <ProtectedRoute>
                            <ChatHome />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/profile"
                    element={
                        <ProtectedRoute>
                            <Profile />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/login"
                    element={isAuthHydrating ? authLoadingScreen : user ? <Navigate to="/chat" replace /> : <Login />}
                />
                <Route
                    path="/signup"
                    element={isAuthHydrating ? authLoadingScreen : user ? <Navigate to="/chat" replace /> : <SignUp />}
                />
                <Route
                    path="/verify-otp"
                    element={isAuthHydrating ? authLoadingScreen : user ? <Navigate to="/chat" replace /> : <VerifyEmail />}
                />
                <Route
                    path="/verify-email-change"
                    element={<VerifyEmail />}
                />
                <Route
                    path="/forgot-password"
                    element={isAuthHydrating ? authLoadingScreen : user ? <Navigate to="/chat" replace /> : <ForgotPassword />}
                />
                <Route
                    path="/reset-password"
                    element={isAuthHydrating ? authLoadingScreen : user ? <Navigate to="/chat" replace /> : <ResetPassword />}
                />
                <Route path="/oauth/callback" element={<OAuthCallback />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    );
};

const App = () => {
    const [isMobile, setIsMobile] = useState(() => isMobileViewport());

    useEffect(() => {
        const updateViewportState = () => {
            setIsMobile(isMobileViewport());
        };

        updateViewportState();

        window.addEventListener("resize", updateViewportState);
        window.addEventListener("orientationchange", updateViewportState);

        return () => {
            window.removeEventListener("resize", updateViewportState);
            window.removeEventListener("orientationchange", updateViewportState);
        };
    }, []);

    return isMobile ? <MobileBlock /> : <MainApp />;
};

export default App;