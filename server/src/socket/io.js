let ioInstance = null;

export const setSocketServer = (io) => {
    ioInstance = io;
};

export const getSocketServer = () => ioInstance;

export const emitToUserRoom = (userId, event, payload) => {
    if (!ioInstance || !userId) return;

    ioInstance.to(`user:${userId}`).emit(event, payload);
};
