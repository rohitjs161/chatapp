class apiResponse{
    constructor(statusCode, data, message = 'Success', status = statusCode < 300 ? 'success' : 'error') {
        this.statusCode = statusCode;
        this.data = data;
        this.message = message;
        this.success = statusCode < 400;
        this.status = status;
    }
}

export { apiResponse };
