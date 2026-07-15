/* Store implementation backed by server.py's /api endpoints. */
(function () {
  if (window.DT_BACKEND !== 'server') return;
  const API_BASE = '/api/packs';

  async function json(res) { return res.ok ? res.json() : null; }

  window.store = {
    backend: 'server',

    async loadPacks() {
      try { return (await json(await fetch(API_BASE))) || []; }
      catch (e) { return []; }
    },
    async createPack(name) {
      const res = await fetch(API_BASE, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ name }),
      });
      return json(res);
    },
    async updatePack(id, fields) {
      const res = await fetch(`${API_BASE}/${id}`, {
        method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(fields),
      });
      return json(res);
    },
    async deletePack(id) {
      return (await fetch(`${API_BASE}/${id}`, { method: 'DELETE' })).ok;
    },
    async addQuestion(packId, q) {
      const res = await fetch(`${API_BASE}/${packId}/questions`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(q),
      });
      return json(res);
    },
    async updateQuestion(packId, qid, fields) {
      const res = await fetch(`${API_BASE}/${packId}/questions/${qid}`, {
        method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(fields),
      });
      return json(res);
    },
    async deleteQuestion(packId, qid) {
      return (await fetch(`${API_BASE}/${packId}/questions/${qid}`, { method: 'DELETE' })).ok;
    },
    async moveQuestions(fromPackId, toPackId, qids) {
      try {
        const res = await fetch(`${API_BASE}/${fromPackId}/questions/move`, {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ toPackId: Number(toPackId), qids: qids.map(Number) }),
        });
        const data = await json(res);
        return data ? data.moved : null;
      } catch (e) { return null; }
    },
    async loadMarks() {
      try { return (await json(await fetch('/api/marks'))) || { favorites: [], retired: [] }; }
      catch (e) { return { favorites: [], retired: [] }; }
    },
    async setMark(list, qkey, on) {
      try {
        const res = await fetch(`/api/marks/${list}/${qkey}`, { method: on ? 'POST' : 'DELETE' });
        return json(res);
      } catch (e) { return null; }
    },
    async loadSession() {
      try {
        const data = await json(await fetch('/api/session'));
        return data ? data.session : null;
      } catch (e) { return null; }
    },
    async saveSession(session) {
      try {
        const res = await fetch('/api/session', {
          method: 'PUT', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(session),
        });
        return res.ok;
      } catch (e) { return false; }
    },
    async clearSession() {
      try { return (await fetch('/api/session', { method: 'DELETE' })).ok; }
      catch (e) { return false; }
    },
    async loadFeaturedPackPrefs() {
      try { return (await json(await fetch('/api/featured-pack-prefs'))) || {}; }
      catch (e) { return {}; }
    },
    async setFeaturedPackPref(key, enabled) {
      try {
        const res = await fetch(`/api/featured-pack-prefs/${key}`, {
          method: 'PUT', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ enabled }),
        });
        return json(res);
      } catch (e) { return null; }
    },

    /* Sharing is not available on the local server. */
    async loadShares() { return {}; },
    async sharePack() { return null; },
    async revokeShare() { return false; },
    async unlockPack() { return { error: 'Sharing is not available on this server' }; },

    /* Auth is a no-op on the local server. */
    ready() { return Promise.resolve(); },
    signedIn() { return true; },
    userEmail() { return null; },
    onAuthChange(cb) {},
    async signIn(email) { return false; },
    async signOut() {},
  };
})();
