import { Router } from "express";
import {
    getOrCreateConversation,
    getUserConversations,
    deleteConversation,
    updateConversationMute,
    acceptConversationRequest,
    rejectConversationRequest,
} from "../controllers/conversation.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import {
    conversationLimiter,
    deleteConversationLimiter,
} from "../middlewares/rateLimit.middleware.js";

const router = Router();

router.route("/").get(verifyJWT, getUserConversations);

router.route("/:receiverId").get(
    verifyJWT,
    conversationLimiter,
    getOrCreateConversation
);

router.route("/:conversationId").delete(
    verifyJWT,
    deleteConversationLimiter,
    deleteConversation
);

router.route("/:conversationId/mute").patch(
    verifyJWT,
    conversationLimiter,
    updateConversationMute
);

router.route("/:conversationId/accept").patch(
    verifyJWT,
    conversationLimiter,
    acceptConversationRequest
);

router.route("/:conversationId/reject").patch(
    verifyJWT,
    conversationLimiter,
    rejectConversationRequest
);

export default router;