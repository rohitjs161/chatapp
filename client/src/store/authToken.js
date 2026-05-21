const readStoredAccessToken = () => {
    if (typeof localStorage === "undefined") {
        return null;
    }

    const token = localStorage.getItem("accessToken");
    return typeof token === "string" && token.trim() ? token.trim() : null;
};

let accessToken = readStoredAccessToken();

export const getAccessToken = () => accessToken;

export const setAccessToken = (token) => {
    accessToken = typeof token === "string" && token.trim() ? token.trim() : null;

    if (typeof localStorage !== "undefined") {
        if (accessToken) {
            localStorage.setItem("accessToken", accessToken);
        } else {
            localStorage.removeItem("accessToken");
        }
    }
};

export const clearAccessToken = () => {
    accessToken = null;

    if (typeof localStorage !== "undefined") {
        localStorage.removeItem("accessToken");
    }
};