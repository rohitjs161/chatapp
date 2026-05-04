import {v2 as cloudinary} from "cloudinary";
import fs from "fs"
import { logger } from "./logger.js";

cloudinary.config({ 
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
    api_key: process.env.CLOUDINARY_API_KEY, 
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const removeFileExtension = (value = "") => value.replace(/\.[^/.?#]+$/, "");

const extractCloudinaryAssetMeta = (fileUrl) => {
    try {
        if (!fileUrl) return null;

        const parsedUrl = new URL(fileUrl);
        const pathname = parsedUrl.pathname;

        // Matches: /<cloud_name>/<resource_type>/upload/<optional transforms>/<optional version>/<public_id>.<ext>
        const uploadMatch = pathname.match(/\/(image|video|raw)\/upload\/(.+)$/i);
        if (!uploadMatch) return null;

        const resourceType = String(uploadMatch[1] || "image").toLowerCase();
        const uploadTail = uploadMatch[2] || "";
        const tailSegments = uploadTail.split('/').filter(Boolean);

        let versionIndex = -1;
        for (let index = tailSegments.length - 1; index >= 0; index -= 1) {
            if (/^v\d+$/i.test(tailSegments[index])) {
                versionIndex = index;
                break;
            }
        }
        const publicIdWithExtension = versionIndex >= 0
            ? tailSegments.slice(versionIndex + 1).join('/')
            : tailSegments.join('/');

        const publicId = removeFileExtension(publicIdWithExtension);

        if (!publicId) return null;

        return { publicId, resourceType };
    } catch (error) {
        logger.error("❌ Error parsing Cloudinary URL:", error.message);
        return null;
    }
};

// --------------------------------------------------
// UPLOAD FILE TO CLOUDINARY
// --------------------------------------------------
const uploadOnCloudinary = async (localFilePath) => {
    try {
        if (!localFilePath) return null

        const response = await cloudinary.uploader.upload(localFilePath,{
            resource_type: "auto"
        });

        // Delete local file after successful upload
        if (fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
            logger.log(`✅ Local file deleted: ${localFilePath}`);
        }

        return response;
    } catch (error) {
        logger.error("❌ Cloudinary upload error:", error.message);
        // Delete local file in case of error
        if (fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
        }
        return null;
    }
}

// --------------------------------------------------
// DELETE FILE FROM CLOUDINARY
// --------------------------------------------------
const deleteFromCloudinary = async (fileUrl) => {
    try {
        if (!fileUrl) return true;

        const assetMeta = extractCloudinaryAssetMeta(fileUrl);
        const publicId = assetMeta?.publicId;
        const preferredResourceType = assetMeta?.resourceType || "image";

        if (!publicId) {
            logger.warn("⚠️ Could not extract publicId from URL:", fileUrl);
            return false;
        }

        const triedResourceTypes = new Set([preferredResourceType, "image", "video", "raw"]);

        for (const resourceType of triedResourceTypes) {
            const result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });

            if (result.result === "ok" || result.result === "not found") {
                logger.log(`✅ Cloudinary file deleted: ${publicId} (${resourceType})`);
                return true;
            }
        }

        logger.warn(`⚠️ Failed to delete from Cloudinary after fallbacks: ${publicId}`);
        return false;
    } catch (error) {
        logger.error("❌ Cloudinary deletion error:", error.message);
        return false;
    }
}

// --------------------------------------------------
// DELETE FILE FROM CLOUDINARY BY PUBLIC ID
// --------------------------------------------------
const deleteFromCloudinaryByPublicId = async (publicId, preferredResourceType = "image") => {
    try {
        if (!publicId) return true;

        const triedResourceTypes = new Set([preferredResourceType, "image", "video", "raw"]);

        for (const resourceType of triedResourceTypes) {
            const result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });

            if (result.result === "ok" || result.result === "not found") {
                logger.log(`✅ Cloudinary file deleted: ${publicId} (${resourceType})`);
                return true;
            }
        }

        logger.warn(`⚠️ Failed to delete from Cloudinary after fallbacks: ${publicId}`);
        return false;
    } catch (error) {
        logger.error("❌ Cloudinary deletion error:", error.message);
        return false;
    }
}

// --------------------------------------------------
// GET PUBLIC ID FROM CLOUDINARY URL
// --------------------------------------------------
const getPublicIdFromUrl = (fileUrl) => {
    try {
        if (!fileUrl) return null;

        return extractCloudinaryAssetMeta(fileUrl)?.publicId || null;
    } catch (error) {
        logger.error("❌ Error extracting publicId:", error.message);
        return null;
    }
}

export { uploadOnCloudinary, deleteFromCloudinary, deleteFromCloudinaryByPublicId, getPublicIdFromUrl }