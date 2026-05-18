import { User } from "../models/user.model.js";
import { apiError } from "../utils/apiError.js";
import jwt from "jsonwebtoken"
import { asyncHandler } from "../utils/asyncHandler.js";
import { SAFE_USER_SELECT } from "../utils/safeUser.js";


export const verifyJWT = asyncHandler(async (req, _, next) => {
  try {
    const authorizationHeader = req.header("Authorization");
    const bearerToken = typeof authorizationHeader === "string"
      ? authorizationHeader.replace(/^Bearer\s+/i, "").trim()
      : "";

    const token = req.cookies?.accessToken || bearerToken;
    if (!token) {
      throw new apiError(401, "Unauthorized request");
    }
  
    const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
  
    const user = await User.findById(decodedToken?._id).select(SAFE_USER_SELECT);
    if (!user) {
      throw new apiError(404, "Invalid access token");
    }
    
    req.user = user;
    next();
  } catch (error) {
    throw new apiError(401, "Unauthorized request");
  }
});
