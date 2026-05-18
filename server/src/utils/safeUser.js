const SAFE_USER_FIELDS = [
    "_id",
    "id",
    "fullName",
    "username",
    "email",
    "bio",
    "profilePicture",
    "authProvider",
    "authProviders",
    "isVerified",
    "pendingEmail",
    "pendingFullName",
    "pendingUsername",
    "pendingBio",
    "emailOtpResendAvailableAt",
    "notificationPreferences",
    "createdAt",
    "updatedAt",
];

const SAFE_USER_SELECT = SAFE_USER_FIELDS.filter((field) => field !== "id").join(" ");

const toSafeUserResponse = (user) => {
    if (!user || typeof user !== "object") {
        return null;
    }

    const source = typeof user.toObject === "function" ? user.toObject() : user;
    const safeUser = {};

    for (const field of SAFE_USER_FIELDS) {
        if (source[field] !== undefined) {
            safeUser[field] = source[field];
        }
    }

    return safeUser;
};

export { SAFE_USER_SELECT, toSafeUserResponse };