class apiError extends Error {
    constructor(
        statusCode,
        message = 'An error occurred',
        errors= [],
        stack = "",
        status = statusCode === 429 ? 'rate_limited' : 'error'
        ) {
        super(message)

        this.statusCode = statusCode;
        this.data = null;
        this.message = message;
        this.success = false;
        this.errors = errors;
        this.status = status;

        if (stack) {
            this.stack = stack;
        }else {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

export {apiError};
