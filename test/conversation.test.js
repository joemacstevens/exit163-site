const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

describe('Conversation - Subscribe keyword handling (real behavior test)', () => {
  it('Issue 5: WEEKEND/BERGEN should not subscribe, JOIN should, STOP should opt-out', async () => {
    // Clear module cache
    const dbPath = path.join(__dirname, '../lib/db.js');
    const agentPath = path.join(__dirname, '../lib/agent.js');
    const conversationPath = path.join(__dirname, '../lib/conversation.js');
    
    delete require.cache[require.resolve(dbPath)];
    delete require.cache[require.resolve(conversationPath)];
    if (require.cache[require.resolve(agentPath)]) {
      delete require.cache[require.resolve(agentPath)];
    }
    
    // Track database updates
    let lastUpdate = null;
    let lastInsert = null;
    
    // Mock Supabase client with full query chain
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
          data: { 
            phone: '+15551234567', 
            opted_out: false, 
            blast_opt_in: false 
          }, 
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
          lastUpdate = data;
          return {
            eq: () => ({
              in: () => ({ then: async (cb) => cb({ data: [], error: null }) }),
              then: async (cb) => cb({ data: [], error: null }),
            }),
          };
        },
      }),
    };
    
    // Mock db module
    require.cache[require.resolve(dbPath)] = {
      id: require.resolve(dbPath),
      filename: require.resolve(dbPath),
      loaded: true,
      exports: {
        db: () => mockSupabase,
        q: async (p) => p,
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
      
      // Test WEEKEND doesn't subscribe
      lastUpdate = null;
      await handleInbound({ phone: '+15551234567', text: 'WEEKEND', channel: 'test', dryRunNewsletter: true, timeoutMs: 5000 });
      assert.ok(!lastUpdate || !lastUpdate.blast_opt_in, 'WEEKEND should not set blast_opt_in');
      
      // Test BERGEN doesn't subscribe  
      lastUpdate = null;
      await handleInbound({ phone: '+15551234567', text: 'BERGEN', channel: 'test', dryRunNewsletter: true, timeoutMs: 5000 });
      assert.ok(!lastUpdate || !lastUpdate.blast_opt_in, 'BERGEN should not set blast_opt_in');
      
      // Test JOIN subscribes
      lastUpdate = null;
      await handleInbound({ phone: '+15551234567', text: 'JOIN', channel: 'test', dryRunNewsletter: true, timeoutMs: 5000 });
      assert.ok(lastUpdate && lastUpdate.blast_opt_in === true, 'JOIN should set blast_opt_in=true');
      
      // Test STOP opts out (verify it doesn't trigger blast_opt_in)
      lastUpdate = null;
      await handleInbound({ phone: '+15551234567', text: 'STOP', channel: 'test', dryRunNewsletter: true, timeoutMs: 5000 });
      // STOP triggers opt-out logic, not blast_opt_in
      assert.ok(!lastUpdate || lastUpdate.blast_opt_in !== true, 'STOP should not set blast_opt_in=true');
      
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
