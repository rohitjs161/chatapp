import { Router } from "express";
import {
    sendMessage,
    getMessages,
    editMessage,
    deleteMessage,
    markAsRead,
} from "../controllers/message.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { upload, validateImageUpload } from "../middlewares/multer.middleware.js";
import {
    sendMessageLimiter,
    editMessageLimiter,
    deleteMessageLimiter,
    markAsReadLimiter,
} from "../middlewares/rateLimit.middleware.js";

const router = Router();

router.route("/:conversationId").post(
    verifyJWT,
    sendMessageLimiter,
    upload.single("media"),
    validateImageUpload,
    sendMessage
);

router.route("/:conversationId").get(verifyJWT, getMessages);

router.route("/:messageId").patch(
    verifyJWT,
    editMessageLimiter,
    editMessage
);

router.route("/:messageId").delete(
    verifyJWT,
    deleteMessageLimiter,
    deleteMessage
);

router.route("/:conversationId/read").patch(
    verifyJWT,
    markAsReadLimiter,
    markAsRead
);

export default router;