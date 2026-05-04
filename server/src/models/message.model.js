import mongoose, { Schema } from 'mongoose';

const messageSchema = new Schema(
    {
        sender: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        conversation: {
            type: Schema.Types.ObjectId,
            ref: 'Conversation',
            required: true,
        },
        content: {
            type: String,
            trim: true,
            default: '',
        },
        mediaUrl: {
            type: String,
            default: null,
        },
        isEdited: {
            type: Boolean,
            default: false,
        },
        isDeleted: {
            type: Boolean,
            default: false,
        },
        readBy: [
            {
                type: Schema.Types.ObjectId,
                ref: 'User',
            },
        ],
        deliveredTo: [
            {
                type: Schema.Types.ObjectId,
                ref: 'User',
            },
        ],
    },
    { timestamps: true }
);

messageSchema.index({ conversation: 1, createdAt: -1 });
messageSchema.index({ conversation: 1, sender: 1, createdAt: -1 });
messageSchema.index({ conversation: 1, readBy: 1 });
messageSchema.index({ conversation: 1, deliveredTo: 1 });
messageSchema.index({ conversation: 1 });
messageSchema.index({ sender: 1 });

export const Message = mongoose.model('Message', messageSchema);