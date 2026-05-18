import { reservePendingMessageSlot } from '../utils/requestReservation.js';
import { apiError } from '../utils/apiError.js';

// Simple in-memory mock ConversationModel
const createMockConversationModel = ({ pendingMessageCount = 0, status = 'pending', initiator = null } = {}) => {
  const state = { pendingMessageCount, status, initiator };

  return {
    // Simulate atomic findOneAndUpdate
    async findOneAndUpdate(filter, update, opts) {
      // Debug logs removed for unit-test clarity
      // Check only the pendingMessageCount limit (simulate DB conditional increment)
      if (state.status !== 'pending') return null;
      const limitBranch = Array.isArray(filter.$and)
        ? filter.$and.find((branch) => Array.isArray(branch.$or) && branch.$or.some((f) => f.pendingMessageCount))
        : null;
      const ltObj = limitBranch?.$or?.find((f) => f.pendingMessageCount && (f.pendingMessageCount.$lt || f.pendingMessageCount.$exists !== undefined));
      const lt = ltObj && ltObj.pendingMessageCount && ltObj.pendingMessageCount.$lt;
      if (typeof lt === 'number' && state.pendingMessageCount >= lt) return null;

      // Perform update atomically (synchronous update)
      state.pendingMessageCount = (state.pendingMessageCount || 0) + (update.$inc?.pendingMessageCount || 0);
      if (update.$set) {
        state.initiator = update.$set.initiator || state.initiator;
        state.expiresAt = update.$set.expiresAt || state.expiresAt;
        state.status = update.$set.status || state.status;
      }
      // state updated
      return { ...state };
    },
  };
};

const run = async () => {
  const mock = createMockConversationModel({ pendingMessageCount: 0, status: 'pending', initiator: null });

  const sender = 'userA';
  const calls = [1,2,3].map(i => reservePendingMessageSlot('conv1', sender, mock));

  const results = await Promise.allSettled(calls);

  const fulfilled = results.filter(r => r.status === 'fulfilled').length;
  const rejected = results.filter(r => r.status === 'rejected').length;

  console.log('fulfilled', fulfilled, 'rejected', rejected);

  if (fulfilled === 2 && rejected === 1) {
    console.log('UNIT TEST PASSED');
    process.exit(0);
  }

  console.error('UNIT TEST FAILED', results);
  process.exit(2);
};

run().catch((err) => {
  console.error('Test error', err);
  process.exit(1);
});
