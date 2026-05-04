import { create } from "zustand";
import {
    getConversations,
    getOrCreateConversation,
    deleteConversation,
    acceptConversationRequest,
    rejectConversationRequest,
} from "../api/conversation.api.js";

const normalizeId = (value) => String(value?._id || value?.id || value || "");

const mergeConversationById = (conversations, nextConversation) => {
    const nextId = normalizeId(nextConversation?._id);
    if (!nextId) return conversations;

    const hasExisting = conversations.some((conversation) => normalizeId(conversation?._id) === nextId);

    const merged = hasExisting
        ? conversations.map((conversation) =>
            normalizeId(conversation?._id) === nextId
                ? { ...conversation, ...nextConversation }
                : conversation
        )
        : [nextConversation, ...conversations];

    return merged.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
};

const useConversationStore = create((set) => ({
    conversations: [],
    selectedConversation: null,
    isLoading: false,
    error: null,

    fetchConversations: async () => {
        set({ isLoading: true, error: null });
        try {
            const response = await getConversations();
            const fetchedConversations = Array.isArray(response.data) ? response.data : [];

            set((state) => {
                const selectedId = normalizeId(state.selectedConversation?._id);
                const matchingSelected = fetchedConversations.find(
                    (conversation) => normalizeId(conversation?._id) === selectedId
                ) || null;

                return {
                    conversations: fetchedConversations,
                    selectedConversation: matchingSelected,
                    error: null,
                };
            });
        } catch (error) {
            set({ error: error.response?.data?.message || "Failed to fetch conversations" });
        } finally {
            set({ isLoading: false });
        }
    },

    openConversation: async (receiverId) => {
        set({ isLoading: true, error: null });
        try {
            const response = await getOrCreateConversation(receiverId);
            const conversation = response.data;

            set((state) => {
                return {
                    selectedConversation: conversation,
                    conversations: mergeConversationById(state.conversations, conversation),
                    error: null,
                };
            });

            return conversation;
        } catch (error) {
            set({ error: error.response?.data?.message || "Failed to open conversation" });
            throw error;
        } finally {
            set({ isLoading: false });
        }
    },

    selectConversation: (conversation) => {
        set({ selectedConversation: conversation });
    },

    removeConversation: async (conversationId) => {
        try {
            await deleteConversation(conversationId);
            set((state) => ({
                conversations: state.conversations.filter((c) => c._id !== conversationId),
                selectedConversation:
                    state.selectedConversation?._id === conversationId
                        ? null
                        : state.selectedConversation,
            }));
        } catch (error) {
            set({ error: error.response?.data?.message || "Failed to delete conversation" });
        }
    },

    updateLastMessage: (conversationId, message) => {
        const normalizedConversationId = normalizeId(conversationId);

        set((state) => ({
            conversations: state.conversations
                .map((c) =>
                    normalizeId(c._id) === normalizedConversationId
                        ? { ...c, lastMessage: message, updatedAt: new Date().toISOString() }
                        : c
                )
                .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)),
            selectedConversation:
                normalizeId(state.selectedConversation?._id) === normalizedConversationId
                    ? {
                        ...state.selectedConversation,
                        lastMessage: message,
                        updatedAt: new Date().toISOString(),
                    }
                    : state.selectedConversation,
        }));
    },

    incrementUnreadCount: (conversationId) => {
        const normalizedConversationId = normalizeId(conversationId);

        set((state) => ({
            conversations: state.conversations.map((c) =>
                normalizeId(c._id) === normalizedConversationId
                    ? {
                        ...c,
                        unreadCount: Math.max(0, Number(c.unreadCount || 0)) + 1,
                    }
                    : c
            ),
        }));
    },

    resetUnreadCount: (conversationId) => {
        const normalizedConversationId = normalizeId(conversationId);

        set((state) => ({
            conversations: state.conversations.map((c) =>
                normalizeId(c._id) === normalizedConversationId
                    ? { ...c, unreadCount: 0 }
                    : c
            ),
            selectedConversation:
                normalizeId(state.selectedConversation?._id) === normalizedConversationId
                    ? { ...state.selectedConversation, unreadCount: 0 }
                    : state.selectedConversation,
        }));
    },

    setConversationUnreadCount: (conversationId, unreadCount) => {
        const normalizedConversationId = normalizeId(conversationId)
        const parsedUnread = Number(unreadCount)
        const safeUnread = Number.isFinite(parsedUnread) && parsedUnread > 0
            ? Math.floor(parsedUnread)
            : 0

        set((state) => ({
            conversations: state.conversations.map((c) =>
                normalizeId(c._id) === normalizedConversationId
                    ? { ...c, unreadCount: safeUnread }
                    : c
            ),
            selectedConversation:
                normalizeId(state.selectedConversation?._id) === normalizedConversationId
                    ? { ...state.selectedConversation, unreadCount: safeUnread }
                    : state.selectedConversation,
        }))
    },

    clearError: () => set({ error: null }),

    updateConversationRequestState: (conversationId, patch = {}) => {
        const normalizedConversationId = normalizeId(conversationId);
        if (!normalizedConversationId) return;

        set((state) => ({
            conversations: state.conversations.map((conversation) =>
                normalizeId(conversation?._id) === normalizedConversationId
                    ? { ...conversation, ...patch }
                    : conversation
            ),
            selectedConversation:
                normalizeId(state.selectedConversation?._id) === normalizedConversationId
                    ? { ...state.selectedConversation, ...patch }
                    : state.selectedConversation,
        }));
    },

    replaceConversation: (nextConversation) => {
        const normalizedConversationId = normalizeId(nextConversation?._id);
        if (!normalizedConversationId) return;

        set((state) => ({
            conversations: mergeConversationById(state.conversations, nextConversation),
            selectedConversation:
                normalizeId(state.selectedConversation?._id) === normalizedConversationId
                    ? { ...state.selectedConversation, ...nextConversation }
                    : state.selectedConversation,
        }));
    },

    acceptRequest: async (conversationId) => {
        try {
            const response = await acceptConversationRequest(conversationId);
            const updatedConversation = response?.data;

            if (updatedConversation?._id) {
                set((state) => ({
                    conversations: mergeConversationById(state.conversations, updatedConversation),
                    selectedConversation:
                        normalizeId(state.selectedConversation?._id) === normalizeId(updatedConversation._id)
                            ? { ...state.selectedConversation, ...updatedConversation }
                            : state.selectedConversation,
                    error: null,
                }));
            }

            return updatedConversation;
        } catch (error) {
            set({ error: error.response?.data?.message || "Failed to accept request" });
            throw error;
        }
    },

    rejectRequest: async (conversationId) => {
        try {
            const response = await rejectConversationRequest(conversationId);
            const updatedConversation = response?.data;

            if (updatedConversation?._id) {
                set((state) => ({
                    conversations: mergeConversationById(state.conversations, updatedConversation),
                    selectedConversation:
                        normalizeId(state.selectedConversation?._id) === normalizeId(updatedConversation._id)
                            ? { ...state.selectedConversation, ...updatedConversation }
                            : state.selectedConversation,
                    error: null,
                }));
            }

            return updatedConversation;
        } catch (error) {
            set({ error: error.response?.data?.message || "Failed to reject request" });
            throw error;
        }
    },
}));

export default useConversationStore;