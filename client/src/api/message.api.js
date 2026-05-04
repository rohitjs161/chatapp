import axiosInstance from "./axios.js";

export const getMessages = async (conversationId) => {
    const response = await axiosInstance.get(`/messages/${conversationId}`);
    return response.data;
};

export const sendTextMessage = async (conversationId, content) => {
    const response = await axiosInstance.post(`/messages/${conversationId}`, { content });
    return response.data;
};

export const sendMediaMessage = async (conversationId, content, file) => {
    const formData = new FormData();
    if (content) formData.append("content", content);
    formData.append("media", file);

    const response = await axiosInstance.post(
        `/messages/${conversationId}`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
    );
    return response.data;
};

export const editMessageApi = async (messageId, content) => {
    const response = await axiosInstance.patch(`/messages/${messageId}`, { content });
    return response.data;
};

export const deleteMessageApi = async (messageId) => {
    const response = await axiosInstance.delete(`/messages/${messageId}`);
    return response.data;
};

export const markMessagesAsRead = async (conversationId) => {
    const response = await axiosInstance.patch(`/messages/${conversationId}/read`);
    return response.data;
};