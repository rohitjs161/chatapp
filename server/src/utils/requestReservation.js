import { Conversation } from "../models/conversation.model.js";
import { apiError } from "./apiError.js";
import { getRequestExpiryDate, REQUEST_PENDING_SENDER_LIMIT } from "./conversationRequest.js";

/**
 * Attempt to atomically reserve a pending-message slot for a conversation.
 * Returns the updated conversation document when successful.
 * Throws apiError(403, ...) when reservation fails (limit reached or invalid state).
 *
 * conversationModel is injectable for easier unit testing/mocking.
 */
export const reservePendingMessageSlot = async (
  conversationId,
  senderId,
  conversationModel = Conversation,
  limit = REQUEST_PENDING_SENDER_LIMIT
) => {
  if (!conversationId) throw new apiError(400, "Invalid conversation id");

  const filter = {
    _id: conversationId,
    status: "pending",
    $and: [
      {
        $or: [
          { initiator: null },
          { initiator: undefined },
          { initiator: senderId },
        ],
      },
      {
        $or: [
          { pendingMessageCount: { $lt: limit } },
          { pendingMessageCount: { $exists: false } },
        ],
      },
    ],
  };

  const update = {
    $inc: { pendingMessageCount: 1 },
    $set: { initiator: senderId, expiresAt: getRequestExpiryDate(), status: "pending" },
  };

  const updated = await conversationModel.findOneAndUpdate(filter, update, { new: true });
  // debug: log result when running unit tests
  // console.log('reservePendingMessageSlot: filter=', JSON.stringify(filter), 'updated=', JSON.stringify(updated));

  if (!updated) {
    throw new apiError(403, "Message request limit reached");
  }

  return updated;
};

export default reservePendingMessageSlot;
