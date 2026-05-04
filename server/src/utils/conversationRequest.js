const REQUEST_EXPIRY_MS = 24 * 60 * 60 * 1000;

export const getRequestExpiryDate = (from = Date.now()) => new Date(Number(from) + REQUEST_EXPIRY_MS);

export const isConversationExpired = (conversation, now = Date.now()) => {
    if (!conversation || conversation.status !== "pending" || !conversation.expiresAt) {
        return false;
    }

    return new Date(conversation.expiresAt).getTime() < Number(now);
};

export const expireConversationIfNeeded = async (conversation, now = Date.now()) => {
    if (!isConversationExpired(conversation, now)) {
        return { conversation, expired: false };
    }

    conversation.status = "expired";
    await conversation.save();

    return { conversation, expired: true };
};

export const getRequestReceiverId = (conversation) => {
    if (!conversation?.initiator || !Array.isArray(conversation?.participants)) {
        return null;
    }

    const initiatorId = String(conversation.initiator);
    const receiver = conversation.participants.find((participant) => String(participant?._id || participant) !== initiatorId);

    return receiver ? String(receiver?._id || receiver) : null;
};

export const REQUEST_PENDING_SENDER_LIMIT = 2;
