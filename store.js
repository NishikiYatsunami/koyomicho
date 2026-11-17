// データ層：端末内（IndexedDB）に保存し、Googleドライブと同期する
// ・書き込みはまず端末内に保存 → 数秒後にドライブへ送る（オフラインでも書ける）
// ・PCとスマホで同じものを編集してぶつかったときは、消さずに「衝突コピー」を残す
(function () {
  'use strict';
  const D = window.GDrive;
  const ROOT_FOLDER = 'こよみ帳';
  const NOTES_FOLDER = 'notes';
  const DOC_NAMES = ['config', 'events', 'daytags'];
  const NOTE_FILE_RE = /^(\d{4}-\d{2}-\d{2})_([a-z0-9]{4,40})\.md$/;

  const DEFAULT_CONFIG = {
    tags: [
      { id: 'trpg', name: 'TRPG', color: '#7c3aed' },
      { id: 'yasumi', name: '休み', color: '#e11d48' },
      { id: 'kinenbi', name: '記念日', color: '#d97706' },
    ],
    categories: [
      { id: 'work', name: '仕事', color: '#2563eb' },
      { id: 'hobby', name: '趣味', color: '#16a34a' },
      { id: 'other', name: 'その他', color: '#6b7280' },
    ],
    templates: [
      { id: 'diary', name: '日記', title: '日記', body: '## 今日のできごと\n\n\n## よかったこと\n\n\n## ひとこと\n' },
      {
        id: 'trpgsession', name: 'TRPGセッション記録', title: 'セッション記録',
        body: '- システム：\n- シナリオ：\n- GM：\n- PL / PC：\n  - \n- 結果：\n\n## あらすじ\n\n\n## 印象に残った場面\n\n\n## 次回へのメモ\n- [ ] \n',
      },
    ],
    settings: { defaultView: 'month' },
  };
  const DEFAULTS = { config: DEFAULT_CONFIG, events: [], daytags: {} };

  const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // ============================================================ IndexedDB
  let db;
  function openDb() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open('koyomicho', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('kv');
        r.result.createObjectStore('notes', { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  function tx(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  const kvGet = (k) => tx('kv', 'readonly', (s) => s.get(k));
  const kvSet = (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k));
  const noteRow = (n) => {
    const { _open, _edit, ...rest } = n; // 画面用の一時フラグは保存しない
    return rest;
  };
  const notePut = (n) => tx('notes', 'readwrite', (s) => s.put(noteRow(n)));
  const noteDel = (id) => tx('notes', 'readwrite', (s) => s.delete(id));

  // ============================================================ 状態
  // docs[name] = { value, dirty, rev, base, driveId, version }
  const docs = {};
  const notes = new Map(); // id -> { id, date, title, body, created, updated, dirty, rev, deleted, driveId, version }
  let meta = { folderId: null, notesFolderId: null, lastSync: 0 };

  const changeListeners = new Set();
  const statusListeners = new Set();
  let status = { state: 'local', pending: 0, message: '' };

  const pendingCount = () =>
    DOC_NAMES.filter((n) => docs[n].dirty).length + [...notes.values()].filter((n) => n.dirty).length;

  function setStatus(state, message = '') {
    status = { state, pending: pendingCount(), message, lastSync: meta.lastSync };
    statusListeners.forEach((cb) => cb(status));
  }
  const refreshStatus = () => setStatus(status.state === 'synced' && pendingCount() ? 'pending' : status.state, status.message);
  const emitChange = () => changeListeners.forEach((cb) => cb());

  const saveDoc = (name) => kvSet('doc:' + name, docs[name]);

  // ============================================================ 公開API（読み書き）
  async function init() {
    db = await openDb();
    try { navigator.storage?.persist?.(); } catch (_) { /* noop */ }
    meta = (await kvGet('meta')) || meta;
    for (const name of DOC_NAMES) {
      docs[name] = (await kvGet('doc:' + name)) ||
        { value: clone(DEFAULTS[name]), dirty: false, rev: 0, base: undefined, driveId: null, version: null };
    }
    const c = docs.config.value;
    for (const k of Object.keys(DEFAULT_CONFIG)) if (c[k] === undefined) c[k] = clone(DEFAULT_CONFIG[k]);
    for (const n of (await tx('notes', 'readonly', (s) => s.getAll())) || []) notes.set(n.id, n);

    if (!D.configured()) setStatus('local');
    else if (!navigator.onLine) setStatus('offline');
    else if (!D.hasToken()) setStatus(D.wasConnected() ? 'needAuth' : 'notConnected');
    else { setStatus('pending'); sync(); }

    window.addEventListener('online', () => sync());
    window.addEventListener('offline', () => setStatus('offline'));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
    setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 120_000);
  }

  const get = (name) => docs[name].value;

  function set(name, value) {
    const d = docs[name];
    d.value = value;
    d.dirty = true;
    d.rev++;
    saveDoc(name);
    refreshStatus();
    scheduleSync();
  }

  const liveNotes = () => [...notes.values()].filter((n) => !n.deleted);
  const byCreated = (a, b) => (a.created || '').localeCompare(b.created || '') || a.id.localeCompare(b.id);

  function notesOn(date) { return liveNotes().filter((n) => n.date === date).sort(byCreated); }

  function noteIndex() {
    const idx = {};
    for (const n of liveNotes().sort(byCreated)) (idx[n.date] ||= []).push({ id: n.id, title: n.title });
    return idx;
  }

  function newNote(date, title, body) {
    const t = nowIso();
    const n = { id: uid(), date, title, body, created: t, updated: t, dirty: true, rev: 1, deleted: false, driveId: null, version: null };
    notes.set(n.id, n);
    notePut(n);
    refreshStatus();
    scheduleSync();
    return n;
  }

  /** 画面で note.title / note.body を書き換えたあとに呼ぶ */
  async function saveNote(note) {
    const n = notes.get(note.id);
    if (!n) return;
    if (n !== note) { n.title = note.title; n.body = note.body; }
    n.updated = nowIso();
    n.dirty = true;
    n.rev = (n.rev || 0) + 1;
    await notePut(n);
    refreshStatus();
    scheduleSync();
  }

  async function deleteNote(id) {
    const n = notes.get(id);
    if (!n) return;
    if (!n.driveId) { notes.delete(id); await noteDel(id); } else {
      n.deleted = true; n.dirty = true; n.rev = (n.rev || 0) + 1; await notePut(n);
    }
    refreshStatus();
    scheduleSync();
  }

  function search(q) {
    q = q.toLowerCase();
    const out = [];
    for (const n of liveNotes()) {
      const t = (n.title || '').toLowerCase(), b = (n.body || '').toLowerCase();
      if (!t.includes(q) && !b.includes(q)) continue;
      const pos = b.indexOf(q);
      let snippet;
      if (pos >= 0) { const s = Math.max(0, pos - 30); snippet = (s ? '…' : '') + n.body.slice(s, pos + q.length + 50).replace(/\n/g, ' '); } else snippet = (n.body || '').slice(0, 80).replace(/\n/g, ' ');
      out.push({ date: n.date, id: n.id, title: n.title, snippet });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }

  // ============================================================ Markdownファイル形式
  function formatNote(n) {
    const one = (s) => String(s || '').replace(/\r?\n/g, ' ');
    return `---\ntitle: ${one(n.title)}\ndate: ${n.date}\ncreated: ${one(n.created)}\nupdated: ${one(n.updated)}\n---\n${n.body || ''}`;
  }
  function parseNote(text) {
    text = text.replace(/\r\n/g, '\n');
    const meta = {};
    let body = text;
    if (text.startsWith('---\n')) {
      const end = text.indexOf('\n---\n', 4);
      if (end !== -1) {
        for (const line of text.slice(4, end).split('\n')) {
          const i = line.indexOf(':');
          if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
        }
        body = text.slice(end + 5);
      }
    }
    return { meta, body };
  }

  // ============================================================ 3方向マージ（予定・タグ・設定）
  function pick(b, l, r) {
    if (same(l, b)) return r;      // こちらは変更なし → 相手の内容
    if (same(r, b)) return l;      // 相手は変更なし → こちらの内容
    return l === undefined ? r : l; // 両方変更 → こちら優先（ただし片方が削除なら残す）
  }
  function mergeById(base = [], local = [], remote = []) {
    const B = new Map(base.map((x) => [x.id, x]));
    const L = new Map(local.map((x) => [x.id, x]));
    const R = new Map(remote.map((x) => [x.id, x]));
    const ids = [...new Set([...local.map((x) => x.id), ...remote.map((x) => x.id), ...base.map((x) => x.id)])];
    return ids.map((id) => pick(B.get(id), L.get(id), R.get(id))).filter((x) => x !== undefined);
  }
  function mergeObj(base = {}, local = {}, remote = {}) {
    const out = {};
    for (const k of new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base)])) {
      const v = pick(base[k], local[k], remote[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  function merge(name, base, local, remote) {
    if (name === 'events') return mergeById(base, local, remote);
    if (name === 'daytags') return mergeObj(base, local, remote);
    base = base || {};
    const out = {
      tags: mergeById(base.tags, local.tags, remote.tags),
      categories: mergeById(base.categories, local.categories, remote.categories),
      templates: mergeById(base.templates, local.templates, remote.templates),
      settings: mergeObj(base.settings, local.settings, remote.settings),
    };
    if (!out.categories.length) out.categories = clone(local.categories);
    return out;
  }

  // ============================================================ 同期
  let syncing = false, again = false, timer = null;

  function scheduleSync(delay = 2500) {
    clearTimeout(timer);
    timer = setTimeout(() => sync(), delay);
  }

  async function pool(items, size, fn) {
    let i = 0;
    const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) { const it = items[i++]; await fn(it); }
    });
    await Promise.all(workers);
  }

  async function sync() {
    clearTimeout(timer);
    if (!D.configured()) return setStatus('local');
    if (!navigator.onLine) return setStatus('offline');
    if (!D.hasToken()) return setStatus(D.wasConnected() ? 'needAuth' : 'notConnected');
    if (syncing) { again = true; return; }
    syncing = true;
    setStatus('syncing');
    let changed = false;
    try {
      do { again = false; if (await syncOnce()) changed = true; } while (again);
      meta.lastSync = Date.now();
      await kvSet('meta', meta);
      setStatus('synced');
    } catch (e) {
      if (e instanceof D.AuthError) setStatus('needAuth');
      else { console.error(e); setStatus('error', e.message); }
    } finally {
      syncing = false;
      if (changed) emitChange();
    }
  }

  async function syncOnce() {
    let changed = false;

    // フォルダ（初回だけ作る／探す）
    if (!meta.folderId || !meta.notesFolderId) {
      meta.folderId = await D.findOrCreateFolder(ROOT_FOLDER, 'root');
      meta.notesFolderId = await D.findOrCreateFolder(NOTES_FOLDER, meta.folderId);
      await kvSet('meta', meta);
    }
    let rootFiles;
    try { rootFiles = await D.list(meta.folderId); } catch (e) {
      // フォルダが消された等 → 探し直す
      meta.folderId = meta.notesFolderId = null;
      throw e;
    }
    if (!rootFiles.some((f) => f.id === meta.notesFolderId)) {
      meta.notesFolderId = await D.findOrCreateFolder(NOTES_FOLDER, meta.folderId);
      await kvSet('meta', meta);
    }

    // ---- 予定・タグ・設定（JSONファイル）
    for (const name of DOC_NAMES) {
      const d = docs[name];
      const fname = name + '.json';
      const remote = rootFiles.find((f) => f.name === fname);
      if (remote && (d.driveId !== remote.id || d.version !== remote.version)) {
        const rv = JSON.parse(await D.download(remote.id));
        if (d.dirty) d.value = merge(name, d.base, d.value, rv);
        else d.value = rv;
        d.base = clone(rv);
        d.driveId = remote.id;
        d.version = remote.version;
        if (d.dirty && same(d.value, rv)) d.dirty = false;
        await saveDoc(name);
        changed = true;
      }
      if (d.dirty || !remote) {
        const rev = d.rev;
        const snapshot = clone(d.value);
        const text = JSON.stringify(snapshot, null, 2);
        const r = remote ? await D.update(remote.id, text, 'application/json')
          : await D.create(meta.folderId, fname, text, 'application/json');
        d.driveId = r.id;
        d.version = r.version;
        d.base = snapshot;
        if (d.rev === rev) d.dirty = false;
        await saveDoc(name);
      }
    }

    // ---- メモ（1メモ＝1ファイル）
    const remoteNotes = (await D.list(meta.notesFolderId)).filter((f) => NOTE_FILE_RE.test(f.name));
    const remoteIds = new Set(remoteNotes.map((f) => f.id));
    const localByDrive = new Map();
    for (const n of notes.values()) if (n.driveId) localByDrive.set(n.driveId, n);

    const toDownload = [];
    for (const f of remoteNotes) {
      const [, date, id] = f.name.match(NOTE_FILE_RE);
      const local = localByDrive.get(f.id) || notes.get(id);
      if (local && local.driveId && local.driveId !== f.id && remoteIds.has(local.driveId)) continue; // 重複ファイルは無視
      if (local && local.driveId === f.id && local.version === f.version) continue; // 変更なし
      toDownload.push({ f, date, id });
    }
    await pool(toDownload, 6, async ({ f, date, id }) => {
      const { meta: fm, body } = parseNote(await D.download(f.id));
      const remote = {
        id, date, title: fm.title || '', body, created: fm.created || '', updated: fm.updated || '',
        dirty: false, rev: 0, deleted: false, driveId: f.id, version: f.version,
      };
      const local = notes.get(id);
      if (local && local.dirty && !local.deleted && (local.title !== remote.title || local.body !== remote.body)) {
        // 衝突：ドライブ側を正とし、この端末の編集はコピーとして残す
        const copy = {
          ...noteRow(local), id: uid(), title: (local.title || '（無題）') + '（衝突コピー）',
          driveId: null, version: null, dirty: true, rev: 1, deleted: false,
        };
        notes.set(copy.id, copy);
        await notePut(copy);
      }
      if (local) Object.assign(local, remote); // 画面が持っている参照も更新する
      const target = local || remote;
      notes.set(id, target);
      await notePut(target);
      changed = true;
    });

    // ドライブで消された（ゴミ箱に入れられた）メモ
    for (const n of [...notes.values()]) {
      if (n.driveId && !remoteIds.has(n.driveId)) {
        if (n.dirty && !n.deleted) { n.driveId = null; n.version = null; await notePut(n); } else {
          notes.delete(n.id); await noteDel(n.id); changed = true;
        }
      }
    }

    // この端末の変更を送る
    const dirty = [...notes.values()].filter((n) => n.dirty);
    await pool(dirty, 4, async (n) => {
      const rev = n.rev;
      if (n.deleted) {
        if (n.driveId) await D.trash(n.driveId); // ドライブのゴミ箱へ（30日間は復元可能）
        if (n.rev === rev) { notes.delete(n.id); await noteDel(n.id); }
        return;
      }
      const text = formatNote(n);
      const r = n.driveId ? await D.update(n.driveId, text, 'text/markdown')
        : await D.create(meta.notesFolderId, `${n.date}_${n.id}.md`, text, 'text/markdown');
      n.driveId = r.id;
      n.version = r.version;
      if (n.rev === rev) n.dirty = false;
      await notePut(n);
    });

    return changed;
  }

  // ============================================================ 接続・その他
  async function connect() {
    await D.connect();
    await sync();
  }
  function disconnect() {
    D.disconnect();
    setStatus('notConnected');
  }
  async function wipeLocal() {
    D.disconnect();
    db.close();
    await new Promise((res) => { const r = indexedDB.deleteDatabase('koyomicho'); r.onsuccess = r.onerror = r.onblocked = () => res(); });
  }

  function allNotesForExport() {
    return liveNotes().sort((a, b) => a.date.localeCompare(b.date) || byCreated(a, b))
      .map((n) => ({ ...noteRow(n), file: `notes/${n.date.slice(0, 4)}/${n.date}/${n.id}.md`, text: formatNote(n) }));
  }

  window.Store = {
    init, get, set, notesOn, noteIndex, newNote, saveNote, deleteNote, search,
    sync, connect, disconnect, wipeLocal, allNotesForExport, formatNote,
    status: () => status,
    configured: () => D.configured(),
    onChange: (cb) => changeListeners.add(cb),
    onStatus: (cb) => statusListeners.add(cb),
    uid,
  };
})();
