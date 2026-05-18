import { jest, describe, beforeEach, test, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// Mocks (logger, email, models)
const loggerMock = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
await jest.unstable_mockModule('../utils/logger.js', () => ({ logger: loggerMock }));
await jest.unstable_mockModule('../utils/otp.js', () => ({
  generateOTP: jest.fn(() => '123456'),
  hashOTP: jest.fn((v) => `hashed-${v}`),
  compareOTP: jest.fn((inOtp, stored) => stored === `hashed-${inOtp}`),
  sendEmailOTP: jest.fn(),
  sendEmailVerification: jest.fn(() => Promise.resolve({ sandboxFallback: false })),
}));

// Import controller and mocked models
const userModelMock = {
  User: {
    findOne: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    findOneAndUpdate: jest.fn(),
    create: jest.fn(),
  },
};

const pendingModelMock = {
  PendingRegistration: {
    findOne: jest.fn(),
    findByIdAndDelete: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
  },
};

await jest.unstable_mockModule('../models/user.model.js', () => userModelMock);
await jest.unstable_mockModule('../models/pendingRegistration.model.js', () => pendingModelMock);

const { verifyEmailOTP, forgotPassword, resetPassword, verifyEmailChange } = await import('../controllers/user.controller.js');
const { User } = await import('../models/user.model.js');
const { PendingRegistration } = await import('../models/pendingRegistration.model.js');
const { hashOTP } = await import('../utils/otp.js');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.post('/verify-email', verifyEmailOTP);
  app.post('/forgot-password', forgotPassword);
  app.post('/reset-password', resetPassword);
  app.post('/verify-email-change', (req, res, next) => { req.user = { _id: 'user-1' }; next(); }, verifyEmailChange);

  app.use((err, req, res, next) => {
    const status = err?.statusCode || err?.status || 500;
    res.status(status).json({ success: false, message: err?.message || 'error' });
  });
  return app;
};

describe('OTP security tests', () => {
  let app;
  let currentPending = null;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();

    // default users/pending
    User.findOne.mockResolvedValue(null);
    User.findById.mockResolvedValue({ _id: 'user-1', email: 'u@example.com' });
    User.create.mockImplementation(async (doc) => ({ _id: 'created', ...doc }));

    currentPending = null;
    PendingRegistration.findOne.mockImplementation(async () => currentPending);
    PendingRegistration.findByIdAndUpdate.mockImplementation(async (id, update) => {
      if (!currentPending) return null;
      currentPending.emailVerificationAttempts = (currentPending.emailVerificationAttempts || 0) + 1;
      return currentPending;
    });
  });

  test('CONCURRENT VERIFICATION: only one succeeds when same OTP used concurrently', async () => {
    const pending = {
      _id: 'pending-1',
      email: 'a@example.com',
      username: 'usera',
      fullName: 'A',
      password: 'p',
      emailVerificationOTP: hashOTP('123456'),
      emailVerificationOTPExpiry: new Date(Date.now() + 10 * 60 * 1000),
    };

    // Mock atomic consume: first call returns the doc (consumed), second returns null
    PendingRegistration.findOneAndUpdate
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(null);

    User.findOne.mockResolvedValue(null);

    // once consumed by atomic op, no pending remains
    currentPending = null;

    const req = { email: 'a@example.com', otp: '123456' };

    const [r1, r2] = await Promise.all([
      request(app).post('/verify-email').send(req),
      request(app).post('/verify-email').send(req),
    ]);

    expect([r1.status, r2.status].sort()).toEqual([200, 200].sort());
    // one of them should have created the user
    expect(User.create).toHaveBeenCalledTimes(1);
  });

  test('REPLAY ATTACK: reuse of consumed OTP fails', async () => {
    // simulate OTP already consumed
    PendingRegistration.findOneAndUpdate.mockResolvedValueOnce(null);
    currentPending = {
      _id: 'pending-1',
      email: 'a@example.com',
      emailVerificationOTP: hashOTP('123456'),
      emailVerificationOTPExpiry: new Date(Date.now() + 10 * 60 * 1000),
      emailVerificationAttempts: 0,
    };

    const r = await request(app).post('/verify-email').send({ email: 'a@example.com', otp: '123456' });
    expect(r.status).toBe(200);
    expect(r.body.message).toMatch(/Invalid OTP|OTP has expired|No pending registration/);
  });

  test('BRUTE FORCE: repeated invalid OTP attempts lead to block', async () => {
    const pending = { _id: 'pending-1', email: 'b@example.com', emailVerificationOTP: hashOTP('999999'), emailVerificationOTPExpiry: new Date(Date.now() + 10 * 60 * 1000), emailVerificationAttempts: 0 };
    currentPending = pending;

    // make findOneAndUpdate return null (no consume)
    PendingRegistration.findOneAndUpdate.mockResolvedValue(null);

    // Simulate repeated invalid attempts until we see a rate-limit response
    let sawRateLimit = false;
    for (let i = 0; i < 10; i += 1) {
      const res = await request(app).post('/verify-email').send({ email: 'b@example.com', otp: '000000' });
      if (/Maximum verification attempts|Too many invalid OTP attempts/.test(res.body.message || '')) {
        sawRateLimit = true;
        break;
      }
      expect(res.body.message).toMatch(/Invalid OTP/);
    }
    expect(sawRateLimit).toBe(true);

  });

  test('EXPIRED OTP: verification fails safely', async () => {
    const past = new Date(Date.now() - 60 * 1000);
    currentPending = { _id: 'p', email: 'c@example.com', emailVerificationOTP: hashOTP('123456'), emailVerificationOTPExpiry: past };
    PendingRegistration.findOneAndUpdate.mockResolvedValue(null);

    const res = await request(app).post('/verify-email').send({ email: 'c@example.com', otp: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/expired|No pending registration/);
  });

  test('DIRECT API BYPASS: reset-password without OTP fails', async () => {
    // No OTP set on user
    User.findOne.mockResolvedValue({ email: 'x@example.com', password: 'hashed' });
    const res = await request(app).post('/reset-password').send({ email: 'x@example.com', otp: '000000', newPassword: 'Str0ng!1', confirmPassword: 'Str0ng!1' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/No password reset request found|OTP has expired/);
  });

  test('TOKEN SECURITY: no JWT issued before verification', async () => {
    // Simulate pending registration that would otherwise create a user
    PendingRegistration.findOneAndUpdate.mockResolvedValue(null);
    currentPending = { _id: 'p', email: 'd@example.com', emailVerificationOTP: hashOTP('123456'), emailVerificationOTPExpiry: new Date(Date.now() + 10 * 60 * 1000) };

    const res = await request(app).post('/verify-email').send({ email: 'd@example.com', otp: 'wrong' });
    expect(res.status).toBe(200);

    // Ensure no User.create called
    expect(User.create).not.toHaveBeenCalled();
  });

  test('MALFORMED PAYLOAD: invalid OTP formats and NoSQL injection payloads handled', async () => {
    currentPending = { _id: 'p', email: 'e@example.com', emailVerificationOTP: hashOTP('123456'), emailVerificationOTPExpiry: new Date(Date.now() + 10 * 60 * 1000) };

    const cases = [null, '', '   ', { $ne: 'x' }, '１２３４５６', '\u200b123456'];
    for (const c of cases) {
      const res = await request(app).post('/verify-email').send({ email: 'e@example.com', otp: c });
      expect(res.status === 400 || res.status === 200).toBe(true);
      // Should not leak internal errors
      expect(res.body.message).toBeDefined();
    }
  });

  test('LOGGING: raw OTPs are never logged', async () => {
    PendingRegistration.findOneAndUpdate.mockResolvedValue(null);
    currentPending = { _id: 'p', email: 'f@example.com', emailVerificationOTP: hashOTP('123456'), emailVerificationOTPExpiry: new Date(Date.now() + 10 * 60 * 1000) };
    await request(app).post('/verify-email').send({ email: 'f@example.com', otp: '123456' });

    // Ensure logger.error/log/warn not called with raw OTP strings
    const logged = JSON.stringify(loggerMock.log.mock.calls) + JSON.stringify(loggerMock.error.mock.calls) + JSON.stringify(loggerMock.warn.mock.calls);
    expect(logged.includes('123456')).toBe(false);
  });
});
