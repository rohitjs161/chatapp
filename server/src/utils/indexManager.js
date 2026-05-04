/**
 * Database Index Management Utility
 * Fixes and rebuilds indexes to resolve duplicate key errors
 */

import { User } from '../models/user.model.js';
import { apiError } from './apiError.js';
import { logger } from "./logger.js";

/**
 * Get all indexes for the User collection
 */
export const getUserIndexes = async () => {
    try {
        const indexes = await User.collection.getIndexes();
        return indexes;
    } catch (error) {
        logger.error('❌ Error fetching indexes:', error.message);
        throw new apiError(500, 'Failed to fetch database indexes');
    }
};

/**
 * Drop a specific index by name
 */
export const dropIndex = async (indexName) => {
    try {
        logger.log(`🗑️  Dropping index: ${indexName}`);
        await User.collection.dropIndex(indexName);
        logger.log(`✅ Index dropped: ${indexName}`);
        return { success: true, message: `Index ${indexName} dropped successfully` };
    } catch (error) {
        if (error.message.includes('index not found')) {
            logger.log(`ℹ️  Index doesn't exist: ${indexName}`);
            return { success: true, message: `Index ${indexName} doesn't exist` };
        }
        logger.error(`❌ Error dropping index ${indexName}:`, error.message);
        throw new apiError(500, `Failed to drop index: ${error.message}`);
    }
};

/**
 * Drop all duplicate-related indexes to rebuild them
 */
export const rebuildUniqueIndexes = async () => {
    try {
        logger.log('\n📋 Starting index rebuild process...\n');
        
        // Get current indexes
        const indexes = await getUserIndexes();
        logger.log('Current indexes:', Object.keys(indexes));
        
        // Drop problematic indexes
        const indexesToDrop = [
            'uniq_email',
            'uniq_username',
            'uniq_googleId',
            'googleId_1',
            'email_1',
            'username_1'
        ];
        
        for (const indexName of indexesToDrop) {
            if (indexes[indexName]) {
                await dropIndex(indexName);
            }
        }
        
        // Rebuild the schema indexes (Mongoose will recreate them)
        logger.log('\n🔄 Rebuilding indexes from schema...\n');
        await User.collection.dropIndex('_id_').catch(() => {});  // Don't drop _id index
        
        // This will recreate all indexes defined in the schema
        await User.syncIndexes();
        
        logger.log('\n✅ Index rebuild complete!\n');
        
        // Verify new indexes
        const newIndexes = await getUserIndexes();
        logger.log('New indexes:', Object.keys(newIndexes));
        
        return {
            success: true,
            message: 'Indexes rebuilt successfully',
            indexes: newIndexes
        };
    } catch (error) {
        logger.error('\n❌ Error rebuilding indexes:', error.message);
        throw new apiError(500, `Failed to rebuild indexes: ${error.message}`);
    }
};

/**
 * Check for duplicate records in the database
 */
export const checkForDuplicates = async () => {
    try {
        logger.log('🔍 Checking for duplicate users...\n');
        
        // Get all users
        const users = await User.find().select('email username _id createdAt');
        
        // Check for duplicate emails
        const emailMap = new Map();
        const duplicateEmails = [];
        
        for (const user of users) {
            const email = user.email.toLowerCase();
            if (emailMap.has(email)) {
                duplicateEmails.push({
                    email,
                    userIds: [emailMap.get(email), user._id.toString()]
                });
            } else {
                emailMap.set(email, user._id.toString());
            }
        }
        
        // Check for duplicate usernames
        const usernameMap = new Map();
        const duplicateUsernames = [];
        
        for (const user of users) {
            const username = user.username.toLowerCase();
            if (usernameMap.has(username)) {
                duplicateUsernames.push({
                    username,
                    userIds: [usernameMap.get(username), user._id.toString()]
                });
            } else {
                usernameMap.set(username, user._id.toString());
            }
        }
        
        const result = {
            totalUsers: users.length,
            duplicateEmails: duplicateEmails.length > 0 ? duplicateEmails : 'None',
            duplicateUsernames: duplicateUsernames.length > 0 ? duplicateUsernames : 'None',
        };
        
        logger.log('Results:', result);
        return result;
    } catch (error) {
        logger.error('❌ Error checking for duplicates:', error.message);
        throw new apiError(500, `Failed to check for duplicates: ${error.message}`);
    }
};

/**
 * Remove duplicate users, keeping the oldest one
 */
export const removeDuplicates = async () => {
    try {
        logger.log('\n🗑️  Removing duplicate users...\n');
        
        const users = await User.find().sort({ createdAt: 1 });
        
        const emailMap = new Map();
        const usersToDelete = [];
        
        // Find duplicates
        for (const user of users) {
            const email = user.email.toLowerCase();
            if (emailMap.has(email)) {
                usersToDelete.push(user._id);
            } else {
                emailMap.set(email, user._id);
            }
        }
        
        if (usersToDelete.length > 0) {
            await User.deleteMany({ _id: { $in: usersToDelete } });
            logger.log(`✅ Deleted ${usersToDelete.length} duplicate users`);
        } else {
            logger.log('✅ No duplicate users found');
        }
        
        return {
            success: true,
            deletedCount: usersToDelete.length,
            message: `Removed ${usersToDelete.length} duplicate users`
        };
    } catch (error) {
        logger.error('❌ Error removing duplicates:', error.message);
        throw new apiError(500, `Failed to remove duplicates: ${error.message}`);
    }
};

/**
 * Full database cleanup and verification
 */
export const fullDatabaseCleanup = async () => {
    try {
        logger.log('\n\n╔════════════════════════════════════════╗');
        logger.log('║   FULL DATABASE CLEANUP & VERIFICATION  ║');
        logger.log('╚════════════════════════════════════════╝\n');
        
        // Step 1: Check for duplicates before cleanup
        logger.log('STEP 1: Checking for duplicates before cleanup...');
        const duplicatesBefore = await checkForDuplicates();
        
        // Step 2: Remove duplicates
        logger.log('\nSTEP 2: Removing duplicates...');
        const removeResult = await removeDuplicates();
        
        // Step 3: Rebuild indexes
        logger.log('\nSTEP 3: Rebuilding database indexes...');
        const indexResult = await rebuildUniqueIndexes();
        
        // Step 4: Verify no duplicates remain
        logger.log('\nSTEP 4: Verifying cleanup...');
        const duplicatesAfter = await checkForDuplicates();
        
        logger.log('\n\n╔════════════════════════════════════════╗');
        logger.log('║         CLEANUP COMPLETE!              ║');
        logger.log('╚════════════════════════════════════════╝\n');
        
        return {
            success: true,
            duplicatesBefore,
            duplicatesAfter,
            removeResult,
            indexResult
        };
    } catch (error) {
        logger.error('\n❌ Full cleanup failed:', error.message);
        throw error;
    }
};
