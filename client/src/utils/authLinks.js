export const getGoogleAuthUrl = () => {
    const backendUrl = import.meta.env.VITE_API_URL;

    const baseBackendUrl = backendUrl
        ? backendUrl.replace(/\/api\/v1\/?$/, "")
        : (typeof window !== "undefined" ? window.location.origin : "");

    return `${baseBackendUrl}/api/v1/user/auth/google`;
};