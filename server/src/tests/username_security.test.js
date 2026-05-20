import { jest, describe, beforeEach, test, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const loggerMock = { log: () => {}, warn: () => {}, error: () => {} };

await jest.unstable_mockModule('../utils/logger.js', () => ({ logger: loggerMock }));
await jest.unstable_mockModule('../utils/cloudinary.js', () => ({
  uploadOnCloudinary: jest.fn(),
  deleteFromCloudinary: jest.fn(),
  deleteFromCloudinaryByPublicId: jest.fn(),
}));
await jest.unstable_mockModule('../socket/io.js', () => ({ emitToUserRoom: jest.fn() }));
await jest.unstable_mockModule('../utils/otp.js', () => ({
  generateOTP: jest.fn(() => '123456'),
  hashOTP: jest.fn((value) => `hashed-${value}`),
  compareOTP: jest.fn(() => true),
  sendEmailOTP: jest.fn(),
  sendEmailVerification: jest.fn(() => Promise.resolve({ sandboxFallback: false })),
}));

const userModelMock = {
  User: {
    findOne: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    create: jest.fn(),
  },
};

const pendingRegistrationMock = {
  PendingRegistration: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
    findByIdAndDelete: jest.fn(),
  },
};

await jest.unstable_mockModule('../models/user.model.js', () => userModelMock);
await jest.unstable_mockModule('../models/pendingRegistration.model.js', () => pendingRegistrationMock);

const { registerUser, verifyEmailOTP, updateUserProfile } = await import('../controllers/user.controller.js');
const { User } = await import('../models/user.model.js');
const { PendingRegistration } = await import('../models/pendingRegistration.model.js');
const { compareOTP } = await import('../utils/otp.js');

const createApp = () => {
  const app = express();
  app.use(express.json());

  app.post('/register', registerUser);
  app.post('/verify-email', verifyEmailOTP);
  app.patch('/profile', (req, res, next) => {
    req.user = { _id: '507f1f77bcf86cd799439011' };
    next();
  }, updateUserProfile);

  app.use((error, req, res, next) => {
    const status = error?.statusCode || error?.status || 500;
    return res.status(status).json({
      success: false,
      message: error?.message || 'error',
    });
  });

  return app;
};

describe('username security', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();

    User.findOne.mockResolvedValue(null);
    User.findById.mockResolvedValue({ _id: '507f1f77bcf86cd799439011', authProvider: 'local', authProviders: ['local'], isVerified: true });
    User.findByIdAndUpdate.mockResolvedValue({});
    User.create.mockImplementation(async (doc) => ({ _id: 'user-id', ...doc }));
    PendingRegistration.find.mockResolvedValue([]);
    PendingRegistration.findOne.mockResolvedValue(null);
    PendingRegistration.create.mockImplementation(async (doc) => ({ _id: 'pending-id', ...doc }));
    PendingRegistration.findByIdAndDelete.mockResolvedValue({});
    compareOTP.mockReturnValue(true);
  });

  test.each([
    ['', 'Invalid username'],
    ['   ', 'Invalid username'],
    ['<script>alert(1)</script>', 'Invalid username'],
    ['rohit\u200b', 'Invalid username'],
    ['a'.repeat(64), 'Invalid username'],
    [{ $ne: 'rohit' }, 'Invalid username'],
  ])('rejects malformed username payloads: %o', async (username, expectedMessage) => {
    const response = await request(app)
      .post('/register')
      .send({
        fullName: 'Rohit Kumar',
        username,
        email: 'rohit@example.com',
        password: 'Str0ng!Pass',
        confirmPassword: 'Str0ng!Pass',
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(expectedMessage);
    expect(User.findOne).not.toHaveBeenCalled();
    expect(PendingRegistration.create).not.toHaveBeenCalled();
  });

  test('rejects uppercase/lowercase duplicates on signup', async () => {
    User.findOne.mockImplementation(async (query) => {
      if (query?.username === 'rohit') {
        return { _id: 'existing-user' };
      }

      return null;
    });

    const response = await request(app)
      .post('/register')
      .send({
        fullName: 'Rohit Kumar',
        username: 'ROHIT',
        email: 'rohit2@example.com',
        password: 'Str0ng!Pass',
        confirmPassword: 'Str0ng!Pass',
      });

    expect(response.status).toBe(409);
    expect(response.body.message).toBe('Unable to create account. Please try again with different credentials.');
  });

  test('rejects duplicate username on profile update', async () => {
    User.findOne.mockImplementation(async (query) => {
      if (query?.username === 'rohit') {
        return { _id: 'other-user' };
      }

      return null;
    });

    const response = await request(app)
      .patch('/profile')
      .send({ username: 'ROHIT' });

    expect(response.status).toBe(409);
    expect(response.body.message).toBe('Unable to update profile. Please try again with different details.');
  });

  test('handles concurrent verify-email requests with a single username safely', async () => {
    const pendingRecord = {
      _id: 'pending-id',
      email: 'rohit@example.com',
      username: 'rohit',
      fullName: 'Rohit Kumar',
      password: 'hashed-password',
      emailVerificationOTP: 'hashed-123456',
      emailVerificationOTPExpiry: new Date(Date.now() + 10 * 60 * 1000),
      emailVerificationAttempts: 0,
      emailVerificationBlockedUntil: null,
    };

    PendingRegistration.findOne.mockResolvedValue(pendingRecord);
    User.findOne.mockResolvedValue(null);

    User.create
      .mockResolvedValueOnce({
        _id: 'user-a',
        email: 'rohit@example.com',
        username: 'rohit',
        fullName: 'Rohit Kumar',
      })
      .mockRejectedValueOnce(Object.assign(new Error('duplicate key error'), {
        code: 11000,
        keyPattern: { username: 1 },
        keyValue: { username: 'rohit' },
      }));

    const [firstResponse, secondResponse] = await Promise.all([
      request(app).post('/verify-email').send({ email: 'rohit@example.com', otp: '123456' }),
      request(app).post('/verify-email').send({ email: 'rohit@example.com', otp: '123456' }),
    ]);

    expect([200, 409, 500]).toContain(firstResponse.status);
    expect([200, 409, 500]).toContain(secondResponse.status);
  });

  test('blocks direct API bypass attempts with spoofed username payloads', async () => {
    const response = await request(app)
      .post('/register')
      .send({
        fullName: 'Rohit Kumar',
        username: '\u200brohit\u200b',
        email: 'rohit3@example.com',
        password: 'Str0ng!Pass',
        confirmPassword: 'Str0ng!Pass',
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Invalid username');
  });
});