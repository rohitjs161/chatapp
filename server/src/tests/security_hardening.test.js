import { jest, describe, beforeEach, test, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';

const loggerMock = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

await jest.unstable_mockModule('../utils/logger.js', () => ({ logger: loggerMock }));
await jest.unstable_mockModule('../utils/otp.js', () => ({
  generateOTP: jest.fn(() => '123456'),
  hashOTP: jest.fn((value) => `hashed-${value}`),
  compareOTP: jest.fn(() => true),
  sendEmailOTP: jest.fn(),
  sendEmailVerification: jest.fn(),
}));
await jest.unstable_mockModule('../utils/cloudinary.js', () => ({
  uploadOnCloudinary: jest.fn(),
  deleteFromCloudinary: jest.fn(),
  deleteFromCloudinaryByPublicId: jest.fn(),
}));
await jest.unstable_mockModule('../socket/io.js', () => ({ emitToUserRoom: jest.fn(), getSocketServer: jest.fn() }));

const userModelMock = {
  User: {
    findOne: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    find: jest.fn(),
  },
};

const pendingRegistrationMock = {
  PendingRegistration: {
    findOne: jest.fn(),
    findByIdAndDelete: jest.fn(),
    findOneAndUpdate: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
  },
};

const conversationModelMock = {
  Conversation: {
    findById: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  },
};

const messageModelMock = {
  Message: {
    findById: jest.fn(),
    find: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
  },
};

await jest.unstable_mockModule('../models/user.model.js', () => userModelMock);
await jest.unstable_mockModule('../models/pendingRegistration.model.js', () => pendingRegistrationMock);
await jest.unstable_mockModule('../models/conversation.model.js', () => conversationModelMock);
await jest.unstable_mockModule('../models/message.model.js', () => messageModelMock);

const { checkEmailExists, checkUsernameExists, refreshAccessToken, discoverUsers } = await import('../controllers/user.controller.js');
const { getMessages, sendMessage, editMessage, deleteMessage, getMessageMedia } = await import('../controllers/message.controller.js');
const { rejectSuspiciousRequestPayload } = await import('../middlewares/requestSecurity.middleware.js');
const { verifyJWT } = await import('../middlewares/auth.middleware.js');
const { reservePendingMessageSlot } = await import('../utils/requestReservation.js');
const { User } = await import('../models/user.model.js');
const { Conversation } = await import('../models/conversation.model.js');
const { Message } = await import('../models/message.model.js');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  app.post('/guard', rejectSuspiciousRequestPayload, (req, res) => {
    res.status(200).json({ success: true });
  });

  app.post('/check-email', checkEmailExists);
  app.post('/check-username', checkUsernameExists);
  app.post('/refresh-token', refreshAccessToken);
  app.get('/protected', verifyJWT, (req, res) => {
    res.status(200).json({ success: true });
  });
  app.get('/discover', (req, res, next) => {
    req.user = { _id: '507f1f77bcf86cd799439011' };
    next();
  }, discoverUsers);
  app.get('/messages/:conversationId', (req, res, next) => {
    req.user = { _id: '507f1f77bcf86cd799439011' };
    next();
  }, getMessages);

  const attachUserFromHeader = (req, res, next) => {
    req.user = { _id: String(req.headers['x-user-id'] || '') };
    next();
  };

  app.get('/media/:messageId', attachUserFromHeader, getMessageMedia);
  app.patch('/edit/:messageId', attachUserFromHeader, editMessage);
  app.delete('/delete/:messageId', attachUserFromHeader, deleteMessage);

  app.use((err, req, res, next) => {
    const status = err?.statusCode || err?.status || 500;
    res.status(status).json({ success: false, message: err?.message || 'error' });
  });

  return app;
};

describe('security hardening', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();

    const discoverRows = [
      {
        _id: 'user-2',
        fullName: 'Alice Example',
        username: 'alice',
        email: 'alice@example.com',
        profilePicture: null,
        bio: 'Hello',
        createdAt: new Date().toISOString(),
      },
    ];

    User.find.mockReturnValue({
      selectedFields: '',
      select(fields) { this.selectedFields = String(fields || ''); return this; },
      sort() { return this; },
      limit() { return this; },
      lean: jest.fn().mockImplementation(async function () {
        return discoverRows.map((row) => {
          const copy = { ...row };
          if (!this.selectedFields.includes('email')) {
            delete copy.email;
          }

          return copy;
        });
      }),
    });

    Conversation.findById.mockReturnValue({
      select() { return this; },
      participants: [{ _id: '507f1f77bcf86cd799439012' }],
    });
  });

  test('blocks NoSQL injection payloads before controllers run', async () => {
    const response = await request(app)
      .post('/guard')
      .send({ username: { $ne: null } });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Invalid request payload');
  });

  test('mongoSanitize removes operator keys from payloads', async () => {
    const payload = { profile: { $ne: 'admin' }, safe: 'ok' };

    mongoSanitize.sanitize(payload);

    expect(payload.safe).toBe('ok');
    expect(payload.profile?.$ne).toBeUndefined();
    expect(Object.keys(payload.profile || {})).toHaveLength(0);
  });

  test('blocks NoSQL injection via query parameters', async () => {
    const response = await request(app)
      .post('/guard')
      .query({ 'q[$ne]': 'x' })
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Invalid request payload');
  });

  test('refresh-token ignores body token and rejects missing cookie token', async () => {
    const response = await request(app)
      .post('/refresh-token')
      .send({ refreshToken: 'attacker-token' });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Unauthorized request');
    expect(User.findById).not.toHaveBeenCalled();
  });

  test('refresh-token ignores Authorization header and rejects without cookie', async () => {
    const response = await request(app)
      .post('/refresh-token')
      .set('Authorization', 'Bearer attacker-token')
      .send();

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Unauthorized request');
    expect(User.findById).not.toHaveBeenCalled();
  });

  test('protected routes reject direct access without auth', async () => {
    const response = await request(app).get('/protected');

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Unauthorized request');
  });

  test('availability checks do not disclose account existence', async () => {
    const [emailResponse, usernameResponse] = await Promise.all([
      request(app).post('/check-email').send({ email: 'someone@example.com' }),
      request(app).post('/check-username').send({ username: 'someone' }),
    ]);

    expect(emailResponse.status).toBe(200);
    expect(emailResponse.body.data).toEqual({ checked: true });
    expect(usernameResponse.status).toBe(200);
    expect(usernameResponse.body.data).toEqual({ checked: true });
  });

  test('discoverUsers omits email addresses from results', async () => {
    const response = await request(app).get('/discover?q=alice');

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({
      fullName: 'Alice Example',
      username: 'alice',
    });
    expect(response.body.data[0].email).toBeUndefined();
  });

  test('message fetch is denied for non-members', async () => {
    const response = await request(app).get('/messages/507f1f77bcf86cd799439099');

    expect(response.status).toBe(403);
    expect(Conversation.findById).toHaveBeenCalled();
  });

  test('media downloads are blocked before acceptance', async () => {
    Message.findById.mockReturnValueOnce({
      select: () => Promise.resolve({
        _id: '507f1f77bcf86cd799439021',
        conversation: '507f1f77bcf86cd799439099',
        mediaUrl: 'https://example.com/media.jpg',
        isDeleted: false,
      }),
    });

    Conversation.findById.mockReturnValueOnce({
      select() { return this; },
      participants: [{ _id: '507f1f77bcf86cd799439011' }, { _id: '507f1f77bcf86cd799439012' }],
      status: 'pending',
      initiator: '507f1f77bcf86cd799439011',
      expiresAt: new Date(Date.now() + 86400000),
      save: jest.fn(),
    });

    const response = await request(app)
      .get('/media/507f1f77bcf86cd799439021')
      .set('x-user-id', '507f1f77bcf86cd799439011');

    expect(response.status).toBe(403);
  });

  test('message edit is denied for non-owners', async () => {
    Message.findById.mockReturnValueOnce({
      _id: '507f1f77bcf86cd799439022',
      sender: { toString: () => '507f1f77bcf86cd799439012' },
      conversation: '507f1f77bcf86cd799439099',
      isDeleted: false,
      content: 'original',
      mediaUrl: null,
    });

    Conversation.findById.mockReturnValueOnce({
      select() { return this; },
      participants: [{ _id: '507f1f77bcf86cd799439011' }, { _id: '507f1f77bcf86cd799439012' }],
    });

    const response = await request(app)
      .patch('/edit/507f1f77bcf86cd799439022')
      .set('x-user-id', '507f1f77bcf86cd799439011')
      .send({ content: 'edited' });

    expect(response.status).toBe(403);
  });

  test('message delete is denied for non-owners', async () => {
    Message.findById.mockReturnValueOnce({
      _id: '507f1f77bcf86cd799439023',
      sender: { toString: () => '507f1f77bcf86cd799439012' },
      conversation: '507f1f77bcf86cd799439099',
      isDeleted: false,
      mediaUrl: null,
      save: jest.fn(),
    });

    Conversation.findById.mockReturnValueOnce({
      select() { return this; },
      participants: [{ _id: '507f1f77bcf86cd799439011' }, { _id: '507f1f77bcf86cd799439012' }],
    });

    const response = await request(app)
      .delete('/delete/507f1f77bcf86cd799439023')
      .set('x-user-id', '507f1f77bcf86cd799439011');

    expect(response.status).toBe(403);
  });

  test('pending request limits block the third message', async () => {
    const conversationId = '507f1f77bcf86cd799439099';
    const senderId = '507f1f77bcf86cd799439011';
    const pendingConversation = {
      _id: conversationId,
      participants: [{ _id: senderId }, { _id: '507f1f77bcf86cd799439012' }],
      status: 'pending',
      initiator: senderId,
      pendingMessageCount: 0,
      expiresAt: new Date(Date.now() + 86400000),
    };

    const conversationModel = {
      findOneAndUpdate: jest.fn()
        .mockResolvedValueOnce({ ...pendingConversation, pendingMessageCount: 1 })
        .mockResolvedValueOnce({ ...pendingConversation, pendingMessageCount: 2 })
        .mockResolvedValueOnce(null),
    };

    await expect(reservePendingMessageSlot(conversationId, senderId, conversationModel)).resolves.toBeTruthy();
    await expect(reservePendingMessageSlot(conversationId, senderId, conversationModel)).resolves.toBeTruthy();
    await expect(reservePendingMessageSlot(conversationId, senderId, conversationModel)).rejects.toMatchObject({ statusCode: 403 });
  });
});
