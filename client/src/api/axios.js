import axios from "axios";
import { disconnectSocket, updateSocketToken } from "../socket/socket.js";
import { logger } from "../utils/logger.js";
import { clearAccessToken, getAccessToken, setAccessToken } from "../store/authToken.js";

const getBaseUrl = () => {
    const url = import.meta.env.VITE_API_URL;
    if (!url) {
        logger.error("VITE_API_URL is not set");
        return "";
    }
    return url;
};

const axiosInstance = axios.create({
    baseURL: getBaseUrl(),
    withCredentials: true,
    headers: {
        "Content-Type": "application/json",
    },
});

let refreshPromise = null;

const refreshAccessToken = async () => {
    try {
        const apiBase = import.meta.env.VITE_API_URL;
        const refreshUrl = `${apiBase}/user/refresh-token`;

        const response = await axios.post(
            refreshUrl,
            {},
            { withCredentials: true }
        );

        const { accessToken } = response.data?.data || {};

        if (!accessToken) {
            logger.error("Access token missing in refresh response");
            throw new Error("Access token missing in refresh response");
        }

        setAccessToken(accessToken);
        updateSocketToken(accessToken);

        logger.log("Access token refreshed successfully");
        return accessToken;

    } catch (error) {
        logger.error("Token refresh failed:", error.response?.data?.message || error.message);
        throw error;
    }
};

axiosInstance.interceptors.request.use(
    (config) => {
        config.withCredentials = true;

        const token = getAccessToken();
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }

        return config;
    },
    (error) => Promise.reject(error)
);

axiosInstance.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;
        const requestUrl = originalRequest?.url || "";
        const isRefreshRequest = requestUrl.includes("/user/refresh-token");
        const isAuthRequest =
            requestUrl.includes("/user/login") ||
            requestUrl.includes("/user/register") ||
            requestUrl.includes("/user/logout") ||
            isRefreshRequest;

        if (error.response?.status === 401 && !originalRequest?._retry && !isAuthRequest) {
            originalRequest._retry = true;
                // Only attempt a refresh if we have an access token stored or a session hint
                const localAccessToken = getAccessToken();
                const hasSessionHint = typeof localStorage !== 'undefined' && Boolean(localStorage.getItem('sessionHint'));

                if (!localAccessToken && !hasSessionHint) {
                    // No indication of a session; do not attempt refresh to avoid 401 noise.
                    return Promise.reject(error);
                }

                try {
                    logger.log("Attempting to refresh access token...");

                    if (!refreshPromise) {
                        refreshPromise = refreshAccessToken().finally(() => {
                            refreshPromise = null;
                        });
                    }

                    const accessToken = await refreshPromise;
                originalRequest.headers.Authorization = `Bearer ${accessToken}`;

                logger.log("Retrying original request with new access token");
                return axiosInstance(originalRequest);

            } catch (refreshError) {
                logger.error("Token refresh failed, redirecting to login");

                localStorage.removeItem("refreshToken");
                localStorage.removeItem("user");
                clearAccessToken();
                disconnectSocket();

                window.location.href = "/login";
            }
        }

        return Promise.reject(error);
    }
);

export default axiosInstance;