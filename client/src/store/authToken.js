let accessToken = null;

export const getAccessToken = () => accessToken;

export const setAccessToken = (token) => {
    accessToken = typeof token === "string" && token.trim() ? token.trim() : null;
};

export const clearAccessToken = () => {
    accessToken = null;
};