import { create } from "zustand";
import {
    getMessages,
    sendTextMessage,
    sendMediaMessage,
    editMessageApi,
    deleteMessageApi,
    markMessagesAsRead,
} from "../api/message.api.js";
import { logger } from "../utils/logger.js";

const useMessageStore = create((set) => ({
    messages: [],
    currentConversationId: null,
    isLoading: false,
    isSending: false,
    error: null,

    fetchMessages: async (conversationId) => {
        set({ isLoading: true, error: null, messages: [], currentConversationId: conversationId });
        try {
            const response = await getMessages(conversationId);
            set({ messages: response.data, error: null, currentConversationId: conversationId });
            return response.data;
        } catch (error) {
            set({ error: error.response?.data?.message || "Failed to fetch messages" });
            throw error;
        } finally {
            set({ isLoading: false });
        }
    },

    sendText: async (conversationId, content) => {
        set({ isSending: true, error: null });
        try {
            const response = await sendTextMessage(conversationId, content);
            set((state) => ({
                messages: state.messages.some((m) => m._id === response.data?._id)
                    ? state.messages
                    : [...state.messages, response.data],
                currentConversationId: conversationId,
                error: null,
            }));
            return response.data;
        } catch (error) {
            set({ error: error.response?.data?.message || "Failed to send message" });
            throw error;
        } finally {
            set({ isSending: false });
        }
    },

    sendMedia: async (conversationId, content, file) => {
        set({ isSending: true, error: null });
        try {
            const response = await sendMediaMessage(conversationId, content, file);
            set((state) => ({
                messages: state.messages.some((m) => m._id === response.data?._id)
                    ? state.messages
                    : [...state.messages, response.data],
                currentConversationId: conversationId,
                error: null,
            }));
            return response.data;
        } catch (error) {
            set({ error: error.response?.data?.message || "Failed to send media" });
            throw error;
        } finally {
            set({ isSending: false });
        }
    },

    addIncomingMessage: (message) => {
        set((state) => {
            const exists = state.messages.find((m) => m._id === message._id);
            if (exists) return state;

            // Validate that the incoming message belongs to the current conversation
            const normalizeId = (value) => String(value?._id || value?.id || value || '');
            const messageConversationId = normalizeId(message?.conversation?._id || message?.conversation);
            const currentConversationId = normalizeId(state.currentConversationId);

            // Only add message if it belongs to the current conversation or if we don't have a current conversation ID
            if (currentConversationId && messageConversationId && messageConversationId !== currentConversationId) {
                return state;
            }

            return { messages: [...state.messages, message] };
        });
    },

    editMsg: async (messageId, content) => {
        try {
            const response = await editMessageApi(messageId, content);
            set((state) => ({
                messages: state.messages.map((m) =>
                    m._id === messageId ? response.data : m
                ),
            }));
            return response.data;
        } catch (error) {
            set({ error: error.response?.data?.message || "Failed to edit message" });
            throw error;
        }
    },

    updateIncomingEdit: (updatedMessage) => {
        set((state) => ({
            messages: state.messages.map((m) =>
                m._id === updatedMessage._id ? updatedMessage : m
            ),
        }));
    },

    deleteMsg: async (messageId) => {
        try {
            await deleteMessageApi(messageId);
            set((state) => ({
                messages: state.messages.filter((m) => m._id !== messageId),
            }));
        } catch (error) {
            set({ error: error.response?.data?.message || "Failed to delete message" });
            throw error;
        }
    },

    removeIncomingDelete: (messageId) => {
        set((state) => ({
            messages: state.messages.filter((m) => m._id !== messageId),
        }));
    },

    markRead: async (conversationId) => {
        try {
            await markMessagesAsRead(conversationId);
        } catch (error) {
            logger.error("Failed to mark as read:", error);
        }
    },

    applyDeliveryReceipt: (conversationId, userId, messageIds = []) => {
        const messageIdSet = new Set((Array.isArray(messageIds) ? messageIds : []).map((id) => String(id)));

        set((state) => ({
            messages: state.messages.map((message) => {
                const messageConversationId = message.conversation?._id || message.conversation;
                if (String(messageConversationId) !== String(conversationId)) {
                    return message;
                }

                if (messageIdSet.size > 0 && !messageIdSet.has(String(message._id))) {
                    return message;
                }

                const existingDeliveredTo = Array.isArray(message.deliveredTo)
                    ? message.deliveredTo
                    : [];

                const existingDeliveredToIds = existingDeliveredTo.map((id) => String(id?._id || id));

                if (existingDeliveredToIds.includes(String(userId))) {
                    return message;
                }

                return {
                    ...message,
                    deliveredTo: [...existingDeliveredTo, String(userId)],
                };
            }),
        }));
    },

    applyReadReceipt: (conversationId, userId, messageIds = []) => {
        const messageIdSet = new Set((Array.isArray(messageIds) ? messageIds : []).map((id) => String(id)));

        set((state) => ({
            messages: state.messages.map((message) => {
                const messageConversationId = message.conversation?._id || message.conversation;
                if (String(messageConversationId) !== String(conversationId)) {
                    return message;
                }

                if (messageIdSet.size > 0 && !messageIdSet.has(String(message._id))) {
                    return message;
                }

                const existingReadBy = Array.isArray(message.readBy)
                    ? message.readBy
                    : [];

                const existingReadByIds = existingReadBy.map((reader) => String(reader?._id || reader));

                if (existingReadByIds.includes(String(userId))) {
                    return message;
                }

                return {
                    ...message,
                    readBy: [...existingReadBy, String(userId)],
                };
            }),
        }));
    },

    clearMessages: () => set({ messages: [], currentConversationId: null, error: null }),
    clearError: () => set({ error: null }),
}));

export default useMessageStore;
