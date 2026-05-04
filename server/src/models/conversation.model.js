import mongoose, { Schema } from 'mongoose';

const conversationSchema = new Schema(
  {
    participants: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
    ],
    lastMessage: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },
    unreadCounters: {
      type: Map,
      of: Number,
      default: {},
    },
    mutedUsers: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'expired'],
      default: 'pending',
    },
    initiator: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    pendingMessageCount: {
      type: Number,
      default: 0,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

conversationSchema.index({ participants: 1 });
conversationSchema.index({ lastMessage: 1 });
conversationSchema.index({ mutedUsers: 1 });
conversationSchema.index({ status: 1, expiresAt: 1 });
conversationSchema.index({ initiator: 1 });

export const Conversation = mongoose.model('Conversation', conversationSchema);