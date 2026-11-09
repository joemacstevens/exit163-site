// Server-side Supabase client (service role). Never ship this key to the browser.
const { createClient } = require('@supabase/supabase-js');

let client;
function db() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

// Throw on Supabase errors so callers can just await.
async function q(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`db: ${error.message}${error.details ? ` (${String(error.details).slice(0, 200)})` : ''}`);
  return data;
}

module.exports = { db, q };
