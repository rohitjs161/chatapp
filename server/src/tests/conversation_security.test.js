import { jest, describe, beforeEach, test, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const loggerMock = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

await jest.unstable_mockModule('../utils/logger.js', () => ({ logger: loggerMock }));
await jest.unstable_mockModule('../socket/io.js', () => ({ emitToUserRoom: jest.fn(), getSocketServer: jest.fn() }));

const userModelMock = {
  User: {
    findById: jest.fn(),
  },
};

const conversationModelMock = {
  Conversation: {
    find: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    findByIdAndDelete: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    deleteMany: jest.fn(),
    updateOne: jest.fn(),
  },
};

const messageModelMock = {
  Message: {
    findById: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
};

await jest.unstable_mockModule('../models/user.model.js', () => userModelMock);
await jest.unstable_mockModule('../models/conversation.model.js', () => conversationModelMock);
await jest.unstable_mockModule('../models/message.model.js', () => messageModelMock);

const { verifyJWT } = await import('../middlewares/auth.middleware.js');
const { rejectSuspiciousRequestPayload } = await import('../middlewares/requestSecurity.middleware.js');
const { getUserConversations } = await import('../controllers/conversation.controller.js');
const { getMessages, getMessageMedia } = await import('../controllers/message.controller.js');
const { findParticipantConversation } = await import('../utils/conversationAccess.js');
const { User } = await import('../models/user.model.js');
const { Conversation } = await import('../models/conversation.model.js');

const buildConversationQuery = (rows, onFilter) => {
  const chain = {
    populate: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
  };

  return jest.fn((filter) => {
    if (typeof onFilter === 'function') {
      onFilter(filter);
    }

    return chain;
  });
};

const buildApp = () => {
  const app = express();
  app.use(express.json());

  app.post('/guard', rejectSuspiciousRequestPayload, (req, res) => {
    res.status(200).json({ success: true });
  });

  app.get('/api/v1/conversations', verifyJWT, getUserConversations);
  app.get('/api/v1/conversations/me', (req, res, next) => {
    req.user = { _id: '507f1f77bcf86cd799439011' };
    next();
  }, getUserConversations);
  app.get('/api/v1/messages/:conversationId', (req, res, next) => {
    req.user = { _id: req.headers['x-user-id'] || '507f1f77bcf86cd799439011' };
    next();
  }, getMessages);
  app.get('/api/v1/messages/:messageId/media', (req, res, next) => {
    req.user = { _id: req.headers['x-user-id'] || '507f1f77bcf86cd799439011' };
    next();
  }, getMessageMedia);

  app.use((err, req, res, next) => {
    const status = err?.statusCode || err?.status || 500;
    res.status(status).json({ success: false, message: err?.message || 'error' });
  });

  return app;
};

describe('conversation and message authorization', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();

    User.findById.mockResolvedValue({ _id: '507f1f77bcf86cd799439011' });
  });

  test('GET /conversation without JWT returns 401', async () => {
    const response = await request(app).get('/api/v1/conversations');

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Unauthorized request');
    expect(Conversation.find).not.toHaveBeenCalled();
  });

  test('GET /conversation returns only authorized conversations', async () => {
    const userId = '507f1f77bcf86cd799439011';
    const authorizedConversation = {
      _id: '507f1f77bcf86cd799439099',
      participants: [{ _id: userId }, { _id: '507f1f77bcf86cd799439012' }],
      unreadCounters: new Map([[userId, 0]]),
      mutedUsers: [],
      status: 'accepted',
      toObject() {
        return {
          _id: this._id,
          participants: this.participants,
          unreadCounters: this.unreadCounters,
          mutedUsers: this.mutedUsers,
          status: this.status,
        };
      },
    };

    Conversation.find.mockImplementation(buildConversationQuery([authorizedConversation], (filter) => {
      expect(filter).toEqual({ participants: userId });
    }));

    const response = await request(app).get('/api/v1/conversations/me');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(Conversation.find).toHaveBeenCalledTimes(1);
  });

  test('random conversation ID access is blocked with 403', async () => {
    Conversation.findOne.mockReturnValueOnce({
      select: jest.fn().mockResolvedValue(null),
    });

    const response = await request(app)
      .get('/api/v1/messages/507f1f77bcf86cd799439099')
      .set('x-user-id', '507f1f77bcf86cd799439011');

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('Unauthorized access');
  });

  test('invalid ObjectId is rejected before DB lookup', async () => {
    const response = await request(app)
      .get('/api/v1/messages/not-an-object-id')
      .set('x-user-id', '507f1f77bcf86cd799439011');

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Invalid Conversation ID');
    expect(Conversation.findOne).not.toHaveBeenCalled();
  });

  test('socket join helper rejects unrelated users', async () => {
    Conversation.findOne.mockReturnValueOnce({
      select: jest.fn().mockResolvedValue(null),
    });

    await expect(findParticipantConversation({
      conversationId: '507f1f77bcf86cd799439099',
      userId: '507f1f77bcf86cd799439012',
    })).rejects.toMatchObject({ statusCode: 403 });
  });

  test('NoSQL injection attempts are blocked', async () => {
    const response = await request(app)
      .post('/guard')
      .query({ 'q[$ne]': 'x' })
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Invalid request payload');
  });
});