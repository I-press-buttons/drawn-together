/* Keeps free-tier Supabase projects from auto-pausing.
 *
 * Supabase pauses a free project after 7 consecutive days without API
 * activity, and un-pausing is a manual restore that takes minutes. A daily
 * request against the REST API resets that clock.
 *
 * TARGETS holds one entry per project: `url` is the project's REST root and
 * `key` its publishable (anon) key — the same pair the browser already ships
 * in config.web.js, so nothing secret lives here. A 401/404 still counts as
 * activity, but we ping a real table so a broken key shows up as a failure
 * instead of passing silently.
 */
const TARGETS = [
  {
    name: 'drawn-together',
    url: 'https://wajjncluitygfatocbba.supabase.co/rest/v1/packs?select=id&limit=1',
    key: 'sb_publishable_PK351PhseJSGE7C9WMeF2w_szz10snZ',
  },
  {
    /* Every table here has RLS on with no known anon select policy, so a table
       read could answer 401/403 and read as a failure. The REST root returns
       the OpenAPI spec for any valid key, independent of RLS. */
    name: 'right-of-way',
    url: 'https://gsvedzfqwdpsaypqwhgw.supabase.co/rest/v1/',
    key: 'sb_publishable_qGiM6xE37A3X8WKqxOLdRA_K9K0CyMX',
  },
];

async function ping(target) {
  const started = Date.now();
  try {
    const res = await fetch(target.url, {
      headers: { apikey: target.key, Authorization: `Bearer ${target.key}` },
    });
    return {
      name: target.name,
      ok: res.ok,
      status: res.status,
      ms: Date.now() - started,
    };
  } catch (err) {
    return { name: target.name, ok: false, error: String(err), ms: Date.now() - started };
  }
}

async function pingAll() {
  const results = await Promise.all(TARGETS.map(ping));
  for (const r of results) {
    /* Shows up in `wrangler tail` and the Workers logs tab. */
    console.log(`keepalive ${r.name}: ${r.ok ? 'ok' : 'FAILED'} ${JSON.stringify(r)}`);
  }
  return results;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(pingAll());
  },

  /* Manual check: hit the worker's URL to run the same ping on demand. */
  async fetch(request) {
    const results = await pingAll();
    const allOk = results.every(r => r.ok);
    return new Response(JSON.stringify({ ok: allOk, results }, null, 2), {
      status: allOk ? 200 : 503,
      headers: { 'content-type': 'application/json' },
    });
  },
};
