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

// Shared fake Supabase + agent for the retest fixes below. Records every update and insert by table;
// runBuddy is replaced so no real LLM is ever called.
function loadWithFakes({ user = {}, onTurn } = {}) {
  const dbPath = require.resolve('../lib/db.js');
  const agentPath = require.resolve('../lib/agent.js');
  const conversationPath = require.resolve('../lib/conversation.js');
  const memoryPath = require.resolve('../lib/memory.js');
  for (const p of [dbPath, agentPath, conversationPath, memoryPath]) delete require.cache[p];

  const state = { phone: '+15550001111', opted_out: false, blast_opt_in: false, ...user };
  const updates = [];
  const inserts = [];
  const result = (data) => ({ then: (ok, bad) => Promise.resolve({ data, error: null }).then(ok, bad) });
  const chain = (table) => {
    const c = {
      select: () => c, eq: () => c, gt: () => c, gte: () => c, lte: () => c, in: () => c,
      order: () => c, limit: () => c,
      maybeSingle: async () => ({ data: table === 'sms_users' ? { ...state } : null, error: null }),
      single: async () => ({ data: { ...state }, error: null }),
      then: (ok, bad) => Promise.resolve({ data: [], error: null }).then(ok, bad),
    };
    return c;
  };
  const fake = {
    from: (table) => ({
      select: () => chain(table),
      insert: (data) => {
        inserts.push({ table, data });
        const rows = (Array.isArray(data) ? data : [data]).map((d, i) => ({ id: 100 + inserts.length + i, created_at: new Date().toISOString(), ...d }));
        return { ...result(rows), select: () => ({ ...result(rows), single: async () => ({ data: rows[0], error: null }) }) };
      },
      update: (data) => {
        updates.push({ table, data });
        Object.assign(state, data);
        const r = { ...result([]), eq: () => r, in: () => r, select: () => r };
        return r;
      },
      delete: () => { const r = { ...result([]), eq: () => r, in: () => r, select: () => r }; return r; },
    }),
  };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true,
    exports: { db: () => fake, q: async (p) => { const r = await p; return r && r.data !== undefined ? r.data : r; } } };
  require.cache[agentPath] = { id: agentPath, filename: agentPath, loaded: true,
    exports: { runBuddy: async (opts) => { if (onTurn) await onTurn(opts); return { reply: 'Test response', tool_calls: 0, used_tools: [] }; } } };
  const { handleInbound } = require(conversationPath);
  const send = (text) => handleInbound({ phone: state.phone, text, channel: 'test', dryRunNewsletter: true, timeoutMs: 5000 });
  const cleanup = () => { for (const p of [dbPath, agentPath, conversationPath, memoryPath]) delete require.cache[p]; };
  return { send, state, updates, inserts, cleanup };
}

describe('Conversation - opt-in keywords asked as a question', () => {
  it('"weekend?", "Bergen?" and "join?" go to the chat instead of subscribing', async () => {
    for (const text of ['weekend?', 'Bergen?', 'join?', 'WEEKEND ?']) {
      let chatted = false;
      const f = loadWithFakes({ onTurn: () => { chatted = true; } });
      try {
        const out = await f.send(text);
        assert.strictEqual(f.updates.filter((u) => u.data.blast_opt_in === true).length, 0, `${text} should not subscribe`);
        assert.notStrictEqual(out.reply && out.reply.startsWith("You're in!"), true, `${text} should not get the JOIN reply`);
        assert.ok(chatted, `${text} should reach the chat agent`);
      } finally { f.cleanup(); }
    }
  });

  it('"WEEKEND", "Weekend!", "join." and "Subscribe" still subscribe', async () => {
    for (const text of ['WEEKEND', 'Weekend!', 'join.', 'Subscribe', 'BERGEN']) {
      const f = loadWithFakes({ onTurn: () => assert.fail(`${text} should not reach the chat agent`) });
      try {
        const out = await f.send(text);
        assert.ok(f.updates.some((u) => u.data.blast_opt_in === true), `${text} should subscribe`);
        assert.ok(out.reply.startsWith("You're in!"), `${text} should get the JOIN reply`);
      } finally { f.cleanup(); }
    }
  });

  it('carrier STOP words opt out even with punctuation, including "stop?"', async () => {
    for (const text of ['stop?', 'STOP.', 'Stop!', 'unsubscribe?']) {
      const f = loadWithFakes({ user: { blast_opt_in: true } });
      try {
        const out = await f.send(text);
        assert.ok(f.updates.some((u) => u.data.opted_out === true), `${text} should opt out`);
        assert.strictEqual(out.reply, null);
      } finally { f.cleanup(); }
    }
  });

  it('an opted-out texter sending "WEEKEND" is still ignored (opt-out check comes first)', async () => {
    const f = loadWithFakes({ user: { opted_out: true } });
    try {
      const out = await f.send('WEEKEND');
      assert.strictEqual(out.reply, null);
      assert.strictEqual(f.updates.filter((u) => u.data.blast_opt_in === true).length, 0);
    } finally { f.cleanup(); }
  });
});

describe('Memory - a show "playing" is not live music', () => {
  const Q = 'is Paper Moon playing at the Williams Center on Thanksgiving?';

  it('musicUnsupported refuses a music interest with no music words, allows one with them', () => {
    const f = loadWithFakes(); // memory.js needs lib/db.js, which is faked here
    try {
      const memory = require('../lib/memory.js');
      assert.ok(memory.musicUnsupported('interest', 'live music', Q));
      assert.ok(memory.musicUnsupported('interest', 'live music', 'playing'));
      assert.strictEqual(memory.musicUnsupported('interest', 'live music', 'any live bands this weekend'), null);
      assert.strictEqual(memory.musicUnsupported('interest', 'jazz concerts', 'we love jazz'), null);
      assert.strictEqual(memory.musicUnsupported('interest', 'movies', Q), null);
      assert.strictEqual(memory.musicUnsupported('kid', 'plays in a band', 'my 12 year old'), null);
    } finally { f.cleanup(); }
  });

  it('the chat agent remembering "live music" from that question saves nothing', async () => {
    let result;
    const f = loadWithFakes({
      onTurn: async (opts) => {
        result = await opts.onRemember([{ kind: 'interest', fact: 'live music', they_said: 'playing at the Williams Center' }]);
      },
    });
    try {
      await f.send(Q);
      assert.strictEqual(f.inserts.filter((i) => i.table === 'subscriber_facts').length, 0, 'no fact should be stored');
      assert.deepStrictEqual(result.saved, []);
      assert.ok(result.skipped.some((s) => /live music: not saved/.test(s)));
    } finally { f.cleanup(); }
  });

  it('a real music ask is still saved', async () => {
    const f = loadWithFakes({
      onTurn: async (opts) => {
        await opts.onRemember([{ kind: 'interest', fact: 'live music', they_said: 'any live bands' }]);
      },
    });
    try {
      await f.send('any live bands in Teaneck Saturday?');
      const saved = f.inserts.filter((i) => i.table === 'subscriber_facts');
      assert.strictEqual(saved.length, 1);
      assert.strictEqual(saved[0].data.fact, 'live music');
    } finally { f.cleanup(); }
  });
});

describe('Conversation - name ask flags', () => {
  const u = (content) => ({ role: 'user', content });
  const a = (content) => ({ role: 'assistant', content });

  it('counts our replies so far in the conversation', () => {
    const { nameAsk } = require('../lib/conversation.js');
    assert.deepStrictEqual(nameAsk([]), { priorReplies: 0, askedName: false });
    assert.deepStrictEqual(nameAsk([u('hi')]), { priorReplies: 0, askedName: false });
    assert.strictEqual(nameAsk([u('hi'), a('Hey'), u('cool'), a('Nice')]).priorReplies, 2);
  });

  it('spots a name ask however it was worded', () => {
    const { nameAsk, ASKED_NAME } = require('../lib/conversation.js');
    for (const s of ['btw, what should I call you?', "what's your name?", 'Whats your name btw', 'who am I texting with?', "who i'm texting, btw?"]) {
      assert.ok(ASKED_NAME.test(s), s);
      assert.strictEqual(nameAsk([u('hi'), a(s)]).askedName, true, s);
    }
  });

  it('ignores their own texts and ordinary replies', () => {
    const { nameAsk } = require('../lib/conversation.js');
    assert.strictEqual(nameAsk([u("what's your name?"), a('Exit 163! Story time is Sat 10am, free.')]).askedName, false);
  });

  it('a first text reaches the agent as reply zero, not yet asked', async () => {
    let profile;
    const f = loadWithFakes({ onTurn: (opts) => { profile = opts.profile; } });
    try {
      await f.send('anything fun saturday?');
      assert.strictEqual(profile.priorReplies, 0);
      assert.strictEqual(profile.askedName, false);
    } finally { f.cleanup(); }
  });
});

describe('Compliance texts are unchanged', () => {
  it('keyword lists and HELP/JOIN/confirm texts match exactly', () => {
    const src = fs.readFileSync(path.join(__dirname, '../lib/conversation.js'), 'utf8');
    const join = fs.readFileSync(path.join(__dirname, '../api/join.js'), 'utf8');
    for (const line of [
      "const STOP_WORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT'];",
      "const START_WORDS = ['START', 'UNSTOP', 'YES'];",
      "const HELP_WORDS = ['HELP', 'INFO'];",
      "const JOIN_WORDS = ['JOIN', 'SUBSCRIBE', 'BERGEN', 'WEEKEND'];",
      'const HELP_TEXT = \'Exit 163: your Bergen County weekend buddy. Text me things like "what\\\'s on in Ridgewood Saturday?" Reply JOIN for the Friday text (about 1 msg/week). Some replies include a labeled deal. Msg & data rates may apply. Reply STOP to opt out. exit163.com\';',
      'const JOIN_TEXT = "You\'re in! Every Friday morning you\'ll get the best of the Bergen weekend by text (about 1 msg/week). Msg & data rates may apply. Reply STOP to cancel, HELP for help.";',
    ]) assert.ok(src.includes(line), line);
    assert.ok(join.includes('const CONFIRM_TEXT = "Exit 163 here, your Bergen County local agent. Reply JOIN to confirm and get the Friday weekend text (about 1 msg/wk), plus answers whenever you text me. Msg & data rates may apply. Reply HELP for help, STOP to cancel.";'));
  });
});
