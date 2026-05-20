const readStoredAccessToken = () => {
    if (typeof sessionStorage === "undefined") {
        return null;
    }

    const token = sessionStorage.getItem("accessToken");
    return typeof token === "string" && token.trim() ? token.trim() : null;
};

let accessToken = readStoredAccessToken();

export const getAccessToken = () => accessToken;

export const setAccessToken = (token) => {
    accessToken = typeof token === "string" && token.trim() ? token.trim() : null;

    if (typeof sessionStorage !== "undefined") {
        if (accessToken) {
            sessionStorage.setItem("accessToken", accessToken);
        } else {
            sessionStorage.removeItem("accessToken");
        }
    }
};

export const clearAccessToken = () => {
    accessToken = null;

    if (typeof sessionStorage !== "undefined") {
        sessionStorage.removeItem("accessToken");
    }
};