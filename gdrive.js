// Googleログイン（Google Identity Services）と Googleドライブ API の最小ラッパー
// 権限は drive.file（このアプリが作ったファイルだけ）。
(function () {
  'use strict';
  const TEST = window.KOYOMI_TEST || null; // 自動テスト用（通常は未定義）
  const API = TEST?.apiBase || 'https://www.googleapis.com';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const TOKEN_KEY = 'koyomi.token';
  const CONNECTED_KEY = 'koyomi.connected';
  const FOLDER_MIME = 'application/vnd.google-apps.folder';

  class AuthError extends Error { constructor() { super('Googleへの再接続が必要です'); this.name = 'AuthError'; } }

  let token = null;
  let gisPromise = null;

  const clientId = () => (window.KOYOMI_CONFIG || {}).googleClientId || '';
  const configured = () => !!(TEST || clientId());
  const wasConnected = () => !!(TEST || localStorage.getItem(CONNECTED_KEY));

  function loadToken() {
    try {
      const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
      if (t && t.expires_at > Date.now() + 60_000) token = t;
    } catch (_) { /* noop */ }
  }
  function saveToken(t) {
    token = t;
    try { t ? localStorage.setItem(TOKEN_KEY, JSON.stringify(t)) : localStorage.removeItem(TOKEN_KEY); } catch (_) { /* noop */ }
  }
  const hasToken = () => !!TEST || !!(token && token.expires_at > Date.now() + 30_000);

  function loadGis() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (!gisPromise) {
      gisPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.onload = resolve;
        s.onerror = () => { gisPromise = null; reject(new Error('Googleのログイン部品を読み込めませんでした（オフラインかもしれません）')); };
        document.head.append(s);
      });
    }
    return gisPromise;
  }

  /** ボタンを押したときに呼ぶ（ポップアップはタップ操作の中でしか開けないため） */
  async function connect() {
    if (TEST) return;
    if (!clientId()) throw new Error('config.js に Google のクライアントIDが設定されていません');
    await loadGis();
    await new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId(),
        scope: SCOPE,
        callback: (resp) => {
          if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
          if (!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
            reject(new Error('Googleドライブへのアクセスが許可されませんでした。もう一度接続し、チェックを入れてください。'));
            return;
          }
          saveToken({ access_token: resp.access_token, expires_at: Date.now() + (Number(resp.expires_in) || 3600) * 1000 });
          localStorage.setItem(CONNECTED_KEY, '1');
          resolve();
        },
        error_callback: (err) => {
          reject(new Error(err?.type === 'popup_closed' ? 'ログインが中断されました'
            : err?.type === 'popup_failed_to_open' ? 'ログイン画面を開けませんでした（ポップアップがブロックされていないか確認してください）'
              : 'ログインできませんでした'));
        },
      });
      client.requestAccessToken({ prompt: localStorage.getItem(CONNECTED_KEY) ? '' : 'consent' });
    });
  }

  function disconnect() {
    const t = token?.access_token;
    saveToken(null);
    localStorage.removeItem(CONNECTED_KEY);
    if (t && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t, () => {});
  }

  // ---------------------------------------------------------------- REST
  async function req(method, path, { query, body, headers = {}, text = false } = {}) {
    if (!hasToken()) throw new AuthError();
    const url = new URL(API + path);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const r = await fetch(url, {
      method,
      headers: { ...headers, Authorization: 'Bearer ' + (TEST ? 'test' : token.access_token) },
      body,
    });
    if (r.status === 401) { saveToken(null); throw new AuthError(); }
    if (!r.ok) throw new Error(`Googleドライブ エラー ${r.status}: ${(await r.text()).slice(0, 200)}`);
    if (text) return r.text();
    return r.status === 204 ? null : r.json();
  }

  const qEsc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  async function list(parentId, extraQ) {
    const files = [];
    let pageToken;
    do {
      const query = {
        q: `'${qEsc(parentId)}' in parents and trashed=false` + (extraQ ? ' and ' + extraQ : ''),
        fields: 'nextPageToken, files(id,name,version,mimeType)',
        pageSize: '1000',
        spaces: 'drive',
      };
      if (pageToken) query.pageToken = pageToken;
      const r = await req('GET', '/drive/v3/files', { query });
      files.push(...(r.files || []));
      pageToken = r.nextPageToken;
    } while (pageToken);
    return files;
  }

  async function findOrCreateFolder(name, parentId) {
    const found = await list(parentId, `name='${qEsc(name)}' and mimeType='${FOLDER_MIME}'`);
    if (found.length) return found[0].id;
    const r = await req('POST', '/drive/v3/files', {
      query: { fields: 'id' },
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    return r.id;
  }

  const download = (id) => req('GET', `/drive/v3/files/${encodeURIComponent(id)}`, { query: { alt: 'media' }, text: true });

  function create(parentId, name, content, mime) {
    const boundary = 'koyomi' + Math.random().toString(36).slice(2);
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ name, parents: [parentId], mimeType: mime }) +
      `\r\n--${boundary}\r\nContent-Type: ${mime}; charset=UTF-8\r\n\r\n` +
      content + `\r\n--${boundary}--`;
    return req('POST', '/upload/drive/v3/files', {
      query: { uploadType: 'multipart', fields: 'id,version' },
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
  }

  const update = (id, content, mime) => req('PATCH', `/upload/drive/v3/files/${encodeURIComponent(id)}`, {
    query: { uploadType: 'media', fields: 'id,version' },
    headers: { 'Content-Type': `${mime}; charset=UTF-8` },
    body: content,
  });

  const trash = (id) => req('PATCH', `/drive/v3/files/${encodeURIComponent(id)}`, {
    query: { fields: 'id' },
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ trashed: true }),
  });

  loadToken();
  // ログイン部品は先に読み込んでおく（ボタンを押した瞬間にポップアップを開けるように）
  if (!TEST && clientId() && navigator.onLine) loadGis().catch(() => {});

  window.GDrive = {
    AuthError, configured, wasConnected, hasToken, connect, disconnect,
    list, findOrCreateFolder, download, create, update, trash,
  };
})();
