import { MongoMemoryServer } from 'mongodb-memory-server';
import { spawn } from 'child_process';
import axios from 'axios';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';

const SERVER_START_TIMEOUT = 20000;
const HEALTH_URL = 'http://127.0.0.1:8000/api/v1/health';

const waitForServer = async (timeout = SERVER_START_TIMEOUT) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await axios.get(HEALTH_URL, { timeout: 2000 });
      if (res.status === 200) return true;
    } catch (e) {
      // wait
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};

const runTest = async () => {
  console.log('Starting in-memory MongoDB...');
  const mongod = await MongoMemoryServer.create();
  const mongoUri = mongod.getUri();

  console.log('Spawning server process...');
  const env = Object.assign({}, process.env, {
    MONGODB_URI: mongoUri,
    ACCESS_TOKEN_SECRET: 'testsecret',
    REFRESH_TOKEN_SECRET: 'refreshsecret',
    CORS_ORIGIN: 'http://localhost:3000',
    NODE_ENV: 'test',
    PORT: '8000',
  });

  const server = spawn(process.execPath, ['src/index.js'], {
    cwd: path.resolve(process.cwd()),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  server.stdout.on('data', (d) => process.stdout.write(`[server] ${d.toString()}`));
  server.stderr.on('data', (d) => process.stderr.write(`[server-err] ${d.toString()}`));

  const ok = await waitForServer();
  if (!ok) {
    console.error('Server did not start in time');
    server.kill();
    await mongod.stop();
    process.exit(1);
  }

  console.log('Server is up; connecting mongoose client to same in-memory DB...');
  await mongoose.connect(mongoUri, { dbName: 'test' });

  // Load models
  const { User } = await import('../models/user.model.js');
  const { Conversation } = await import('../models/conversation.model.js');

  console.log('Creating test users...');
  const alice = await User.create({ fullName: 'Alice', username: 'alice', email: 'alice@example.com', password: 'password' });
  const bob = await User.create({ fullName: 'Bob', username: 'bob', email: 'bob@example.com', password: 'password' });

  const aliceToken = jwt.sign({ _id: String(alice._id) }, env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });

  console.log('Creating pending conversation...');
  const conv = await Conversation.create({ participants: [alice._id, bob._id], status: 'pending', initiator: alice._id, pendingMessageCount: 0, expiresAt: new Date(Date.now() + 24*60*60*1000) });

  const url = `http://127.0.0.1:8000/api/v1/messages/${conv._id}`;

  const headers = { Authorization: `Bearer ${aliceToken}` };

  console.log('Sending 3 concurrent REST message requests as Alice (expect 2 success, 1 forbidden)...');

  const sendOne = async (i) => {
    try {
      const res = await axios.post(url, { content: `msg ${i}` }, { headers });
      return { status: res.status, data: res.data };
    } catch (err) {
      if (err.response) return { status: err.response.status, data: err.response.data };
      return { status: 0, error: err.message };
    }
  };

  const promises = [sendOne(1), sendOne(2), sendOne(3)];
  const results = await Promise.all(promises);

  console.log('Results:');
  results.forEach((r, idx) => console.log(idx + 1, r.status, r.data?.message || r.error || JSON.stringify(r.data)));

  const successCount = results.filter(r => r.status === 201).length;
  const forbiddenCount = results.filter(r => r.status === 403).length;

  console.log(`successCount=${successCount} forbiddenCount=${forbiddenCount}`);

  // Clean up
  await mongoose.disconnect();
  server.kill();
  await mongod.stop();

  if (successCount >= 2 && forbiddenCount >= 1) {
    console.log('TEST PASSED: Reservation enforced correctly');
    process.exit(0);
  }

  console.error('TEST FAILED');
  process.exit(2);
};

runTest().catch((err) => {
  console.error('Test script error', err);
  process.exit(1);
});
