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

    /* Auth is a no-op on the local server. */
    signedIn() { return true; },
    userEmail() { return null; },
    onAuthChange(cb) {},
    async signIn(email) { return false; },
    async signOut() {},
  };
})();
