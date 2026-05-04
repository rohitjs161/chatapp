import mongoose from "mongoose";
import { Conversation } from "../models/conversation.model.js";
import { Message } from "../models/message.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { apiError } from "../utils/apiError.js";
import { apiResponse } from "../utils/apiResponse.js";
import { emitToUserRoom } from "../socket/io.js";
import { expireConversationIfNeeded, getRequestExpiryDate, getRequestReceiverId } from "../utils/conversationRequest.js";

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

const getConversationViewForUser = (conversation, userId) => {
    const userIdString = String(userId);
    const unreadCount = Number(conversation?.unreadCounters?.get?.(userIdString) || 0);
    const isMuted = Array.isArray(conversation?.mutedUsers)
        ? conversation.mutedUsers.some((id) => String(id?._id || id) === userIdString)
        : false;

    return {
        ...conversation.toObject(),
        unreadCount: Number.isFinite(unreadCount) && unreadCount > 0 ? Math.floor(unreadCount) : 0,
        isMuted,
    };
};

const emitRequestExpiredIfNeeded = (conversation) => {
    if (!conversation || conversation.status !== "expired") return;

    const conversationId = String(conversation._id);
    const participantIds = Array.isArray(conversation.participants)
        ? conversation.participants.map((participant) => String(participant?._id || participant)).filter(Boolean)
        : [];

    participantIds.forEach((participantId) => {
        emitToUserRoom(participantId, "request_expired", { conversationId, status: "expired" });
    });
};

const emitPendingRequest = (conversation, receiverId) => {
    if (!conversation || !receiverId) return;

    emitToUserRoom(String(receiverId), "new_message_request", {
        conversationId: String(conversation._id),
        status: "pending",
        pendingMessageCount: Number(conversation.pendingMessageCount || 0),
        initiator: String(conversation.initiator),
        expiresAt: conversation.expiresAt,
    });
};

// --------------------------------------------------
// GET OR CREATE CONVERSATION
// GET /api/v1/conversations/:receiverId
// --------------------------------------------------
const getOrCreateConversation = asyncHandler(async (req, res) => {
    const { receiverId } = req.params;
    const senderId = req.user._id;

    // Check receiverId exists
    if (!receiverId) {
        throw new apiError(400, "Receiver ID is required");
    }

    // Validate receiverId format
    if (!mongoose.Types.ObjectId.isValid(receiverId)) {
        throw new apiError(400, "Invalid Receiver ID");
    }

    // Prevent self-conversation
    if (senderId.toString() === receiverId.toString()) {
        throw new apiError(400, "You cannot start a conversation with yourself");
    }

    // Check existing conversation first to prevent duplicates
    let conversation = await Conversation.findOne({
        participants: { $all: [senderId, receiverId] }
    })
        .populate("participants", "-password -refreshToken -profilePicturePublicId")
        .populate({
            path: "lastMessage",
            populate: {
                path: "sender",
                select: "fullName username profilePicture"
            }
        });

    // If exists, reuse it instead of creating a duplicate.
    if (conversation) {
        const { conversation: updatedConversation, expired } = await expireConversationIfNeeded(conversation);
        if (expired) {
            emitRequestExpiredIfNeeded(updatedConversation);
        }

        if (updatedConversation.status === "rejected" || updatedConversation.status === "expired") {
            updatedConversation.status = "pending";
            updatedConversation.initiator = senderId;
            updatedConversation.pendingMessageCount = 0;
            updatedConversation.expiresAt = getRequestExpiryDate();
            await updatedConversation.save();

            const receiver = Array.isArray(updatedConversation.participants)
                ? updatedConversation.participants.find((participant) => String(participant?._id || participant) !== String(senderId))
                : null;

            emitPendingRequest(updatedConversation, receiver ? String(receiver?._id || receiver) : null);

            return res.status(200).json(
                new apiResponse(200, getConversationViewForUser(updatedConversation, senderId), "Conversation reused successfully")
            );
        }

        if (updatedConversation.status === "pending") {
            return res.status(200).json(
                new apiResponse(200, getConversationViewForUser(updatedConversation, senderId), "Conversation fetched successfully")
            );
        }

        return res.status(200).json(
            new apiResponse(200, getConversationViewForUser(updatedConversation, senderId), "Conversation fetched successfully")
        );
    }

    // Create new conversation
    const senderIdString = String(senderId);
    const receiverIdString = String(receiverId);

    conversation = await Conversation.create({
        participants: [senderId, receiverId],
        unreadCounters: {
            [senderIdString]: 0,
            [receiverIdString]: 0,
        },
        mutedUsers: [],
        status: "pending",
        initiator: senderId,
        pendingMessageCount: 0,
        expiresAt: getRequestExpiryDate(),
    });

    // Populate after creation
    conversation = await conversation.populate([
        { path: "participants", select: "-password -refreshToken -profilePicturePublicId" },
        { path: "lastMessage" }
    ]);

    return res.status(201).json(
        new apiResponse(201, getConversationViewForUser(conversation, senderId), "Conversation created successfully")
    );
});

// --------------------------------------------------
// GET ALL CONVERSATIONS WITH UNREAD COUNT
// GET /api/v1/conversations
// --------------------------------------------------
const getUserConversations = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    // Fetch all conversations sorted by latest
    const conversations = await Conversation.find({
        participants: userId
    })
        .populate("participants", "-password -refreshToken -profilePicturePublicId")
        .populate({
            path: "lastMessage",
            populate: {
                path: "sender",
                select: "fullName username profilePicture"
            }
        })
        .sort({ updatedAt: -1 });

    const conversationsWithUnread = [];
    for (const conversation of conversations) {
        const { conversation: updatedConversation, expired } = await expireConversationIfNeeded(conversation);
        if (expired) {
            emitRequestExpiredIfNeeded(updatedConversation);
        }

        conversationsWithUnread.push(getConversationViewForUser(updatedConversation, userId));
    }

    return res.status(200).json(
        new apiResponse(
            200,
            conversationsWithUnread,
            "Conversations fetched successfully"
        )
    );
});

// --------------------------------------------------
// DELETE CONVERSATION
// DELETE /api/v1/conversations/:conversationId
// --------------------------------------------------
const deleteConversation = asyncHandler(async (req, res) => {
    const { conversationId } = req.params;
    const userId = req.user._id;

    // Validate conversationId format
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        throw new apiError(400, "Invalid Conversation ID");
    }

    // Find conversation
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
        throw new apiError(404, "Conversation not found");
    }

    // Only participants can delete
    const isParticipant = conversation.participants.some(
        (p) => p.toString() === userId.toString()
    );

    if (!isParticipant) {
        throw new apiError(403, "You are not authorized to delete this conversation");
    }

    // Delete conversation and all its messages
    await Conversation.findByIdAndDelete(conversationId);
    await Message.deleteMany({ conversation: conversationId });

    return res.status(200).json(
        new apiResponse(200, {}, "Conversation deleted successfully")
    );
});

const updateConversationMute = asyncHandler(async (req, res) => {
    const { conversationId } = req.params;
    const userId = req.user._id;
    const { muted } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        throw new apiError(400, "Invalid Conversation ID");
    }

    if (typeof muted !== "boolean") {
        throw new apiError(400, "muted must be a boolean");
    }

    const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: userId,
    }).populate("participants", "-password -refreshToken -profilePicturePublicId");

    if (!conversation) {
        throw new apiError(404, "Conversation not found");
    }

    const update = muted
        ? { $addToSet: { mutedUsers: userId } }
        : { $pull: { mutedUsers: userId } };

    const updatedConversation = await Conversation.findByIdAndUpdate(
        conversationId,
        update,
        { new: true }
    )
        .populate("participants", "-password -refreshToken -profilePicturePublicId")
        .populate({
            path: "lastMessage",
            populate: {
                path: "sender",
                select: "fullName username profilePicture",
            },
        });

    const payload = {
        conversationId: String(conversationId),
        muted,
    };

    emitToUserRoom(String(userId), "conversation-mute-updated", payload);

    return res.status(200).json(
        new apiResponse(
            200,
            getConversationViewForUser(updatedConversation, userId),
            muted ? "Conversation muted" : "Conversation unmuted"
        )
    );
});

const acceptConversationRequest = asyncHandler(async (req, res) => {
    const { conversationId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        throw new apiError(400, "Invalid Conversation ID");
    }

    const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: userId,
    })
        .populate("participants", "-password -refreshToken -profilePicturePublicId")
        .populate({
            path: "lastMessage",
            populate: {
                path: "sender",
                select: "fullName username profilePicture",
            },
        });

    if (!conversation) {
        throw new apiError(404, "Conversation not found");
    }

    const { conversation: maybeExpiredConversation, expired } = await expireConversationIfNeeded(conversation);
    if (expired) {
        emitRequestExpiredIfNeeded(maybeExpiredConversation);
        throw new apiError(400, "Request expired. Send again.");
    }

    // Idempotent accept for clients that retry or receive stale UI state.
    if (maybeExpiredConversation.status === "accepted") {
        return res.status(200).json(
            new apiResponse(200, getConversationViewForUser(maybeExpiredConversation, userId), "Request already accepted")
        );
    }

    if (maybeExpiredConversation.status !== "pending") {
        throw new apiError(400, "Only pending requests can be accepted");
    }

    const initiatorId = maybeExpiredConversation.initiator
        ? String(maybeExpiredConversation.initiator)
        : null;

    // Legacy-safe fallback: if initiator is missing, allow accept by any participant.
    if (initiatorId && String(userId) === initiatorId) {
        throw new apiError(403, "Only receiver can accept this request");
    }

    maybeExpiredConversation.status = "accepted";
    maybeExpiredConversation.expiresAt = null;
    await maybeExpiredConversation.save();

    const participantIds = maybeExpiredConversation.participants.map((participant) => String(participant?._id || participant));
    const payload = {
        conversationId: String(maybeExpiredConversation._id),
        status: "accepted",
    };

    participantIds.forEach((participantId) => {
        emitToUserRoom(participantId, "request_accepted", payload);
    });

    return res.status(200).json(
        new apiResponse(200, getConversationViewForUser(maybeExpiredConversation, userId), "Request accepted")
    );
});

const rejectConversationRequest = asyncHandler(async (req, res) => {
    const { conversationId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        throw new apiError(400, "Invalid Conversation ID");
    }

    const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: userId,
    })
        .populate("participants", "-password -refreshToken -profilePicturePublicId")
        .populate({
            path: "lastMessage",
            populate: {
                path: "sender",
                select: "fullName username profilePicture",
            },
        });

    if (!conversation) {
        throw new apiError(404, "Conversation not found");
    }

    const { conversation: maybeExpiredConversation, expired } = await expireConversationIfNeeded(conversation);
    if (expired) {
        emitRequestExpiredIfNeeded(maybeExpiredConversation);
        throw new apiError(400, "Request expired. Send again.");
    }

    // Idempotent reject for clients that retry or receive stale UI state.
    if (maybeExpiredConversation.status === "rejected") {
        return res.status(200).json(
            new apiResponse(200, getConversationViewForUser(maybeExpiredConversation, userId), "Request already rejected")
        );
    }

    if (maybeExpiredConversation.status !== "pending") {
        throw new apiError(400, "Only pending requests can be rejected");
    }

    const receiverId = getRequestReceiverId(maybeExpiredConversation);
    // Legacy-safe fallback: if initiator/receiver cannot be inferred, allow participant rejection.
    if (receiverId && receiverId !== String(userId)) {
        throw new apiError(403, "Only receiver can reject this request");
    }

    maybeExpiredConversation.status = "rejected";
    maybeExpiredConversation.expiresAt = null;
    await maybeExpiredConversation.save();

    const participantIds = maybeExpiredConversation.participants.map((participant) => String(participant?._id || participant));
    const payload = {
        conversationId: String(maybeExpiredConversation._id),
        status: "rejected",
    };

    participantIds.forEach((participantId) => {
        emitToUserRoom(participantId, "request_rejected", payload);
    });

    return res.status(200).json(
        new apiResponse(200, getConversationViewForUser(maybeExpiredConversation, userId), "Request rejected")
    );
});

// --------------------------------------------------
// EXPORT
// --------------------------------------------------
export {
    getOrCreateConversation,
    getUserConversations,
    deleteConversation,
    updateConversationMute,
    acceptConversationRequest,
    rejectConversationRequest,
};