import React, { useEffect } from "react";
import LeftSidebar from "../LeftSidebar/LeftSidebar";
import ChatContainer from "../ChatContainer/ChatContainer";
import RightSidebar from "../RightSidebar/RightSidebar";
import useConversationStore from "../../store/conversation.store.js";
import { getSocket } from "../../socket/socket.js";

const ChatHome = () => {
    const {
        selectedConversation,
        selectConversation,
        setConversationUnreadCount,
        updateConversationRequestState,
    } = useConversationStore();

    useEffect(() => {
        const socket = getSocket();
        if (!socket) return;

        const handleUnreadUpdate = ({ conversationId, unreadCount }) => {
            if (!conversationId) return;
            setConversationUnreadCount(conversationId, unreadCount);
        };

        const handlePendingRequest = ({ conversationId, pendingMessageCount, initiator, expiresAt }) => {
            if (!conversationId) return;

            updateConversationRequestState(conversationId, {
                status: "pending",
                pendingMessageCount: Number(pendingMessageCount || 0),
                initiator,
                expiresAt: expiresAt || null,
            });
        };

        const handleRequestAccepted = ({ conversationId }) => {
            if (!conversationId) return;

            updateConversationRequestState(conversationId, {
                status: "accepted",
                expiresAt: null,
            });
        };

        const handleRequestRejected = ({ conversationId }) => {
            if (!conversationId) return;

            updateConversationRequestState(conversationId, {
                status: "rejected",
                expiresAt: null,
            });
        };

        const handleRequestExpired = ({ conversationId }) => {
            if (!conversationId) return;

            updateConversationRequestState(conversationId, {
                status: "expired",
            });
        };

        socket.on("conversation-unread-updated", handleUnreadUpdate);
        socket.on("new_message_request", handlePendingRequest);
        socket.on("request_accepted", handleRequestAccepted);
        socket.on("request_rejected", handleRequestRejected);
        socket.on("request_expired", handleRequestExpired);

        return () => {
            socket.off("conversation-unread-updated", handleUnreadUpdate);
            socket.off("new_message_request", handlePendingRequest);
            socket.off("request_accepted", handleRequestAccepted);
            socket.off("request_rejected", handleRequestRejected);
            socket.off("request_expired", handleRequestExpired);
        };
    }, [setConversationUnreadCount, updateConversationRequestState]);

    const homeGridClassName = selectedConversation
        ? "grid h-dvh grid-cols-1 bg-slate-100 md:grid-cols-[minmax(260px,320px)_minmax(0,1fr)] xl:grid-cols-[minmax(280px,320px)_minmax(0,1fr)_minmax(280px,360px)] overflow-hidden"
        : "grid h-dvh grid-cols-1 bg-slate-100 md:grid-cols-[minmax(260px,320px)_minmax(0,1fr)] xl:grid-cols-[minmax(280px,320px)_minmax(0,1fr)] overflow-hidden";

    return (
        <div className={homeGridClassName}>
            <main className="order-1 min-w-0 overflow-hidden md:order-2">
                <ChatContainer />
            </main>

            <aside className="order-2 min-w-0 overflow-hidden md:order-1 md:border-r md:border-slate-200">
                <LeftSidebar
                    onUserSelect={selectConversation}
                    selectedUser={selectedConversation}
                />
            </aside>

            {selectedConversation && (
                <aside className="hidden min-w-0 overflow-hidden xl:order-3 xl:flex xl:border-l xl:border-slate-200">
                    <RightSidebar selectedConversation={selectedConversation} />
                </aside>
            )}
        </div>
    );
};

export default ChatHome;