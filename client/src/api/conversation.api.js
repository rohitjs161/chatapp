import axiosInstance from "./axios.js";

export const getConversations = async () => {
    const response = await axiosInstance.get("/conversations");
    return response.data;
};

export const getOrCreateConversation = async (receiverId) => {
    const response = await axiosInstance.get(`/conversations/${receiverId}`);
    return response.data;
};

export const deleteConversation = async (conversationId) => {
    const response = await axiosInstance.delete(`/conversations/${conversationId}`);
    return response.data;
};

export const acceptConversationRequest = async (conversationId) => {
    const response = await axiosInstance.patch(`/conversations/${conversationId}/accept`);
    return response.data;
};

export const rejectConversationRequest = async (conversationId) => {
    const response = await axiosInstance.patch(`/conversations/${conversationId}/reject`);
    return response.data;
};