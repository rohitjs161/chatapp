import mongoose from "mongoose";
import { Conversation } from "../models/conversation.model.js";
import { apiError } from "./apiError.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const assertValidObjectId = (value, fieldName) => {
    if (!isValidObjectId(value)) {
        throw new apiError(400, `Invalid ${fieldName}`);
    }

    return String(value);
};

const findParticipantConversation = async ({
    conversationId,
    userId,
    select = "_id participants status initiator pendingMessageCount expiresAt",
    populate = null,
    lean = false,
    conversationModel = Conversation,
} = {}) => {
    assertValidObjectId(conversationId, "Conversation ID");
    assertValidObjectId(userId, "User ID");

    let query = conversationModel.findOne({
        _id: conversationId,
        participants: userId,
    });

    if (select) {
        query = query.select(select);
    }

    if (populate) {
        query = query.populate(populate);
    }

    if (lean) {
        query = query.lean();
    }

    const conversation = await query;

    if (!conversation) {
        throw new apiError(403, "Unauthorized access");
    }

    return conversation;
};

export { assertValidObjectId, findParticipantConversation, isValidObjectId };