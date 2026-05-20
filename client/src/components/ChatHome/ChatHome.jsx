import React, { useEffect, useState } from "react";
import LeftSidebar from "../LeftSidebar/LeftSidebar";
import ChatContainer from "../ChatContainer/ChatContainer";
import RightSidebar from "../RightSidebar/RightSidebar";
import useConversationStore from "../../store/conversation.store.js";
import { getSocket } from "../../socket/socket.js";

const ChatHome = () => {
    const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);
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

    useEffect(() => {
        if (!selectedConversation) {
            setIsRightSidebarOpen(false);
        }
    }, [selectedConversation]);

    const homeGridClassName = "grid h-dvh grid-cols-1 bg-slate-100 md:grid-cols-[minmax(271px,331px)_minmax(0,1fr)] overflow-hidden";

    return (
        <div className={homeGridClassName}>
            <main className="order-1 min-w-0 overflow-hidden md:order-2">
                <div className="relative h-full min-w-0 overflow-hidden">
                    <ChatContainer
                        isRightSidebarOpen={isRightSidebarOpen}
                        onToggleRightSidebar={() => setIsRightSidebarOpen((current) => !current)}
                    />

                    {selectedConversation && (
                        <div className={`pointer-events-none absolute inset-0 z-30 bg-slate-950/35 transition-opacity duration-300 ${isRightSidebarOpen ? 'opacity-100' : 'opacity-0'}`} />
                    )}

                    {selectedConversation && (
                        <aside
                            className={`pointer-events-auto absolute right-0 top-0 z-40 h-full w-full max-w-[360px] overflow-hidden border-l border-slate-200 bg-white shadow-2xl transition-transform duration-300 ease-out ${isRightSidebarOpen ? 'translate-x-0' : 'translate-x-full'}`}
                        >
                            <RightSidebar
                                selectedConversation={selectedConversation}
                                onClose={() => setIsRightSidebarOpen(false)}
                            />
                        </aside>
                    )}
                </div>
            </main>

            <aside className="order-2 min-w-0 overflow-hidden md:order-1 md:border-r md:border-slate-200">
                <LeftSidebar
                    onUserSelect={selectConversation}
                    selectedUser={selectedConversation}
                    onToggleRightSidebar={() => setIsRightSidebarOpen((current) => !current)}
                />
            </aside>

        </div>
    );
};

export default ChatHome;