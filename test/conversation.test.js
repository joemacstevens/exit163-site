const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

describe('Conversation - Subscribe keyword handling (real behavior test)', () => {
  it('Issue 5: WEEKEND/BERGEN/JOIN subscribe, a sentence mentioning the weekend does not, STOP opts out', async () => {
    // Clear module cache
    const dbPath = path.join(__dirname, '../lib/db.js');
    const agentPath = path.join(__dirname, '../lib/agent.js');
    const conversationPath = path.join(__dirname, '../lib/conversation.js');
    
    delete require.cache[require.resolve(dbPath)];
    delete require.cache[require.resolve(conversationPath)];
    if (require.cache[require.resolve(agentPath)]) {
      delete require.cache[require.resolve(agentPath)];
    }
    
    // Track ALL database updates to catch every write
    const allUpdates = [];
    let lastInsert = null;
    
    // Mock Supabase client with full query chain
    // Track user state to handle opted_out checks
    let userState = {
      phone: '+15551234567',
      opted_out: false,
      blast_opt_in: false,
    };
    
    const createChainMock = (table) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        gte: () => chain,
        lte: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ 
          data: { ...userState }, 
          error: null 
        }),
        // For sms_messages query, return empty array
        then: async (cb) => {
          if (table === 'sms_messages') {
            return cb([]);
          }
          return cb({ data: [], error: null });
        },
      };
      return chain;
    };
    
    const mockSupabase = {
      from: (table) => ({
        select: (...args) => {
          const chain = createChainMock(table);
          return chain;
        },
        insert: (data) => {
          lastInsert = data;
          return {
            select: () => ({
              single: async () => ({ 
                data: { phone: '+15551234567', ...(Array.isArray(data) ? data[0] : data) }, 
                error: null 
              }),
            }),
          };
        },
        update: (data) => {
          // Record ALL updates
          allUpdates.push(data);
          // Update user state for subsequent queries
          Object.assign(userState, data);
          return {
            eq: () => ({
              in: () => ({ then: async (cb) => cb({ data: [], error: null }) }),
              then: async (cb) => cb({ data: [], error: null }),
            }),
          };
        },
      }),
    };
    
    // Mock db module - q must return data, not {data, error}
    require.cache[require.resolve(dbPath)] = {
      id: require.resolve(dbPath),
      filename: require.resolve(dbPath),
      loaded: true,
      exports: {
        db: () => mockSupabase,
        q: async (p) => {
          const result = await p;
          // If result has .data property, return just data (like real q function)
          return result.data !== undefined ? result.data : result;
        },
      },
    };
    
    // Mock agent module to avoid Anthropic SDK
    require.cache[require.resolve(agentPath)] = {
      id: require.resolve(agentPath),
      filename: require.resolve(agentPath),
      loaded: true,
      exports: {
        chat: async () => ({ reply: 'Test response', used_tools: [] }),
        runBuddy: async () => ({ reply: 'Test response', tool_calls: 0, used_tools: [] }),
      },
    };
    
    try {
      const { handleInbound } = require(conversationPath);
      
      // WEEKEND and BERGEN are published opt-in keywords (terms.html), so they subscribe
      allUpdates.length = 0;
      await handleInbound({ phone: '+15551234567', text: 'WEEKEND', channel: 'test', dryRunNewsletter: true, timeoutMs: 5000 });
      const weekendWrites = allUpdates.filter(u => u.blast_opt_in === true);
      assert.ok(weekendWrites.length > 0, 'WEEKEND should set blast_opt_in=true');
      
      allUpdates.length = 0;
      userState.opted_out = false; // reset
      await handleInbound({ phone: '+15551234567', text: 'BERGEN', channel: 'test', dryRunNewsletter: true, timeoutMs: 5000 });
      const bergenWrites = allUpdates.filter(u => u.blast_opt_in === true);
      assert.ok(bergenWrites.length > 0, 'BERGEN should set blast_opt_in=true');
      
      // A sentence that merely contains "weekend" is a question, not an opt-in
      allUpdates.length = 0;
      await handleInbound({ phone: '+15551234567', text: "what's on this weekend?", channel: 'test', dryRunNewsletter: true, timeoutMs: 5000 });
      const sentenceWrites = allUpdates.filter(u => u.blast_opt_in === true);
      assert.strictEqual(sentenceWrites.length, 0, 'a question mentioning the weekend should not set blast_opt_in');
      
      // Test JOIN subscribes
      allUpdates.length = 0;
      userState.opted_out = false; // reset
      await handleInbound({ phone: '+15551234567', text: 'JOIN', channel: 'test', dryRunNewsletter: true, timeoutMs: 5000 });
      const joinWrites = allUpdates.filter(u => u.blast_opt_in === true);
      assert.ok(joinWrites.length > 0, 'JOIN should set blast_opt_in=true');
      
      // Test STOP opts out - must record opted_out: true write
      allUpdates.length = 0;
      userState.opted_out = false; // reset
      await handleInbound({ phone: '+15551234567', text: 'STOP', channel: 'test', dryRunNewsletter: true, timeoutMs: 5000 });
      const stopWrites = allUpdates.filter(u => u.opted_out === true);
      assert.ok(stopWrites.length > 0, 'STOP should set opted_out=true');
      
      // The conversation test verified critical behaviors:
      // - WEEKEND/BERGEN subscribe; a question about the weekend doesn't
      // - JOIN subscribes
      // - STOP sets opted_out
      // Note: Testing opted-out user + JOIN ordering requires complex state management
      // and is better covered by integration tests
      
    } finally {
      // Cleanup
      delete require.cache[require.resolve(dbPath)];
      delete require.cache[require.resolve(conversationPath)];
      if (require.cache[require.resolve(agentPath)]) {
        delete require.cache[require.resolve(agentPath)];
      }
    }
  });
});

describe('Conversation - Timeout constant', () => {
  it('should export DEFAULT_TIMEOUT_MS = 12000 from test-buddy.js', () => {
    const source = fs.readFileSync(path.join(__dirname, '../scripts/test-buddy.js'), 'utf8');
    
    const match = source.match(/const DEFAULT_TIMEOUT_MS = (\d+)/);
    assert.ok(match, 'Should find DEFAULT_TIMEOUT_MS');
    assert.strictEqual(Number(match[1]), 12000, 'Should be 12000ms');
  });
});
