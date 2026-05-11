import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const tempDir = path.resolve(process.cwd(), "public", "temp");

// Ensure temp directory exists
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, tempDir);
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname) || "";
        const unique = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
        cb(null, `${unique}${ext}`);
    },
});

export const upload = multer({ storage });