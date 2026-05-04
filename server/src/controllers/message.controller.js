import mongoose from "mongoose";
import { Message } from "../models/message.model.js";
import { Conversation } from "../models/conversation.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { apiError } from "../utils/apiError.js";
import { apiResponse } from "../utils/apiResponse.js";
import { uploadOnCloudinary, deleteFromCloudinary } from "../utils/cloudinary.js";
import { io } from "../index.js";
import { emitToUserRoom } from "../socket/io.js";
import { logger } from "../utils/logger.js";
import {
    expireConversationIfNeeded,
    getRequestExpiryDate,
    getRequestReceiverId,
    REQUEST_PENDING_SENDER_LIMIT,
} from "../utils/conversationRequest.js";

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

// Validate MongoDB ObjectId
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// Validate conversation exists and user is participant
const validateConversationAccess = async (conversationId, userId) => {
    if (!isValidId(conversationId)) {
        throw new apiError(400, "Invalid Conversation ID");
    }

    if (!isValidId(userId)) {
        throw new apiError(400, "Invalid User ID");
    }

    const conversation = await Conversation.findById(conversationId).select(
        "participants status initiator pendingMessageCount expiresAt"
    );

    if (!conversation) {
        throw new apiError(404, "Conversation not found");
    }

    const isParticipant = conversation.participants.some(
        (p) => p.toString() === userId.toString()
    );

    if (!isParticipant) {
        // Log security violation
        logger.warn(`🚨 SECURITY: Unauthorized access attempt - User ${userId} tried to access conversation ${conversationId}`);
        throw new apiError(403, "You are not part of this conversation");
    }

    return conversation;
};

// Enhanced security validation for sensitive operations
const validateSensitiveAccess = async (conversationId, userId, operation = "access") => {
    // Re-verify user is a participant (defense-in-depth)
    const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: userId,
    }).select("participants");

    if (!conversation) {
        logger.warn(`🚨 SECURITY: Unauthorized ${operation} - User ${userId} on conversation ${conversationId}`);
        throw new apiError(403, "Unauthorized operation");
    }

    return conversation;
};

const emitRequestExpired = (conversation) => {
    if (!conversation || conversation.status !== "expired") return;

    const participantIds = Array.isArray(conversation.participants)
        ? conversation.participants.map((participant) => String(participant?._id || participant)).filter(Boolean)
        : [];

    participantIds.forEach((participantId) => {
        emitToUserRoom(participantId, "request_expired", {
            conversationId: String(conversation._id),
            status: "expired",
        });
    });
};

const serializeMessage = (message) => {
    if (!message) return null;

    // Convert Mongoose document to plain object
    const messageObj = message.toObject?.() || message;

    // Ensure conversation ID is properly serialized
    const conversationId = messageObj.conversation?._id || messageObj.conversation;

    return {
        _id: String(messageObj._id),
        sender: {
            _id: String(messageObj.sender?._id),
            fullName: messageObj.sender?.fullName || "",
            username: messageObj.sender?.username || "",
            profilePicture: messageObj.sender?.profilePicture || null,
        },
        conversation: String(conversationId),
        conversationId: String(conversationId), // Alternate field for compatibility
        content: messageObj.content || "",
        mediaUrl: messageObj.mediaUrl || null,
        isEdited: Boolean(messageObj.isEdited),
        isDeleted: Boolean(messageObj.isDeleted),
        deliveredTo: Array.isArray(messageObj.deliveredTo)
            ? messageObj.deliveredTo.map((id) => String(id?._id || id))
            : [],
        readBy: Array.isArray(messageObj.readBy)
            ? messageObj.readBy.map((id) => String(id?._id || id))
            : [],
        createdAt: messageObj.createdAt || new Date().toISOString(),
        updatedAt: messageObj.updatedAt || new Date().toISOString(),
    };
};

const emitMessageToParticipants = async (conversation, message) => {
    // Security: Get fresh participant list from database
    const conversationFromDb = await Conversation.findById(conversation._id)
        .select("participants")
        .lean();

    if (!conversationFromDb) {
        logger.warn("⚠️ Conversation not found when emitting message");
        return;
    }

    const participantIds = Array.isArray(conversationFromDb?.participants)
        ? conversationFromDb.participants.map((participant) => String(participant?._id || participant)).filter(Boolean)
        : [];

    const uniqueParticipantIds = [...new Set(participantIds)];

    // Convert message to plain object for proper Socket.IO serialization
    const serializedMessage = serializeMessage(message);

    if (!serializedMessage) return;

    // Security: Only emit to verified participants
    uniqueParticipantIds.forEach((participantId) => {
        // Double-check participant is in the conversation
        const isValidParticipant = participantIds.includes(participantId);
        if (!isValidParticipant) {
            logger.warn(`⚠️ Attempted to emit message to non-participant: ${participantId}`);
            return;
        }
        io.to(`user:${participantId}`).emit("receive-message", serializedMessage);
    });
};

// Validate message exists and user is the sender
const validateMessageOwnership = async (messageId, userId) => {
    if (!isValidId(messageId)) {
        throw new apiError(400, "Invalid Message ID");
    }

    const message = await Message.findById(messageId);
    if (!message) {
        throw new apiError(404, "Message not found");
    }

    if (message.sender.toString() !== userId.toString()) {
        throw new apiError(403, "You are not authorized to perform this action");
    }

    return message;
};

// --------------------------------------------------
// SEND MESSAGE
// POST /api/v1/messages/:conversationId
// --------------------------------------------------
const sendMessage = asyncHandler(async (req, res) => {
    const { conversationId } = req.params;
    const senderId = req.user._id;

    // Safety check for req.body when using multer
    const content = req.body?.content;

    // --------------------------------------------------
    // STEP 1: Validate conversation access
    // --------------------------------------------------
    const conversation = await validateConversationAccess(conversationId, senderId);
    const senderIdString = String(senderId);

    const { conversation: activeConversation, expired } = await expireConversationIfNeeded(conversation);
    if (expired) {
        emitRequestExpired(activeConversation);
        throw new apiError(400, "Request expired. Send again.");
    }

    const mediaLocalPath = req.file?.path;
    const trimmedContent = content?.trim() || "";
    const pendingMessageCount = Number(activeConversation.pendingMessageCount || 0);

    if (!activeConversation.initiator) {
        activeConversation.initiator = senderId;
        activeConversation.status = "pending";
        activeConversation.pendingMessageCount = pendingMessageCount;
        activeConversation.expiresAt = getRequestExpiryDate();
        await activeConversation.save();
    }

    if (activeConversation.status !== "accepted") {
        if (activeConversation.status === "rejected") {
            throw new apiError(400, "Chat request was rejected. Send again.");
        }

        if (activeConversation.status === "expired") {
            throw new apiError(400, "Request expired. Send again.");
        }

        if (activeConversation.status !== "pending") {
            throw new apiError(403, "Accept request before sending messages");
        }

        const initiatorId = activeConversation.initiator ? String(activeConversation.initiator) : "";
        if (initiatorId && initiatorId !== senderIdString) {
            throw new apiError(403, "Accept request to reply");
        }

        if (mediaLocalPath) {
            throw new apiError(403, "Media not allowed before acceptance");
        }

        if (!trimmedContent) {
            throw new apiError(403, "Only text messages are allowed before acceptance");
        }

        if (pendingMessageCount >= REQUEST_PENDING_SENDER_LIMIT) {
            throw new apiError(403, "Wait for user to accept request");
        }
    }

    // --------------------------------------------------
    // STEP 2: Handle media upload via Cloudinary
    // --------------------------------------------------
    let mediaUrl = null;

    if (mediaLocalPath) {
        const uploadedMedia = await uploadOnCloudinary(mediaLocalPath);
        if (!uploadedMedia?.url) {
            // Local file is already deleted by uploadOnCloudinary function on error
            throw new apiError(500, "Error uploading media to Cloudinary. Please try again.");
        }
        mediaUrl = uploadedMedia.url;
        logger.log(`✅ Media uploaded to Cloudinary: ${mediaUrl}`);
    }

    // --------------------------------------------------
    // STEP 3: Validate at least content or media exists
    // --------------------------------------------------
    if ((!trimmedContent && !mediaUrl)) {
        throw new apiError(400, "Message content or media is required");
    }

    // --------------------------------------------------
    // STEP 4: Validate content length
    // --------------------------------------------------
    if (trimmedContent && trimmedContent.length > 1000) {
        throw new apiError(400, "Message content cannot exceed 1000 characters");
    }

    // --------------------------------------------------
    // STEP 5: Create message in database
    // --------------------------------------------------
    let message = await Message.create({
        sender: senderId,
        conversation: conversationId,
        content: trimmedContent,
        mediaUrl: mediaUrl || null,
        deliveredTo: [senderId],
        readBy: [senderId],
    });

    if (activeConversation.status === "pending") {
        activeConversation.pendingMessageCount = pendingMessageCount + 1;
        await activeConversation.save();

        const receiverId = getRequestReceiverId(activeConversation);
        if (receiverId) {
            emitToUserRoom(receiverId, "new_message_request", {
                conversationId: String(activeConversation._id),
                status: "pending",
                pendingMessageCount: Number(activeConversation.pendingMessageCount || 0),
                initiator: String(activeConversation.initiator),
                expiresAt: activeConversation.expiresAt,
            });
        }
    }

    // --------------------------------------------------
    // STEP 6: Update lastMessage + unread counters in conversation
    // --------------------------------------------------
    const participantIds = Array.isArray(activeConversation?.participants)
        ? activeConversation.participants.map((participant) => String(participant?._id || participant)).filter(Boolean)
        : [];

    const incUpdate = {};
    participantIds.forEach((participantId) => {
        if (participantId === String(senderId)) return;
        incUpdate[`unreadCounters.${participantId}`] = 1;
    });

    await Conversation.updateOne(
        { _id: conversationId },
        {
            $set: { lastMessage: message._id },
            ...(Object.keys(incUpdate).length > 0 ? { $inc: incUpdate } : {}),
        }
    );

    const updatedConversation = await Conversation.findById(conversationId)
        .select("participants unreadCounters")
        .lean();

    const updatedParticipantIds = Array.isArray(updatedConversation?.participants)
        ? updatedConversation.participants.map((participant) => String(participant?._id || participant)).filter(Boolean)
        : [];

    updatedParticipantIds.forEach((participantId) => {
        const unreadCount = Number(updatedConversation?.unreadCounters?.[participantId] || 0);
        emitToUserRoom(participantId, "conversation-unread-updated", {
            conversationId: String(conversationId),
            unreadCount: Number.isFinite(unreadCount) && unreadCount > 0 ? Math.floor(unreadCount) : 0,
        });
    });

    // --------------------------------------------------
    // STEP 7: Populate sender details
    // --------------------------------------------------
    message = await message.populate(
        "sender",
        "fullName username profilePicture"
    );

    // --------------------------------------------------
    // STEP 8: Emit real-time event to conversation room (with authorization verification)
    // --------------------------------------------------
    await emitMessageToParticipants(activeConversation, message);

    // --------------------------------------------------
    // STEP 9: Send success response
    // --------------------------------------------------
    const serializedMessage = serializeMessage(message);
    return res.status(201).json(
        new apiResponse(201, serializedMessage, "Message sent successfully")
    );
});

// --------------------------------------------------
// GET ALL MESSAGES
// GET /api/v1/messages/:conversationId
// --------------------------------------------------
const getMessages = asyncHandler(async (req, res) => {
    const { conversationId } = req.params;
    const userId = req.user._id;

    // Validate conversation access
    const conversation = await validateConversationAccess(conversationId, userId);
    const { conversation: activeConversation, expired } = await expireConversationIfNeeded(conversation);
    if (expired) {
        emitRequestExpired(activeConversation);
    }

    // Fetch all non-deleted messages sorted oldest first
    const messages = await Message.find({
        conversation: conversationId,
        isDeleted: false,
    })
        .populate("sender", "fullName username profilePicture")
        .populate("readBy", "fullName username profilePicture")
        .sort({ createdAt: 1 });

    // Serialize messages for consistent API response
    const serializedMessages = messages.map((msg) => serializeMessage(msg));

    return res.status(200).json(
        new apiResponse(200, serializedMessages, "Messages fetched successfully")
    );
});

// --------------------------------------------------
// EDIT MESSAGE
// PATCH /api/v1/messages/:messageId
// --------------------------------------------------
const editMessage = asyncHandler(async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user._id;

    // Safety check for req.body
    const content = req.body?.content;

    // Validate content exists and is not empty or space only
    if (!content || !content.trim()) {
        throw new apiError(400, "Content is required to edit a message");
    }

    // Validate content length
    if (content.trim().length > 1000) {
        throw new apiError(400, "Message content cannot exceed 1000 characters");
    }

    // Validate message ownership
    const message = await validateMessageOwnership(messageId, userId);

    // Security: Double-check user can access the conversation where the message belongs
    await validateSensitiveAccess(message.conversation, userId, "edit_message");

    // Cannot edit a deleted message
    if (message.isDeleted) {
        throw new apiError(400, "Cannot edit a deleted message");
    }

    // Cannot edit an empty message
    if (!message.content && !message.mediaUrl) {
        throw new apiError(400, "Cannot edit an empty message");
    }

    // Update content and mark as edited
    message.content = content.trim();
    message.isEdited = true;
    await message.save();

    // Populate sender details
    const populated = await message.populate(
        "sender",
        "fullName username profilePicture"
    );

    // Emit real-time edit event to all conversation participants (user rooms)
    const conversation = await Conversation.findById(message.conversation).lean();
    const participantIds = Array.isArray(conversation?.participants)
        ? conversation.participants.map((participant) => String(participant?._id || participant)).filter(Boolean)
        : [];

    const serializedMessage = serializeMessage(populated);
    const uniqueParticipantIds = [...new Set(participantIds)];

    uniqueParticipantIds.forEach((participantId) => {
        io.to(`user:${participantId}`).emit("message-edited", serializedMessage);
    });

    return res.status(200).json(
        new apiResponse(200, serializedMessage, "Message edited successfully")
    );
});

// --------------------------------------------------
// DELETE MESSAGE (SOFT DELETE)
// DELETE /api/v1/messages/:messageId
// --------------------------------------------------
const deleteMessage = asyncHandler(async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user._id;

    if (!isValidId(messageId)) {
        throw new apiError(400, "Invalid Message ID");
    }

    const message = await Message.findById(messageId);
    if (!message) {
        throw new apiError(404, "Message not found");
    }

    // Security: Verify user can access the conversation and allow delete
    await validateConversationAccess(message.conversation, userId);

    // Security: Double-check authorization for sensitive operation
    await validateSensitiveAccess(message.conversation, userId, "delete_message");

    // Check if already deleted
    if (message.isDeleted) {
        throw new apiError(400, "Message is already deleted");
    }

    // --------------------------------------------------
    // STEP 1: Delete media from Cloudinary if exists
    // --------------------------------------------------
    if (message.mediaUrl) {
        const deleteSuccess = await deleteFromCloudinary(message.mediaUrl);
        if (!deleteSuccess) {
            logger.warn("⚠️ Warning: Could not delete message media from Cloudinary");
            // Continue anyway, as soft delete can still proceed
        }
    }

    // --------------------------------------------------
    // STEP 2: Soft delete - mark as deleted and clear content
    // --------------------------------------------------
    message.isDeleted = true;
    message.content = "";
    message.mediaUrl = null;
    await message.save();

    // --------------------------------------------------
    // STEP 3: Emit real-time delete event to all conversation participants (user rooms)
    // --------------------------------------------------
    const conversation = await Conversation.findById(message.conversation).lean();
    const participantIds = Array.isArray(conversation?.participants)
        ? conversation.participants.map((participant) => String(participant?._id || participant)).filter(Boolean)
        : [];

    const uniqueParticipantIds = [...new Set(participantIds)];

    uniqueParticipantIds.forEach((participantId) => {
        io.to(`user:${participantId}`).emit("message-deleted", {
            messageId,
            conversationId: message.conversation.toString(),
        });
    });

    // --------------------------------------------------
    // STEP 4: Success response
    // --------------------------------------------------
    return res.status(200).json(
        new apiResponse(200, {}, "Message deleted successfully")
    );
});

// --------------------------------------------------
// MARK MESSAGES AS READ
// PATCH /api/v1/messages/:conversationId/read
// --------------------------------------------------
const markAsRead = asyncHandler(async (req, res) => {
    const { conversationId } = req.params;
    const userId = req.user._id;

    // Validate conversation access
    await validateConversationAccess(conversationId, userId);

    // Convert to ObjectId for correct MongoDB comparison
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const convObjectId = new mongoose.Types.ObjectId(conversationId);

    // Mark all unread non-deleted messages as read
    // Skip own sent messages
    // Use addToSet to prevent duplicate ids in readBy array
    const unreadMessages = await Message.find(
        {
            conversation: convObjectId,
            sender: { $ne: userObjectId },
            readBy: { $nin: [userObjectId] },
            isDeleted: false,
        },
        { _id: 1 }
    ).lean();

    const messageIds = unreadMessages.map((message) => message._id.toString());

    const result = await Message.updateMany(
        {
            _id: { $in: messageIds },
            isDeleted: false,
        },
        {
            $addToSet: { readBy: userObjectId }
        }
    );

    await Conversation.updateOne(
        {
            _id: convObjectId,
            participants: userObjectId,
        },
        {
            $set: {
                [`unreadCounters.${String(userId)}`]: 0,
            },
        }
    );

    emitToUserRoom(String(userId), "conversation-unread-updated", {
        conversationId,
        unreadCount: 0,
    });

    // Emit real-time read event to conversation room
    io.to(conversationId).emit("messages-read", {
        conversationId,
        userId,
        messageIds,
    });

    return res.status(200).json(
        new apiResponse(200, {
            unreadCount: 0,
            updatedMessages: result.modifiedCount,
            messageIds,
        }, "Messages marked as read successfully")
    );
});

// --------------------------------------------------
// EXPORT
// --------------------------------------------------
export {
    sendMessage,
    getMessages,
    editMessage,
    deleteMessage,
    markAsRead,
};
