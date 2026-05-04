import { create } from "zustand";
import { connectSocket, disconnectSocket } from "../socket/socket.js";
import { getCurrentUser, loginUser, logoutUser, refreshSession, registerUser } from "../api/auth.api.js";
import { logger } from "../utils/logger.js";

export const AUTH_SYNC_KEY = "chatapp:auth-sync";
const AUTH_SYNC_CHANNEL = "chatapp-auth-sync";

const authChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(AUTH_SYNC_CHANNEL) : null;
const BOOTSTRAP_RETRY_DELAY_MS = 350;
const BOOTSTRAP_MAX_RETRIES = 3;

// Prevent concurrent refresh-token requests (rate limit guard)
let bootstrapPromise = null;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isUnauthenticatedRefreshError = (error) => {
    const status = error?.response?.status;
    return status === 401 || status === 403;
};

const hasStoredRefreshToken = () => Boolean(localStorage.getItem("refreshToken"));

const preloadProfilePicture = (profilePicture) => {
    if (!profilePicture || typeof profilePicture !== "string") return;

    try {
        const image = new Image();
        image.decoding = "async";
        image.src = profilePicture;
    } catch {
        // Ignore preload failures; the UI can still load the image normally.
    }
};

const clearAuthSession = () => {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("user");
    disconnectSocket();
};

const broadcastAuthEvent = (type) => {
    const payload = JSON.stringify({ type, timestamp: Date.now() });

    if (authChannel) {
        authChannel.postMessage(payload);
    }

    localStorage.setItem(AUTH_SYNC_KEY, payload);
};

const getApiErrorMessage = (error, fallbackMessage) => {
    const status = Number(error?.response?.status);
    const responseData = error?.response?.data;

    if (status === 401) {
        return "Invalid credentials";
    }

    if (status === 429) {
        return responseData?.message || "Please wait before trying again";
    }

    if (typeof responseData?.message === "string" && responseData.message.trim()) {
        return responseData.message;
    }

    if (Array.isArray(responseData?.errors) && responseData.errors.length > 0) {
        return String(responseData.errors[0]);
    }

    if (typeof error?.message === "string" && error.message.trim()) {
        return error.message;
    }

    return fallbackMessage;
};

const useAuthStore = create((set) => ({
    user: JSON.parse(localStorage.getItem("user")) || null,
    accessToken: localStorage.getItem("accessToken") || null,
    isLoading: false,
    isBootstrapping: false,
    hasBootstrapped: false,
    error: null,

    register: async (data) => {
        set({ isLoading: true, error: null });
        try {
            const response = await registerUser(data);
            return response;
        } catch (error) {
            const message = getApiErrorMessage(error, "Registration failed");
            set({ error: message });
            throw error;
        } finally {
            set({ isLoading: false });
        }
    },

    login: async (data) => {
        set({ isLoading: true, error: null });
        try {
            const response = await loginUser(data);

            if (response?.success === false || response?.status === "error") {
                const message = response?.message || "Login failed";
                set({ error: message });
                throw new Error(message);
            }

            const { user, accessToken, refreshToken } = response.data;

            localStorage.setItem("accessToken", accessToken);
            localStorage.setItem("refreshToken", refreshToken);
            localStorage.setItem("user", JSON.stringify(user));

            preloadProfilePicture(user?.profilePicture);

            connectSocket(accessToken);

            set({ user, accessToken, isBootstrapping: false, hasBootstrapped: true, error: null });
            return response;
        } catch (error) {
            const message = getApiErrorMessage(error, "Login failed");
            set({ error: message });
            throw error;
        } finally {
            set({ isLoading: false });
        }
    },

    logout: async () => {
        set({ isLoading: true });
        try {
            await logoutUser();
        } catch {
            // Continue logout even if API fails
        } finally {
            clearAuthSession();
            broadcastAuthEvent("logout");
            set({ user: null, accessToken: null, isLoading: false, error: null });
        }
    },

    syncLogout: () => {
        clearAuthSession();
        set({ user: null, accessToken: null, isLoading: false, isBootstrapping: false, hasBootstrapped: true, error: null });
    },

    bootstrapAuth: async (force = false) => {
        const { hasBootstrapped, accessToken, user } = useAuthStore.getState();

        if (hasBootstrapped && !force) {
            return Boolean(accessToken && user);
        }

        if (bootstrapPromise) {
            return bootstrapPromise;
        }

        set({ isBootstrapping: true, error: null });

        bootstrapPromise = (async () => {
        try {
            if (accessToken) {
                let currentUser = user;

                if (!currentUser) {
                    try {
                        const userResponse = await getCurrentUser();
                        currentUser = userResponse.data;
                        localStorage.setItem("user", JSON.stringify(currentUser));
                        preloadProfilePicture(currentUser?.profilePicture);
                    } catch (error) {
                        if (!isUnauthenticatedRefreshError(error)) {
                            logger.warn('Initial current-user fetch failed, trying to refresh session once:', error);
                        }

                        if (isUnauthenticatedRefreshError(error)) {
                            clearAuthSession();
                            set({ user: null, accessToken: null, isBootstrapping: false, hasBootstrapped: true, error: null });
                            return false;
                        }

                        const sessionResponse = await refreshSession();
                        const { accessToken: refreshedAccessToken, refreshToken: refreshedRefreshToken } = sessionResponse.data || {};

                        if (!refreshedAccessToken) {
                            throw new Error("Access token missing from session refresh");
                        }

                        localStorage.setItem("accessToken", refreshedAccessToken);
                        if (refreshedRefreshToken) {
                            localStorage.setItem("refreshToken", refreshedRefreshToken);
                        }

                        const retryUserResponse = await getCurrentUser();
                        currentUser = retryUserResponse.data;
                        localStorage.setItem("user", JSON.stringify(currentUser));
                        preloadProfilePicture(currentUser?.profilePicture);

                        set({
                            user: currentUser,
                            accessToken: refreshedAccessToken,
                            isBootstrapping: false,
                            hasBootstrapped: true,
                            error: null,
                        });

                        connectSocket(refreshedAccessToken);
                        return true;
                    }
                }

                // Finalize auth state FIRST (don't wait for socket)
                set({ user: currentUser, accessToken, isBootstrapping: false, hasBootstrapped: true, error: null });
                
                // Connect socket in background (non-blocking)
                connectSocket(accessToken);
                return true;
            }

            // No access token - only try session refresh when we still have a stored refresh token.
            // After logout we clear local auth state, so reloading as an anonymous user should not hit refresh-token.
            if (!force && !hasStoredRefreshToken()) {
                clearAuthSession();
                set({ user: null, accessToken: null, isBootstrapping: false, hasBootstrapped: true, error: null });
                return false;
            }

            // Try to refresh from cookies with a few retries.
            let lastError = null;

            for (let attempt = 0; attempt < BOOTSTRAP_MAX_RETRIES; attempt += 1) {
                try {
                    const sessionResponse = await refreshSession();
                    const { accessToken: freshAccessToken, refreshToken: freshRefreshToken } = sessionResponse.data || {};

                    if (!freshAccessToken) {
                        throw new Error("Access token missing from session refresh");
                    }

                    const userResponse = await getCurrentUser();
                    const currentUser = userResponse.data;

                    localStorage.setItem("accessToken", freshAccessToken);
                    if (freshRefreshToken) {
                        localStorage.setItem("refreshToken", freshRefreshToken);
                    }
                    localStorage.setItem("user", JSON.stringify(currentUser));
                    preloadProfilePicture(currentUser?.profilePicture);

                    // Finalize auth state FIRST (don't wait for socket)
                    set({
                        user: currentUser,
                        accessToken: freshAccessToken,
                        isBootstrapping: false,
                        hasBootstrapped: true,
                        error: null,
                    });

                    // Connect socket in background (non-blocking)
                    connectSocket(freshAccessToken);
                    return true;
                } catch (error) {
                    lastError = error;

                    // Stop retrying immediately on rate-limit errors (429)
                    if (error?.response?.status === 429) {
                        break;
                    }

                    if (attempt < BOOTSTRAP_MAX_RETRIES - 1) {
                        await wait(BOOTSTRAP_RETRY_DELAY_MS * (attempt + 1));
                    }
                }
            }

            if (lastError && isUnauthenticatedRefreshError(lastError)) {
                clearAuthSession();
                set({ user: null, accessToken: null, isBootstrapping: false, hasBootstrapped: true, error: null });
                return false;
            }

            throw lastError || new Error("Unable to restore session");
        } catch (error) {
            if (!isUnauthenticatedRefreshError(error)) {
                logger.error('❌ Auth bootstrap error:', error);
            }
            clearAuthSession();
            set({ user: null, accessToken: null, isBootstrapping: false, hasBootstrapped: true, error: null });
            return false;
        }
        })();

        try {
            return await bootstrapPromise;
        } finally {
            bootstrapPromise = null;
        }
    },

    updateUser: (updatedUser) => {
        localStorage.setItem("user", JSON.stringify(updatedUser));
        preloadProfilePicture(updatedUser?.profilePicture);
        set({ user: updatedUser });
    },

    clearError: () => set({ error: null }),
}));

export default useAuthStore;
