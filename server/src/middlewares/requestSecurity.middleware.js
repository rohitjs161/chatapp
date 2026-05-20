import { apiError } from "../utils/apiError.js";

const isPlainObject = (value) => Object.prototype.toString.call(value) === "[object Object]";

const hasSuspiciousMongoOperators = (value) => {
    if (value === null || value === undefined) {
        return false;
    }

    if (Array.isArray(value)) {
        return value.some((item) => hasSuspiciousMongoOperators(item));
    }

    if (!isPlainObject(value)) {
        return false;
    }

    for (const [key, nestedValue] of Object.entries(value)) {
        // Detect Mongo operator patterns in keys, including bracket notation like `q[$ne]`
        if (/\[\s*\$[^\]]+\]/.test(key) || key.startsWith("$") || key.includes(".")) {
            return true;
        }

        if (hasSuspiciousMongoOperators(nestedValue)) {
            return true;
        }
    }

    return false;
};

export const rejectSuspiciousRequestPayload = (req, res, next) => {
    const suspicious = [req.body, req.query, req.params].some((value) => hasSuspiciousMongoOperators(value));

    if (suspicious) {
        return next(new apiError(400, "Invalid request payload"));
    }

    return next();
};
