import axiosInstance from "./axios.js";

export const registerUser = async (data) => {
    const response = await axiosInstance.post("/user/register", data);
    return response.data;
};

export const loginUser = async (data) => {
    const response = await axiosInstance.post("/user/login", data);
    return response.data;
};

export const logoutUser = async () => {
    const response = await axiosInstance.post("/user/logout");
    return response.data;
};

export const refreshSession = async () => {
    // Refresh token is stored in an HTTP-only cookie by the backend.
    // Do not send the refresh token in the request body — call with an empty body
    // so the browser will include the cookie when `withCredentials` is enabled.
    const response = await axiosInstance.post("/user/refresh-token", {});
    return response.data;
};

export const getCurrentUser = async () => {
    const response = await axiosInstance.get("/user/me");
    return response.data;
};

export const updateProfile = async (data) => {
    const response = await axiosInstance.patch("/user/update-profile", data);
    return response.data;
};

export const updateProfilePicture = async (file) => {
    const formData = new FormData();
    formData.append("profilePicture", file);

    const response = await axiosInstance.patch("/user/profile-picture", formData, {
        headers: { "Content-Type": "multipart/form-data" },
    });
    return response.data;
};

export const deleteAccount = async (data = {}) => {
    const response = await axiosInstance.delete("/user/delete-account", {
        data,
    });
    return response.data;
};

export const forgotPassword = async (email) => {
    const response = await axiosInstance.post("/user/forgot-password", { email });
    return response.data;
};

export const resetPassword = async (data) => {
    const response = await axiosInstance.post("/user/reset-password", data);
    return response.data;
};

export const checkEmailExists = async (email) => {
    const response = await axiosInstance.post("/user/check-email", { email });
    return response.data;
};

export const checkUsernameExists = async (username) => {
    const response = await axiosInstance.post("/user/check-username", { username });
    return response.data;
};

export const resendOTP = async (email) => {
    const response = await axiosInstance.post("/user/resend-otp", { email });
    return response.data;
};

export const resendSignupOTP = async (email) => {
    const response = await axiosInstance.post("/user/resend-signup-otp", { email });
    return response.data;
};

export const resendForgotPasswordOTP = async (email) => {
    const response = await axiosInstance.post("/user/resend-forgot-password-otp", { email });
    return response.data;
};

export const verifyEmailOTP = async (email, otp) => {
    const response = await axiosInstance.post("/user/verify-email", { email, otp });
    return response.data;
};

export const verifyEmailChange = async (otp) => {
    const response = await axiosInstance.post('/user/verify-email-change', { otp });
    return response.data;
};

export const resendEmailChange = async () => {
    const response = await axiosInstance.post('/user/resend-email-change');
    return response.data;
};