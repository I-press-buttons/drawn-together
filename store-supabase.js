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
