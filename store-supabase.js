/* Store implementation backed by Supabase (Postgres + RLS + magic-link auth). */
(function () {
  if (window.DT_BACKEND !== 'supabase') return;

  const client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY);
  let session = null;
  const authCallbacks = [];
  let resolveReady;
  const readyPromise = new Promise(r => { resolveReady = r; });

  client.auth.getSession().then(({ data }) => {
    session = data.session;
    resolveReady();
    authCallbacks.forEach(cb => cb());
  });
  client.auth.onAuthStateChange((event, s) => {
    session = s;
    authCallbacks.forEach(cb => cb(event));
  });

  const EMPTY_MARKS = () => ({ favorites: [], retired: [] });

  /* Anonymous visitors have no account row to store the toggle in — keep it
     device-local. Signed-in users use the featured_pack_prefs table instead. */
  const FEATURED_PREFS_LS_KEY = 'dt_featured_pack_prefs';
  function readLocalFeaturedPrefs() {
    try { return JSON.parse(localStorage.getItem(FEATURED_PREFS_LS_KEY)) || {}; }
    catch (e) { return {}; }
  }

  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; /* no I,O,0,1 */
  function generateShareCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    return Array.from(bytes, b => CODE_ALPHABET[b % 32]).join('');
  }

  window.store = {
    backend: 'supabase',

    async loadPacks() {
      if (!session) return [];
      const { data, error } = await client
        .from('packs')
        .select('id, name, enabled, questions (id, text, rarity, category, created_at)')
        .order('created_at', { ascending: true });
      if (error) return [];
      return data.map(p => ({
        id: p.id, name: p.name, enabled: p.enabled,
        questions: (p.questions || [])
          .sort((a, b) => a.created_at < b.created_at ? -1 : 1)
          .map(q => ({ id: q.id, text: q.text, rarity: q.rarity, category: q.category })),
      }));
    },
    async createPack(name) {
      const { data, error } = await client.from('packs')
        .insert({ name }).select('id, name, enabled').single();
      return error ? null : { ...data, questions: [] };
    },
    async updatePack(id, fields) {
      const { data, error } = await client.from('packs')
        .update(fields).eq('id', id)
        .select('id, name, enabled, questions (id, text, rarity, category)').single();
      if (error) return null;
      return { id: data.id, name: data.name, enabled: data.enabled,
               questions: data.questions || [] };
    },
    async deletePack(id) {
      const { error } = await client.from('packs').delete().eq('id', id);
      if (error) return false;
      await client.from('marks').delete().like('qkey', `p${id}-%`);
      return true;
    },
    async addQuestion(packId, q) {
      const { data, error } = await client.from('questions')
        .insert({ pack_id: packId, text: q.text, rarity: q.rarity, category: q.category })
        .select('id, text, rarity, category').single();
      return error ? null : data;
    },
    async updateQuestion(packId, qid, fields) {
      const { data, error } = await client.from('questions')
        .update(fields).eq('id', qid).eq('pack_id', packId)
        .select('id, text, rarity, category').single();
      return error ? null : data;
    },
    async deleteQuestion(packId, qid) {
      const { error } = await client.from('questions')
        .delete().eq('id', qid).eq('pack_id', packId);
      if (error) return false;
      await client.from('marks').delete().eq('qkey', `p${packId}-${qid}`);
      return true;
    },
    async moveQuestions(fromPackId, toPackId, qids) {
      const { data, error } = await client.from('questions')
        .update({ pack_id: toPackId })
        .in('id', qids).eq('pack_id', fromPackId)
        .select('id, text, rarity, category');
      if (error || !data || data.length !== qids.length) return null;
      /* Rewrite marks: ids are unchanged, only the pack prefix moves. */
      const oldPrefix = `p${fromPackId}-`;
      const oldKeys = data.map(q => `${oldPrefix}${q.id}`);
      const { data: markRows, error: marksError } = await client.from('marks')
        .select('list, qkey').in('qkey', oldKeys);
      if (marksError) return null;
      if (markRows && markRows.length > 0) {
        const { error: upsertError } = await client.from('marks').upsert(markRows.map(r => ({
          list: r.list,
          qkey: `p${toPackId}-${r.qkey.slice(oldPrefix.length)}`,
        })));
        if (upsertError) return null;
        const { error: deleteError } = await client.from('marks').delete().in('qkey', oldKeys);
        if (deleteError) return null;
      }
      return data.map(q => ({
        oldQkey: `${oldPrefix}${q.id}`,
        newQkey: `p${toPackId}-${q.id}`,
        question: q,
      }));
    },
    async loadShares() {
      if (!session) return {};
      const { data, error } = await client.from('pack_shares').select('code, pack_id');
      if (error) return {};
      return data.reduce((acc, row) => { acc[row.pack_id] = row.code; return acc; }, {});
    },
    async sharePack(packId) {
      const code = generateShareCode();
      const { error } = await client.from('pack_shares').insert({ code, pack_id: packId });
      if (!error) return code;
      if (error.code === '23505') {
        const { data } = await client.from('pack_shares')
          .select('code').eq('pack_id', packId).single();
        return data ? data.code : null;
      }
      return null;
    },
    async revokeShare(packId) {
      const { error } = await client.from('pack_shares').delete().eq('pack_id', packId);
      return !error;
    },
    async unlockPack(code) {
      code = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const { data, error } = await client.rpc('unlock_pack', { share_code: code });
      if (error) return { error: error.message };
      return { pack: data };
    },
    async loadMarks() {
      if (!session) return EMPTY_MARKS();
      const { data, error } = await client.from('marks').select('list, qkey');
      if (error) return EMPTY_MARKS();
      const marks = EMPTY_MARKS();
      for (const row of data) marks[row.list].push(row.qkey);
      return marks;
    },
    async setMark(list, qkey, on) {
      const op = on
        ? client.from('marks').upsert({ list, qkey })
        : client.from('marks').delete().match({ list, qkey });
      const { error } = await op;
      return error ? null : this.loadMarks();
    },
    async loadSession() {
      if (!session) return null;
      const { data, error } = await client.from('sessions')
        .select('data').eq('user_id', session.user.id).maybeSingle();
      if (error || !data) return null;
      return data.data;
    },
    async saveSession(sessionState) {
      if (!session) return false;
      const { error } = await client.from('sessions')
        .upsert({ user_id: session.user.id, data: sessionState, updated_at: new Date().toISOString() });
      return !error;
    },
    async clearSession() {
      if (!session) return false;
      const { error } = await client.from('sessions').delete().eq('user_id', session.user.id);
      return !error;
    },
    async loadFeaturedPackPrefs() {
      if (!session) return readLocalFeaturedPrefs();
      const { data, error } = await client.from('featured_pack_prefs')
        .select('pack_key, enabled');
      if (error) return {};
      const prefs = {};
      for (const row of data) prefs[row.pack_key] = row.enabled;
      return prefs;
    },
    async setFeaturedPackPref(key, enabled) {
      if (!session) {
        const prefs = readLocalFeaturedPrefs();
        prefs[key] = enabled;
        try { localStorage.setItem(FEATURED_PREFS_LS_KEY, JSON.stringify(prefs)); }
        catch (e) { return null; }
        return prefs;
      }
      const { error } = await client.from('featured_pack_prefs')
        .upsert({ pack_key: key, enabled });
      return error ? null : this.loadFeaturedPackPrefs();
    },
    async loadBackgroundPref() {
      if (!session) return null;
      const { data, error } = await client.from('user_settings')
        .select('background').eq('user_id', session.user.id).maybeSingle();
      return (error || !data) ? null : data.background;
    },
    async setBackgroundPref(key) {
      if (!session) return false;
      const { error } = await client.from('user_settings')
        .upsert({ user_id: session.user.id, background: key, updated_at: new Date().toISOString() });
      return !error;
    },

    ready() { return readyPromise; },
    signedIn() { return !!session; },
    userEmail() { return session ? session.user.email : null; },
    onAuthChange(cb) { authCallbacks.push(cb); },
    async signIn(email, password, captchaToken) {
      const { error } = await client.auth.signInWithPassword({
        email, password,
        options: { captchaToken },
      });
      if (error) console.error('[signIn] signInWithPassword error:', error.status, error.message);
      return error ? error.message : null;
    },
    async signUp(email, password, captchaToken) {
      const { error } = await client.auth.signUp({
        email, password,
        options: { captchaToken },
      });
      if (error) console.error('[signUp] signUp error:', error.status, error.message);
      return error ? error.message : null;
    },
    async requestPasswordReset(email, captchaToken) {
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname,
        captchaToken,
      });
      if (error) console.error('[requestPasswordReset] error:', error.status, error.message);
      return error ? error.message : null;
    },
    async updatePassword(newPassword) {
      const { error } = await client.auth.updateUser({ password: newPassword });
      if (error) console.error('[updatePassword] error:', error.status, error.message);
      return error ? error.message : null;
    },
    async signOut() { await client.auth.signOut(); },
  };
})();
