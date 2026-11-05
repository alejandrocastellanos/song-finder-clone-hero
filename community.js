'use strict';
/* Public counter, weekly top and ratings, stored in Supabase. If the service is down, these sections just don't show. */
const Community = (() => {
  const URL_BASE = 'https://xqkfwftowvjhqlupestz.supabase.co/rest/v1/rpc/';
  const KEY = 'sb_publishable_sifGcqo-0L8gOGUWpQFxZw_GQvJSorY';   // public key: it can only call the functions in supabase/schema.sql
  // only the published site writes, so local tests don't count as real downloads or votes
  const LIVE = location.hostname === 'alejandrocastellanos.github.io';
  const validId = md5 => /^[0-9a-f]{32}$/.test(md5 || '');

  async function rpc(fn, body) {
    const r = await fetch(URL_BASE + fn, {
      method: 'POST',
      headers: { apikey: KEY, 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    if (!r.ok) throw new Error('Community ' + r.status);
    return r.status === 204 ? null : r.json();
  }
  const local = {
    get(k, d) { try { const v = localStorage.getItem('chb-' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('chb-' + k, JSON.stringify(v)); } catch { } },
  };

  // a random id kept in this browser, so changing a vote replaces it; it identifies nobody
  function voter() {
    let id = local.get('voter', null);
    if (!id) { id = crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)); local.set('voter', id); }
    return id;
  }

  // one count per song, browser and day, so repeated downloads don't inflate the top
  function recordDownload(s) {
    if (!LIVE || !validId(s.md5)) return;
    const today = new Date().toISOString().slice(0, 10);
    const seen = local.get('counted', { day: today, ids: [] });
    const ids = seen.day === today ? seen.ids : [];
    if (ids.includes(s.md5)) return;
    ids.push(s.md5); local.set('counted', { day: today, ids });
    rpc('record_download', { p_md5: s.md5, p_artist: String(s.artist || 'Desconocido'), p_name: String(s.name || 'Sin nombre') }).catch(() => { });
  }

  const total = () => rpc('downloads_total').catch(() => null);
  const top = (limit = 10) => rpc('top_downloads_week', { p_limit: limit }).catch(() => []);

  const canRate = md5 => validId(md5);
  const summary = md5 => (canRate(md5) ? rpc('rating_summary', { p_md5: md5 }).catch(() => []) : Promise.resolve([]));
  const myVote = (md5, level) => local.get('votes', {})[md5 + level] || 0;
  async function rate(md5, level, stars) {
    const votes = local.get('votes', {}); votes[md5 + level] = stars; local.set('votes', votes);
    if (LIVE) await rpc('rate_level', { p_md5: md5, p_level: level, p_stars: stars, p_voter: voter() });
  }

  return { recordDownload, total, top, canRate, summary, myVote, rate };
})();
