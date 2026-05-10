#!/usr/bin/env node

/**
 * Email Configuration Diagnostic Script
 * 
 * Run this to test if your email service is properly configured:
 * node src/scripts/testEmailConfig.js
 * 
 * This will:
 * 1. Check if email configuration exists
 * 2. Create SMTP transporter
 * 3. Verify SMTP connection and authentication
 * 4. Send a test email to your configured email address
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file
const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

import { testEmailConfiguration } from '../utils/otp.js';

const runTest = async () => {
    const success = await testEmailConfiguration();
    process.exit(success ? 0 : 1);
};

runTest();
