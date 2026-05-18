import multer from "multer";
import path from "path";
import { fileTypeFromBuffer } from "file-type";
import crypto from "crypto";
import sharp from "sharp";
import { apiError } from "../utils/apiError.js";

// Production-safe upload limits
const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// Use memory storage to avoid writing untrusted files to disk
const storage = multer.memoryStorage();

export const upload = multer({
    storage,
    limits: {
        fileSize: MAX_UPLOAD_SIZE_BYTES,
        files: 1,
    },
});

// Allowed file extensions and mime types
const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const ALLOWED_MIME_PREFIX = "image/";
const SUSPICIOUS_EXTENSIONS = new Set(["php", "xml", "svg", "html", "js", "exe", "sh", "bat"]);

// Validate uploaded image (to be used after `upload.single(...)`)
export const validateImageUpload = async (req, res, next) => {
    try {
        const file = req.file;
        if (!file) return next(); // No file to validate

        // Basic filename checks
        const originalName = String(file.originalname || "");
        if (!originalName) throw new apiError(400, "Invalid file name");

        const nameParts = originalName.split('.').filter(Boolean);
        if (nameParts.length < 2) throw new apiError(400, "Invalid file name or extension");

        const claimedExt = String(nameParts[nameParts.length - 1] || "").toLowerCase().replace(/^\./, "");

        // Reject suspicious or disallowed extensions immediately
        if (!ALLOWED_EXTENSIONS.has(claimedExt)) {
            throw new apiError(415, "Unsupported file extension");
        }

        // Reject double-extension files where any intermediate ext is suspicious
        if (nameParts.length > 2) {
            const middleParts = nameParts.slice(0, -1);
            for (const p of middleParts) {
                const low = String(p || "").toLowerCase();
                if (SUSPICIOUS_EXTENSIONS.has(low)) {
                    throw new apiError(415, "Suspicious filename detected");
                }
            }
        }

        // Validate MIME type prefix
        const claimedMime = String(file.mimetype || "").toLowerCase();
        if (!claimedMime.startsWith(ALLOWED_MIME_PREFIX)) {
            throw new apiError(415, "Invalid MIME type");
        }

        // Validate magic bytes using file-type
        const buffer = file.buffer;
        if (!buffer || !(buffer instanceof Buffer)) {
            throw new apiError(400, "Invalid file upload");
        }

        const ft = await fileTypeFromBuffer(buffer);
        if (!ft || !ft.ext || !ft.mime) {
            throw new apiError(415, "Could not determine file type");
        }

        const detectedExt = String(ft.ext || "").toLowerCase();
        const detectedMime = String(ft.mime || "").toLowerCase();

        if (!ALLOWED_EXTENSIONS.has(detectedExt)) {
            throw new apiError(415, "Unsupported file type");
        }

        if (!detectedMime.startsWith(ALLOWED_MIME_PREFIX)) {
            throw new apiError(415, "Invalid file content");
        }

        // Reprocess image with sharp to strip metadata and normalize
        let outputFormat = detectedExt === 'png' ? 'png' : detectedExt === 'webp' ? 'webp' : 'jpeg';
        const processedBuffer = await sharp(buffer)
            .toFormat(outputFormat, { quality: 90 })
            .toBuffer();

        // Generate secure randomized filename (no user input)
        const randomName = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}.${outputFormat}`;

        // Attach processed buffer and metadata to req.file for downstream handlers
        req.file.processedBuffer = processedBuffer;
        req.file.processedMimetype = outputFormat === 'png' ? 'image/png' : outputFormat === 'webp' ? 'image/webp' : 'image/jpeg';
        req.file.secureFilename = randomName;

        return next();
    } catch (err) {
        return next(err);
    }
};