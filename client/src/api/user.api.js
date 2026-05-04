import axiosInstance from "./axios.js";

export const discoverUsers = async ({ query = "", limit = 50 } = {}) => {
    const params = new URLSearchParams();

    if (query.trim()) {
        params.set("q", query.trim());
    }

    params.set("limit", String(limit));

    const response = await axiosInstance.get(`/user/discover?${params.toString()}`);
    return response.data;
};

export const getNotificationPreferences = async () => {
    const response = await axiosInstance.get('/user/notification-preferences');
    return response.data;
};

export const updateNotificationPreferences = async (payload) => {
    const response = await axiosInstance.patch('/user/notification-preferences', payload);
    return response.data;
};
