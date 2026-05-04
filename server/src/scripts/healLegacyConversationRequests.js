import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../db/index.js";
import { Conversation } from "../models/conversation.model.js";
import { logger } from "../utils/logger.js";

const parseFlag = (flag) => process.argv.includes(flag);

const run = async () => {
    dotenv.config({ path: "./.env" });

    const dryRun = parseFlag("--dry-run");
    const verbose = parseFlag("--verbose");

    await connectDB();

    const legacyPendingFilter = {
        status: "pending",
        $or: [
            { initiator: { $exists: false } },
            { initiator: null },
            { expiresAt: { $exists: false } },
            { expiresAt: null },
        ],
    };

    const affectedCount = await Conversation.countDocuments(legacyPendingFilter);

    logger.log(`Legacy pending conversations detected: ${affectedCount}`);

    if (affectedCount === 0) {
        logger.log("No legacy conversation requests to heal.");
        await mongoose.connection.close();
        process.exit(0);
    }

    if (verbose || dryRun) {
        const sample = await Conversation.find(legacyPendingFilter)
            .select("_id status initiator expiresAt pendingMessageCount participants")
            .limit(20)
            .lean();

        logger.log("Sample affected conversations:");
        logger.log(JSON.stringify(sample, null, 2));
    }

    if (dryRun) {
        logger.log("Dry run complete. No updates were applied.");
        await mongoose.connection.close();
        process.exit(0);
    }

    const updateResult = await Conversation.updateMany(
        legacyPendingFilter,
        {
            $set: {
                status: "accepted",
                expiresAt: null,
                pendingMessageCount: 0,
            },
            $unset: {
                initiator: "",
            },
        }
    );

    logger.log(`Matched: ${updateResult.matchedCount}`);
    logger.log(`Modified: ${updateResult.modifiedCount}`);
    logger.log("Legacy request healing completed successfully.");

    await mongoose.connection.close();
    process.exit(0);
};

run().catch(async (error) => {
    logger.error("Failed to heal legacy conversation requests:", error?.message || error);

    if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close();
    }

    process.exit(1);
});
