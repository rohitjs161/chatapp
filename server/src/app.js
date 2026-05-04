import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import passport from "passport";
import configurePassport from "./config/passport.js";
import { apiError } from "./utils/apiError.js";
import { logger } from "./utils/logger.js";

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

const parseAllowedOrigins = () => {
    const raw = process.env.CORS_ORIGIN || "";
    return raw
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
};

const allowedOrigins = parseAllowedOrigins();

logger.log("Allowed CORS origins:", allowedOrigins);

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin — Postman, mobile, server-to-server
        if (!origin) {
            callback(null, true);
            return;
        }

        if (allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
        }

        logger.warn(`CORS blocked for origin: ${origin}`);
        callback(new apiError(403, "CORS policy does not allow this origin"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 200,
}));

// Force HTTPS redirect in production
if (process.env.NODE_ENV === "production") {
    app.use((req, res, next) => {
        const forwardedProto = req.header("x-forwarded-proto");

        if (forwardedProto && forwardedProto !== "https") {
            return res.redirect(`https://${req.header("host")}${req.originalUrl}`);
        }

        next();
    });
}

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(cookieParser());

// Initialize Passport for Google OAuth
configurePassport();
app.use(passport.initialize());

// Routes
import userRoute from "./routes/user.routes.js";
import conversationRoute from "./routes/conversation.routes.js";
import messageRoute from "./routes/message.routes.js";

app.use("/api/v1/user", userRoute);
app.use("/api/v1/conversations", conversationRoute);
app.use("/api/v1/messages", messageRoute);

// Health Check
app.get("/api/v1/health", (req, res) => {
    res.status(200).json({
        success: true,
        message: "Server is running",
        timestamp: new Date().toISOString(),
    });
});

// 404 Handler
app.use((req, res, next) => {
    res.status(404).json({
        success: false,
        statusCode: 404,
        message: `Route ${req.originalUrl} not found`,
        timestamp: new Date().toISOString(),
    });
});

// Global Error Handler
app.use((error, req, res, next) => {
    let statusCode = error.statusCode || 500;
    let message = error.message || "Internal Server Error";
    let errors = error.errors || [];

    if (error.name === "ValidationError") {
        statusCode = 400;
        message = "Validation Error";
        errors = Object.values(error.errors).map((err) => err.message);
    }

    if (error.code === 11000) {
        statusCode = 409;
        const field = Object.keys(error.keyPattern || {})[0] || "field";
        message = `${field} already exists`;
    }

    if (error.name === "JsonWebTokenError") {
        statusCode = 401;
        message = "Invalid token";
    }

    if (error.name === "TokenExpiredError") {
        statusCode = 401;
        message = "Token expired";
    }

    if (error.name === "CastError") {
        statusCode = 400;
        message = "Invalid ID format";
    }

    if (process.env.NODE_ENV === "development") {
        logger.error("ERROR:", {
            statusCode,
            message,
            errors,
            stack: error.stack,
        });
    }

    res.status(statusCode).json({
        success: false,
        status: error.status || (statusCode === 429 ? "rate_limited" : "error"),
        statusCode,
        message,
        errors: errors.length > 0 ? errors : undefined,
        ...(process.env.NODE_ENV === "development" && { stack: error.stack }),
    });
});

export { app };