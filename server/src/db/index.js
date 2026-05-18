import mongoose from 'mongoose';
import { DB_NAME } from '../constants.js';
import { logger } from "../utils/logger.js";

const connectDB = async () => {
  try {
    await mongoose.connect(`${process.env.MONGODB_URI}/${DB_NAME}`);
    logger.log("MongoDB connected successfully");
  } catch (error) {
    logger.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
