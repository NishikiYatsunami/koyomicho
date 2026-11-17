// こよみ帳 — メイン画面
(function () {
  'use strict';

  // ============================================================ 小道具
  const $ = (s, el = document) => el.querySelector(s);
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const dayDiff = (a, b) => Math.round((b - a) / 86400000);
  const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));
  const WD_JP = ['日', '月', '火', '水', '木', '金', '土'];
  const WD_MON = ['月', '火', '水', '木', '金', '土', '日'];
  const uid = () => Store.uid();
  const todayStr = () => ymd(new Date());
  const fmtDate = (s) => { const d = parseYmd(s); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WD_JP[d.getDay()]}）`; };
  const fmtShort = (s) => { const d = parseYmd(s); return `${d.getMonth() + 1}/${d.getDate()}（${WD_JP[d.getDay()]}）`; };
  const isNarrow = () => window.matchMedia('(max-width: 720px)').matches;

  /** DOM要素を作る。文字列はすべて textContent として入るので安全 */
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (k === 'html') el.innerHTML = v;
        else if (k in el && typeof v !== 'string') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  /** 背景色に合わせて文字色（白/黒）を選ぶ */
  function textOn(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#fff';
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#2b2925' : '#fff';
  }

  const flatKids = (...a) => a.flat(Infinity).filter((x) => x != null && x !== false);

  function toast(msg, isError) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.className = 'toast'; }, isError ? 4000 : 1800);
  }

  // ============================================================ 状態
  const S = {
    get config() { return Store.get('config'); },
    set config(v) { Store.set('config', v); },
    get events() { return Store.get('events'); },
    set events(v) { Store.set('events', v); },
    get daytags() { return Store.get('daytags'); },
    get notesIndex() { return Store.noteIndex(); },
    view: 'month',
    cursor: new Date(),
    filter: { tags: new Set(), cats: new Set() },
    openDate: null,
    dayNotes: [],
  };

  const tagById = (id) => S.config.tags.find((t) => t.id === id);
  const catById = (id) => S.config.categories.find((c) => c.id === id) || S.config.categories[S.config.categories.length - 1] || { id: '', name: '', color: '#6b7280' };

  const saveEvents = () => Store.set('events', S.events);
  const saveDaytags = () => Store.set('daytags', S.daytags);
  const saveConfig = () => Store.set('config', S.config);

  // ============================================================ 絞り込み
  const filterActive = () => S.filter.tags.size > 0 || S.filter.cats.size > 0;

  function eventVisible(e) {
    if (S.filter.cats.size && !S.filter.cats.has(e.category)) return false;
    if (S.filter.tags.size && !(e.tags || []).some((t) => S.filter.tags.has(t))) return false;
    return true;
  }
  const visibleEvents = () => S.events.filter(eventVisible);
  function visibleDayTags(date) {
    const tags = (S.daytags[date] || []).filter(tagById);
    return S.filter.tags.size ? tags.filter((t) => S.filter.tags.has(t)) : tags;
  }
  const dayHit = (date) => S.filter.tags.size > 0 && (S.daytags[date] || []).some((t) => S.filter.tags.has(t));

  function eventsOn(date, list = visibleEvents()) {
    return list
      .filter((e) => e.start <= date && e.end >= date)
      .sort((a, b) => {
        const am = a.start !== a.end, bm = b.start !== b.end;
        if (am !== bm) return am ? -1 : 1;
        const at = a.startTime || '', bt = b.startTime || '';
        if (!at !== !bt) return at ? 1 : -1;
        return at.localeCompare(bt) || a.title.localeCompare(b.title);
      });
  }

  function timeLabel(e, date) {
    if (e.start !== e.end) {
      if (date === e.start && e.startTime) return e.startTime + '〜';
      if (date === e.end && e.endTime) return '〜' + e.endTime;
      return '';
    }
    if (e.startTime && e.endTime) return `${e.startTime}–${e.endTime}`;
    return e.startTime || '';
  }

  // ============================================================ 共通部品
  function tagChip(tag, opts = {}) {
    return h('span', {
      class: 'chip' + (opts.small ? ' small' : ''),
      style: { background: tag.color, color: textOn(tag.color) },
      title: tag.name,
    }, tag.name);
  }

  function toggleChip(item, on, onClick) {
    return h('button', {
      type: 'button',
      class: 'chip toggle' + (on ? ' on' : ''),
      style: on ? { background: item.color, color: textOn(item.color), borderColor: item.color }
        : { borderColor: item.color, color: item.color },
      onclick: onClick,
    }, item.name);
  }

  function eventBarStyle(e) {
    const c = catById(e.category).color;
    return { background: c + '22', borderLeftColor: c };
  }

  function tagDots(e) {
    return (e.tags || []).map(tagById).filter(Boolean)
      .map((t) => h('span', { class: 'dot', style: { background: t.color }, title: t.name }));
  }

  // ============================================================ ヘッダー
  function renderTitle() {
    const c = S.cursor;
    let t;
    if (S.view === 'week') {
      const s = mondayOf(c), e = addDays(s, 6);
      t = `${s.getFullYear()}年${s.getMonth() + 1}月${s.getDate()}日 〜 ` +
        (e.getMonth() !== s.getMonth() ? `${e.getMonth() + 1}月` : '') + `${e.getDate()}日`;
    } else {
      t = `${c.getFullYear()}年${c.getMonth() + 1}月`;
    }
    $('#title').textContent = t;
    document.querySelectorAll('.views button').forEach((b) => b.classList.toggle('active', b.dataset.view === S.view));
    const fc = S.filter.tags.size + S.filter.cats.size;
    $('#filter-count').hidden = !fc;
    $('#filter-count').textContent = fc;
    $('#btn-filter').classList.toggle('active', !$('#filterbar').hidden || fc > 0);
  }

  function move(dir) {
    const c = S.cursor;
    S.cursor = S.view === 'week' ? addDays(c, 7 * dir) : new Date(c.getFullYear(), c.getMonth() + dir, 1);
    render();
  }

  function render() {
    renderTitle();
    const main = $('#main');
    main.replaceChildren();
    if (S.view === 'month') main.append(renderMonth());
    else if (S.view === 'week') main.append(renderWeek());
    else main.append(renderList());
  }

  // ============================================================ 月表示
  function dayClasses(d, inMonth) {
    const ds = ymd(d);
    const cls = [];
    if (!inMonth) cls.push('out');
    if (ds === todayStr()) cls.push('today');
    if (d.getDay() === 0 || holidayName(ds)) cls.push('sun');
    else if (d.getDay() === 6) cls.push('sat');
    if (dayHit(ds)) cls.push('hit');
    return cls.join(' ');
  }

  function layoutWeek(weekStart, events) {
    const ws = ymd(weekStart), we = ymd(addDays(weekStart, 6));
    const span = (e) => dayDiff(parseYmd(e.start), parseYmd(e.end));
    const evs = events.filter((e) => e.start <= we && e.end >= ws).sort((a, b) =>
      a.start.localeCompare(b.start) || span(b) - span(a) ||
      (a.startTime || '').localeCompare(b.startTime || '') || a.title.localeCompare(b.title));
    const lanes = [];
    return evs.map((e) => {
      const s = Math.max(0, dayDiff(weekStart, parseYmd(e.start)));
      const t = Math.min(6, dayDiff(weekStart, parseYmd(e.end)));
      let l = 0;
      for (;;) {
        if (!lanes[l]) lanes[l] = Array(7).fill(false);
        if (lanes[l].slice(s, t + 1).every((x) => !x)) break;
        l++;
      }
      for (let c = s; c <= t; c++) lanes[l][c] = true;
      return { e, s, t, l, contL: e.start < ws, contR: e.end > we };
    });
  }

  function renderMonth() {
    const y = S.cursor.getFullYear(), m = S.cursor.getMonth();
    const start = mondayOf(new Date(y, m, 1));
    const end = addDays(mondayOf(new Date(y, m + 1, 0)), 6);
    const weeks = (dayDiff(start, end) + 1) / 7;
    const MAX = isNarrow() ? 3 : 4;
    const events = visibleEvents();

    const wrap = h('div', { class: 'month' });
    wrap.append(h('div', { class: 'month-head' },
      WD_MON.map((w, i) => h('div', { class: i === 5 ? 'sat' : i === 6 ? 'sun' : '' }, w))));

    const body = h('div', { class: 'month-body' });
    for (let w = 0; w < weeks; w++) {
      const ws = addDays(start, w * 7);
      const week = h('div', { class: 'week' });
      const bg = h('div', { class: 'week-bg' });
      const fg = h('div', { class: 'week-fg', style: { gridTemplateRows: `auto repeat(${MAX}, var(--bar-h)) auto` } });

      for (let i = 0; i < 7; i++) {
        const d = addDays(ws, i), ds = ymd(d);
        bg.append(h('div', { class: 'cell ' + dayClasses(d, d.getMonth() === m), onclick: () => openDay(ds) }));
        const hol = holidayName(ds);
        const notes = S.notesIndex[ds] || [];
        const showNotes = notes.length && (!S.filter.tags.size || dayHit(ds));
        fg.append(h('div', { class: 'cell-head ' + dayClasses(d, d.getMonth() === m), style: { gridColumn: i + 1, gridRow: 1 } },
          h('div', { class: 'cell-top' },
            h('span', { class: 'num' }, d.getDate() === 1 ? `${d.getMonth() + 1}/${d.getDate()}` : d.getDate()),
            hol ? h('span', { class: 'hol' }, hol) : null,
            showNotes ? h('span', { class: 'memo-ind', title: notes.map((n) => n.title || '（無題）').join('\n') }, '📝' + (notes.length > 1 ? notes.length : '')) : null),
          h('div', { class: 'cell-tags' }, visibleDayTags(ds).map((id) => tagChip(tagById(id), { small: true })))));
      }

      const hidden = Array(7).fill(0);
      for (const p of layoutWeek(ws, events)) {
        if (p.l >= MAX) { for (let c = p.s; c <= p.t; c++) hidden[c]++; continue; }
        const e = p.e;
        const single = e.start === e.end;
        const tl = single ? timeLabel(e, e.start) : (p.contL ? '' : timeLabel(e, e.start));
        fg.append(h('div', {
          class: 'bar' + (single ? ' single' : ' multi') + (p.contL ? ' cont-l' : '') + (p.contR ? ' cont-r' : ''),
          style: Object.assign({ gridColumn: `${p.s + 1} / ${p.t + 2}`, gridRow: p.l + 2 }, eventBarStyle(e)),
          title: `${e.title}${tl ? ' ' + tl : ''}\n${catById(e.category).name}`,
          onclick: (ev) => { ev.stopPropagation(); openEventEditor(e); },
        },
        tl && !isNarrow() ? h('span', { class: 'time' }, tl.replace(/–.*/, '')) : null,
        h('span', { class: 'bar-title' }, e.title),
        h('span', { class: 'dots' }, tagDots(e))));
      }
      hidden.forEach((n, c) => {
        if (!n) return;
        const ds = ymd(addDays(ws, c));
        fg.append(h('button', { class: 'more', style: { gridColumn: c + 1, gridRow: MAX + 2 }, onclick: (ev) => { ev.stopPropagation(); openDay(ds); } }, `+${n}件`));
      });

      week.append(bg, fg);
      body.append(week);
    }
    wrap.append(body);
    return wrap;
  }

  // ============================================================ 週表示
  function renderWeek() {
    const ws = mondayOf(S.cursor);
    const events = visibleEvents();
    const wrap = h('div', { class: 'weekview' });
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i), ds = ymd(d);
      const hol = holidayName(ds);
      const notes = (!S.filter.tags.size || dayHit(ds)) ? (S.notesIndex[ds] || []) : [];
      const col = h('section', { class: 'wcol ' + dayClasses(d, true), onclick: () => openDay(ds) },
        h('header', null,
          h('span', { class: 'wd' }, WD_MON[i]),
          h('span', { class: 'num' }, `${d.getMonth() + 1}/${d.getDate()}`),
          hol ? h('span', { class: 'hol' }, hol) : null),
        h('div', { class: 'cell-tags' }, visibleDayTags(ds).map((id) => tagChip(tagById(id), { small: true }))),
        h('div', { class: 'wevents' }, eventsOn(ds, events).map((e) => {
          const tl = timeLabel(e, ds);
          const multi = e.start !== e.end;
          return h('div', {
            class: 'wevent', style: eventBarStyle(e),
            onclick: (ev) => { ev.stopPropagation(); openEventEditor(e); },
          },
          h('div', { class: 'wtime' }, tl || (multi ? '' : '終日'),
            multi ? h('span', { class: 'span-note' }, `${fmtShort(e.start).replace(/（.）/, '')}〜${fmtShort(e.end).replace(/（.）/, '')}`) : null),
          h('div', { class: 'wtitle' }, e.title),
          h('div', { class: 'dots' }, tagDots(e)));
        })),
        notes.length ? h('div', { class: 'wnotes' }, notes.map((n) => h('div', { class: 'wnote' }, '📝 ' + (n.title || '（無題）')))) : null,
        h('button', { class: 'wadd', title: 'この日に予定を追加', onclick: (ev) => { ev.stopPropagation(); openEventEditor(null, ds); } }, '＋'));
      wrap.append(col);
    }
    return wrap;
  }

  // ============================================================ 一覧表示（その月）
  function renderList() {
    const y = S.cursor.getFullYear(), m = S.cursor.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    const events = visibleEvents();
    const wrap = h('div', { class: 'listview' });
    let any = false;
    for (let i = 1; i <= days; i++) {
      const d = new Date(y, m, i), ds = ymd(d);
      const evs = eventsOn(ds, events);
      const tags = visibleDayTags(ds);
      const notes = (!S.filter.tags.size || dayHit(ds)) ? (S.notesIndex[ds] || []) : [];
      if (!evs.length && !tags.length && !notes.length) continue;
      any = true;
      const hol = holidayName(ds);
      wrap.append(h('div', { class: 'lrow ' + dayClasses(d, true), onclick: () => openDay(ds) },
        h('div', { class: 'ldate' },
          h('span', { class: 'num' }, i),
          h('span', { class: 'wd' }, WD_JP[d.getDay()]),
          hol ? h('span', { class: 'hol' }, hol) : null),
        h('div', { class: 'lbody' },
          tags.length ? h('div', { class: 'cell-tags' }, tags.map((id) => tagChip(tagById(id), { small: true }))) : null,
          evs.map((e) => h('div', { class: 'levent', style: eventBarStyle(e), onclick: (ev) => { ev.stopPropagation(); openEventEditor(e); } },
            h('span', { class: 'cat', style: { color: catById(e.category).color } }, catById(e.category).name),
            h('span', { class: 'ltime' }, timeLabel(e, ds) || (e.start !== e.end ? '' : '終日')),
            h('span', { class: 'ltitle' }, e.title),
            e.start !== e.end ? h('span', { class: 'span-note' }, `${fmtShort(e.start)}〜${fmtShort(e.end)}`) : null,
            h('span', { class: 'ltags' }, (e.tags || []).map(tagById).filter(Boolean).map((t) => tagChip(t, { small: true }))))),
          notes.map((n) => h('div', { class: 'lnote' }, '📝 ' + (n.title || '（無題）'))))));
    }
    if (!any) wrap.append(h('p', { class: 'empty' }, filterActive() ? '絞り込み条件に合うものはありません。' : 'この月はまだ何もありません。日付をクリックして書き始めましょう。'));
    return wrap;
  }

  // ============================================================ 絞り込みバー
  function renderFilterbar() {
    const bar = $('#filterbar');
    bar.replaceChildren(
      h('div', { class: 'frow' }, h('span', { class: 'flabel' }, 'タグ'),
        S.config.tags.length ? S.config.tags.map((t) => toggleChip(t, S.filter.tags.has(t.id), () => {
          S.filter.tags.has(t.id) ? S.filter.tags.delete(t.id) : S.filter.tags.add(t.id);
          renderFilterbar(); render();
        })) : h('span', { class: 'muted' }, 'タグがありません（⚙設定から追加）')),
      h('div', { class: 'frow' }, h('span', { class: 'flabel' }, '区分'),
        S.config.categories.map((c) => toggleChip(c, S.filter.cats.has(c.id), () => {
          S.filter.cats.has(c.id) ? S.filter.cats.delete(c.id) : S.filter.cats.add(c.id);
          renderFilterbar(); render();
        })),
        h('button', { class: 'btn small', onclick: () => { S.filter.tags.clear(); S.filter.cats.clear(); renderFilterbar(); render(); } }, 'クリア')),
      h('p', { class: 'fhint' }, 'タグを選ぶと、そのタグが付いた予定・日付だけを表示します（日付タグが一致する日は色付きで強調）。複数選ぶと「どれかに一致」。'));
  }

  // ============================================================ 日付パネル（メモ）
  const saveTimers = new Map();

  async function openDay(date) {
    await flushNotes();
    S.openDate = date;
    S.dayNotes = Store.notesOn(date);
    S.dayNotes.forEach((n) => { n._open = false; n._edit = false; });
    renderDayPanel();
    $('#daypanel').hidden = false;
    $('#panel-backdrop').hidden = false;
    document.body.classList.add('panel-open');
  }

  async function closeDay() {
    await flushNotes();
    S.openDate = null;
    $('#daypanel').hidden = true;
    $('#panel-backdrop').hidden = true;
    document.body.classList.remove('panel-open');
  }

  function renderDayPanel() {
    const date = S.openDate;
    const panel = $('#daypanel');
    const d = parseYmd(date);
    const hol = holidayName(date);
    const cur = new Set(S.daytags[date] || []);

    const dayEvents = eventsOn(date, S.events);

    panel.replaceChildren(...flatKids(
      h('div', { class: 'ph' },
        h('button', { class: 'icon-btn', title: '前の日', onclick: () => openDay(ymd(addDays(d, -1))) }, '‹'),
        h('div', { class: 'ph-title ' + (d.getDay() === 0 || hol ? 'sun' : d.getDay() === 6 ? 'sat' : '') },
          h('div', null, fmtDate(date)), hol ? h('div', { class: 'hol' }, hol) : null),
        h('button', { class: 'icon-btn', title: '次の日', onclick: () => openDay(ymd(addDays(d, 1))) }, '›'),
        h('button', { class: 'icon-btn close', title: '閉じる (Esc)', onclick: closeDay }, '×')),

      h('section', { class: 'psec' },
        h('h3', null, 'この日のタグ'),
        h('div', { class: 'chips' },
          S.config.tags.map((t) => toggleChip(t, cur.has(t.id), async () => {
            const set = new Set(S.daytags[date] || []);
            set.has(t.id) ? set.delete(t.id) : set.add(t.id);
            if (set.size) S.daytags[date] = [...set]; else delete S.daytags[date];
            renderDayPanel(); render();
            await saveDaytags();
          })),
          S.config.tags.length ? null : h('span', { class: 'muted' }, '⚙設定でタグを作れます'))),

      h('section', { class: 'psec' },
        h('div', { class: 'sec-head' }, h('h3', null, '予定'),
          h('button', { class: 'btn small', onclick: () => openEventEditor(null, date) }, '＋ 予定を追加')),
        dayEvents.length ? h('div', { class: 'pevents' }, dayEvents.map((e) => h('div', {
          class: 'pevent', style: eventBarStyle(e), onclick: () => openEventEditor(e),
        },
        h('div', { class: 'pe-top' },
          h('span', { class: 'cat', style: { color: catById(e.category).color } }, catById(e.category).name),
          h('span', { class: 'ltime' }, timeLabel(e, date) || (e.start !== e.end ? '' : '終日')),
          e.start !== e.end ? h('span', { class: 'span-note' }, `${fmtShort(e.start)}〜${fmtShort(e.end)}`) : null),
        h('div', { class: 'pe-title' }, e.title),
        (e.tags || []).length ? h('div', { class: 'chips' }, e.tags.map(tagById).filter(Boolean).map((t) => tagChip(t, { small: true }))) : null,
        e.note ? h('div', { class: 'pe-note' }, e.note) : null))) : h('p', { class: 'muted' }, '予定はありません')),

      h('section', { class: 'psec notes-sec' },
        h('div', { class: 'sec-head' }, h('h3', null, 'メモ'),
          h('div', { class: 'sec-actions' },
            S.dayNotes.length > 1 ? h('button', { class: 'btn small ghost', onclick: () => setAllOpen(true) }, 'すべて開く') : null,
            S.dayNotes.length > 1 ? h('button', { class: 'btn small ghost', onclick: () => setAllOpen(false) }, 'すべて閉じる') : null,
            newNoteMenu(date))),
        S.dayNotes.length ? null : h('p', { class: 'muted' }, 'まだメモはありません。「＋ メモ」から日記やセッション記録を書けます。'),
        S.dayNotes.map((n) => noteCard(date, n)))));
  }

  function setAllOpen(open) {
    flushNotes();
    S.dayNotes.forEach((n) => { n._open = open; if (!open) n._edit = false; });
    renderDayPanel();
  }

  function applyTemplateVars(s, date) {
    const d = parseYmd(date);
    return s.replace(/\{\{(\w+)\}\}/g, (all, k) => ({
      date: `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`,
      year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(),
      weekday: WD_JP[d.getDay()],
    }[k] ?? all));
  }

  function newNoteMenu(date) {
    const wrap = h('div', { class: 'menu-wrap' });
    const menu = h('div', { class: 'menu', hidden: true },
      h('button', { onclick: () => addNote(date, '', '') }, '空のメモ'),
      S.config.templates.length ? h('div', { class: 'menu-label' }, 'テンプレートから') : null,
      S.config.templates.map((t) => h('button', { onclick: () => addNote(date, applyTemplateVars(t.title || t.name, date), applyTemplateVars(t.body, date)) }, t.name)));
    const btn = h('button', { class: 'btn small primary', onclick: (ev) => {
      ev.stopPropagation();
      menu.hidden = !menu.hidden;
      if (!menu.hidden) setTimeout(() => document.addEventListener('click', () => { menu.hidden = true; }, { once: true }));
    } }, '＋ メモ ▾');
    wrap.append(btn, menu);
    return wrap;
  }

  function addNote(date, title, body) {
    const note = Store.newNote(date, title, body);
    note._open = true;
    note._edit = true;
    S.dayNotes.push(note);
    renderDayPanel(); render();
    const cards = document.querySelectorAll('.note-card');
    const last = cards[cards.length - 1];
    if (last) { last.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); (title ? $('textarea', last) : $('input', last))?.focus(); }
  }

  function scheduleSave(note, statusEl, immediate) {
    clearTimeout(saveTimers.get(note.id)?.t);
    statusEl.textContent = '編集中…';
    const run = async () => {
      saveTimers.delete(note.id);
      try {
        const prevTitle = (Store.noteIndex()[note.date] || []).find((x) => x.id === note.id)?.title;
        await Store.saveNote(note);
        statusEl.textContent = '保存済み';
        if (prevTitle !== note.title) render();
      } catch (e) { statusEl.textContent = '保存できませんでした'; console.error(e); }
    };
    if (immediate) return run();
    saveTimers.set(note.id, { t: setTimeout(run, 500), run });
  }

  async function flushNotes() {
    const pending = [...saveTimers.values()];
    pending.forEach((p) => clearTimeout(p.t));
    await Promise.all(pending.map((p) => p.run()));
  }

  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.max(160, ta.scrollHeight + 4) + 'px'; }

  function noteCard(date, note) {
    const card = h('div', { class: 'note-card' });

    // ---- 閉じた状態：タイトルだけ
    if (!note._open) {
      card.classList.add('collapsed');
      card.append(h('button', {
        class: 'note-toggle', title: '開く',
        onclick: () => { note._open = true; if (!note.body.trim()) note._edit = true; renderDayPanel(); },
      }, h('span', { class: 'chev' }, '▸'), h('span', { class: 'nc-title' }, note.title || '（無題）'),
      note.title.includes('（衝突コピー）') ? h('span', { class: 'conflict-badge' }, '要確認') : null));
      return card;
    }

    // ---- 開いた状態
    let editing = note._edit || !note.body.trim();
    const status = h('span', { class: 'status' }, '');
    const titleIn = h('input', {
      class: 'note-title', value: note.title, placeholder: 'タイトル（例：日記、CoC「〇〇」第2話）',
      oninput: () => { note.title = titleIn.value; scheduleSave(note, status); },
    });
    const ta = h('textarea', {
      class: 'note-body', placeholder: 'Markdownで書けます。\n# 見出し  **太字**  - 箇条書き  - [ ] チェック  | 表 |',
      oninput: () => { note.body = ta.value; autoGrow(ta); scheduleSave(note, status); },
      onkeydown: (ev) => {
        if (ev.key === 'Tab') {
          ev.preventDefault();
          const s = ta.selectionStart;
          ta.setRangeText('  ', s, ta.selectionEnd, 'end');
          ta.dispatchEvent(new Event('input'));
        }
      },
    });
    ta.value = note.body;
    const preview = h('div', { class: 'md', onclick: (ev) => {
      const cb = ev.target.closest('input[data-task]');
      if (!cb) { if (!ev.target.closest('a')) setMode(true); return; }
      note.body = toggleTaskInMarkdown(note.body, Number(cb.dataset.task));
      ta.value = note.body;
      preview.innerHTML = renderMarkdown(note.body);
      scheduleSave(note, status, true);
    } });
    const modeBtn = h('button', { class: 'btn small' });

    function setMode(edit) {
      editing = edit;
      note._edit = edit;
      modeBtn.textContent = edit ? '👁 プレビュー' : '✎ 編集';
      ta.hidden = !edit;
      preview.hidden = edit;
      card.classList.toggle('editing', edit);
      if (edit) { requestAnimationFrame(() => autoGrow(ta)); } else { preview.innerHTML = renderMarkdown(note.body) || '<p class="muted">（本文なし・クリックで編集）</p>'; }
    }
    modeBtn.onclick = () => { setMode(!editing); if (editing) ta.focus(); };

    card.append(
      h('div', { class: 'note-head' },
        h('button', { class: 'icon-btn chev-btn', title: '閉じる', onclick: async () => {
          await flushNotes(); note._open = false; note._edit = false; renderDayPanel();
        } }, '▾'),
        titleIn,
        h('div', { class: 'note-actions' }, status, modeBtn,
          h('button', { class: 'icon-btn danger', title: 'このメモを削除', onclick: async () => {
            if (!confirm(`メモ「${note.title || '（無題）'}」を削除しますか？\n（Googleドライブではゴミ箱に移動します）`)) return;
            clearTimeout(saveTimers.get(note.id)?.t); saveTimers.delete(note.id);
            await Store.deleteNote(note.id);
            S.dayNotes = S.dayNotes.filter((x) => x.id !== note.id);
            renderDayPanel(); render();
          } }, '🗑'))),
      ta, preview);
    setMode(editing);
    return card;
  }

  // ============================================================ モーダル
  function openModal(title, content, footer, opts = {}) {
    const root = $('#modal-root');
    const close = () => { root.replaceChildren(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    const box = h('div', { class: 'modal' + (opts.wide ? ' wide' : '') },
      h('div', { class: 'mh' }, h('h2', null, title), h('button', { class: 'icon-btn', onclick: close, title: '閉じる' }, '×')),
      h('div', { class: 'mb' }, content),
      footer ? h('div', { class: 'mf' }, footer) : null);
    root.replaceChildren(h('div', { class: 'modal-backdrop', onmousedown: (ev) => { if (ev.target === ev.currentTarget) close(); } }, box));
    return close;
  }

  // ============================================================ 予定の編集
  function openEventEditor(ev, date) {
    const isNew = !ev;
    const base = date || S.openDate || todayStr();
    const e = ev ? JSON.parse(JSON.stringify(ev)) : {
      id: uid(), title: '', category: S.config.categories[0]?.id, start: base, end: base,
      startTime: '', endTime: '', tags: [], note: '',
    };
    const tagSet = new Set(e.tags || []);

    const title = h('input', { value: e.title, placeholder: '例：CoC「〇〇」第2話 / 打ち合わせ' });
    const catBox = h('div', { class: 'chips' });
    const drawCats = () => catBox.replaceChildren(...S.config.categories.map((c) =>
      toggleChip(c, e.category === c.id, () => { e.category = c.id; drawCats(); })));
    drawCats();
    const start = h('input', { type: 'date', value: e.start });
    const end = h('input', { type: 'date', value: e.end });
    start.addEventListener('change', () => { if (!end.value || end.value < start.value) end.value = start.value; });
    const st = h('input', { type: 'time', value: e.startTime || '' });
    const et = h('input', { type: 'time', value: e.endTime || '' });
    const tagBox = h('div', { class: 'chips' });
    const drawTags = () => tagBox.replaceChildren(...S.config.tags.map((t) =>
      toggleChip(t, tagSet.has(t.id), () => { tagSet.has(t.id) ? tagSet.delete(t.id) : tagSet.add(t.id); drawTags(); })),
    S.config.tags.length ? '' : h('span', { class: 'muted' }, '⚙設定でタグを作れます'));
    drawTags();
    const note = h('textarea', { rows: 3, placeholder: '場所・メンバー・持ち物など（任意）' });
    note.value = e.note || '';

    const err = h('p', { class: 'err' });
    const save = async () => {
      if (!title.value.trim()) { err.textContent = '予定名を入れてください'; title.focus(); return; }
      if (!start.value) { err.textContent = '開始日を入れてください'; return; }
      const endV = end.value || start.value;
      if (endV < start.value) { err.textContent = '終了日が開始日より前になっています'; return; }
      if (endV === start.value && st.value && et.value && et.value < st.value) { err.textContent = '終了時刻が開始時刻より前です'; return; }
      Object.assign(e, {
        title: title.value.trim(), start: start.value, end: endV,
        startTime: st.value, endTime: et.value, tags: [...tagSet].filter(tagById), note: note.value,
      });
      const i = S.events.findIndex((x) => x.id === e.id);
      if (i >= 0) S.events[i] = e; else S.events.push(e);
      close();
      render(); if (S.openDate) renderDayPanel();
      await saveEvents();
      toast(isNew ? '予定を追加しました' : '予定を保存しました');
    };
    const del = async () => {
      if (!confirm(`予定「${e.title}」を削除しますか？`)) return;
      S.events = S.events.filter((x) => x.id !== e.id);
      close();
      render(); if (S.openDate) renderDayPanel();
      await saveEvents();
      toast('予定を削除しました');
    };

    const form = h('form', { class: 'form', onsubmit: (x) => { x.preventDefault(); save(); } },
      h('label', null, h('span', null, '予定名'), title),
      h('label', null, h('span', null, '区分'), catBox),
      h('div', { class: 'grid2' },
        h('label', null, h('span', null, '開始日'), start),
        h('label', null, h('span', null, '終了日'), end)),
      h('div', { class: 'grid2' },
        h('label', null, h('span', null, '開始時刻（任意）'), h('div', { class: 'time-row' }, st, h('button', { type: 'button', class: 'btn small ghost', onclick: () => { st.value = ''; } }, 'クリア'))),
        h('label', null, h('span', null, '終了時刻（任意）'), h('div', { class: 'time-row' }, et, h('button', { type: 'button', class: 'btn small ghost', onclick: () => { et.value = ''; } }, 'クリア')))),
      h('label', null, h('span', null, 'タグ'), tagBox),
      h('label', null, h('span', null, 'ひとことメモ'), note),
      err,
      h('button', { type: 'submit', hidden: true }));

    const close = openModal(isNew ? '予定を追加' : '予定を編集', form, [
      isNew ? null : h('button', { class: 'btn danger', onclick: del }, '削除'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => close() }, 'キャンセル'),
      h('button', { class: 'btn primary', onclick: save }, '保存'),
    ]);
    setTimeout(() => title.focus(), 30);
  }

  // ============================================================ 検索
  function openSearch() {
    const q = h('input', { type: 'search', placeholder: 'メモ本文・予定名を検索（空欄ならタグだけで絞り込み）' });
    const tagSel = new Set(S.filter.tags);
    const tagBox = h('div', { class: 'chips' });
    const drawTags = () => tagBox.replaceChildren(...S.config.tags.map((t) =>
      toggleChip(t, tagSel.has(t.id), () => { tagSel.has(t.id) ? tagSel.delete(t.id) : tagSel.add(t.id); drawTags(); run(); })));
    drawTags();
    const results = h('div', { class: 'results' });
    let seq = 0;

    const jump = (date) => {
      close();
      S.cursor = parseYmd(date);
      render();
      openDay(date);
    };

    async function run() {
      const my = ++seq;
      const text = q.value.trim().toLowerCase();
      if (!text && !tagSel.size) { results.replaceChildren(h('p', { class: 'muted' }, 'キーワードを入れるか、タグを選んでください。')); return; }
      const tagOk = (ids) => !tagSel.size || (ids || []).some((t) => tagSel.has(t));
      const evs = S.events.filter((e) => tagOk(e.tags) &&
        (!text || e.title.toLowerCase().includes(text) || (e.note || '').toLowerCase().includes(text)))
        .sort((a, b) => b.start.localeCompare(a.start));
      let notes = text ? Store.search(text) : [];
      if (my !== seq) return;
      if (tagSel.size) {
        if (text) notes = notes.filter((n) => tagOk(S.daytags[n.date]));
        else {
          notes = Object.keys(S.daytags).filter((d) => tagOk(S.daytags[d])).sort().reverse()
            .flatMap((d) => (S.notesIndex[d] || [{ id: '', title: '' }]).map((n) => ({ date: d, id: n.id, title: n.id ? n.title : '', snippet: n.id ? '' : '（メモなし）' })));
        }
      }
      const tagsOf = (d) => (S.daytags[d] || []).map(tagById).filter(Boolean).map((t) => tagChip(t, { small: true }));
      results.replaceChildren(...[
        h('h3', null, `予定（${evs.length}件）`),
        evs.length ? evs.slice(0, 200).map((e) => h('button', { class: 'result', onclick: () => jump(e.start) },
          h('span', { class: 'rdate' }, e.start === e.end ? fmtShort(e.start) : `${fmtShort(e.start)}〜${fmtShort(e.end)}`),
          h('span', { class: 'rtitle', style: { borderLeftColor: catById(e.category).color } }, e.title),
          h('span', { class: 'chips' }, (e.tags || []).map(tagById).filter(Boolean).map((t) => tagChip(t, { small: true }))))) : h('p', { class: 'muted' }, 'なし'),
        h('h3', null, text ? `メモ（${notes.length}件）` : `タグの付いた日（${new Set(notes.map((n) => n.date)).size}日）`),
        notes.length ? notes.slice(0, 300).map((n) => h('button', { class: 'result', onclick: () => jump(n.date) },
          h('span', { class: 'rdate' }, `${n.date.slice(0, 4)}/${fmtShort(n.date)}`),
          h('span', { class: 'rtitle' }, n.id ? '📝 ' + (n.title || '（無題）') : ''),
          h('span', { class: 'chips' }, tagsOf(n.date)),
          n.snippet ? h('span', { class: 'snippet' }, n.snippet) : null)) : h('p', { class: 'muted' }, 'なし'),
      ].flat().filter(Boolean));
    }
    let timer;
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 250); });
    const close = openModal('検索', h('div', { class: 'form' },
      q, h('div', null, h('span', { class: 'flabel' }, 'タグ'), tagBox), results), null, { wide: true });
    run();
    setTimeout(() => q.focus(), 30);
  }

  // ============================================================ 設定
  function openSettings(initialTab = 'tags') {
    const cfg = JSON.parse(JSON.stringify(S.config));
    let tab = initialTab;
    let tplSel = cfg.templates[0]?.id || null;
    const body = h('div', { class: 'settings' });
    const tabs = h('div', { class: 'tabs' });

    const usage = (tagId) => S.events.filter((e) => (e.tags || []).includes(tagId)).length +
      Object.values(S.daytags).filter((v) => v.includes(tagId)).length;
    const catUsage = (cid) => S.events.filter((e) => e.category === cid).length;

    function colorRow(item, list, opts) {
      return h('div', { class: 'srow' },
        h('input', { type: 'color', value: item.color, oninput: (ev) => { item.color = ev.target.value; draw(); } }),
        h('input', { class: 'grow', value: item.name, placeholder: '名前', onchange: (ev) => { item.name = ev.target.value.trim() || item.name; draw(); } }),
        h('span', { class: 'chip small', style: { background: item.color, color: textOn(item.color) } }, item.name),
        h('span', { class: 'muted small-text' }, opts.usage(item.id) + '件で使用'),
        h('button', { class: 'icon-btn', title: '上へ', onclick: () => { const i = list.indexOf(item); if (i > 0) { list.splice(i, 1); list.splice(i - 1, 0, item); draw(); } } }, '↑'),
        h('button', { class: 'icon-btn danger', title: '削除', onclick: () => {
          if (opts.min && list.length <= opts.min) { alert('最低1つは必要です'); return; }
          const n = opts.usage(item.id);
          if (n && !confirm(`「${item.name}」は ${n} 件で使われています。削除すると${opts.what}。\nよろしいですか？（保存するまで確定しません）`)) return;
          list.splice(list.indexOf(item), 1); draw();
        } }, '🗑'));
    }

    function draw() {
      tabs.replaceChildren(...[['tags', 'タグ'], ['cats', '区分'], ['tpl', 'テンプレート'], ['other', 'その他・エクスポート']].map(([k, label]) =>
        h('button', { class: tab === k ? 'active' : '', onclick: () => { tab = k; draw(); } }, label)));
      if (tab === 'tags') {
        body.replaceChildren(...flatKids(
          h('p', { class: 'muted' }, 'タグは「日付」と「予定」の両方に付けられます。色・名前を変えると、付けた所すべてに反映されます。'),
          cfg.tags.map((t) => colorRow(t, cfg.tags, { usage, what: '付いている予定・日付からも外れます' })),
          h('button', { class: 'btn', onclick: () => {
            const colors = ['#7c3aed', '#e11d48', '#d97706', '#0891b2', '#16a34a', '#db2777', '#4f46e5', '#65a30d'];
            cfg.tags.push({ id: uid(), name: '新しいタグ', color: colors[cfg.tags.length % colors.length] }); draw();
            const ins = body.querySelectorAll('input.grow'); ins[ins.length - 1]?.select();
          } }, '＋ タグを追加')));
      } else if (tab === 'cats') {
        body.replaceChildren(...flatKids(
          h('p', { class: 'muted' }, '予定の区分です（予定の色になります）。削除すると、その区分の予定は一番下の区分に移ります。'),
          cfg.categories.map((c) => colorRow(c, cfg.categories, { usage: catUsage, min: 1, what: '予定は別の区分に移ります' })),
          h('button', { class: 'btn', onclick: () => { cfg.categories.push({ id: uid(), name: '新しい区分', color: '#0891b2' }); draw(); } }, '＋ 区分を追加')));
      } else if (tab === 'tpl') {
        const t = cfg.templates.find((x) => x.id === tplSel);
        const list = h('div', { class: 'tpl-list' },
          cfg.templates.map((x) => h('button', { class: x.id === tplSel ? 'active' : '', onclick: () => { tplSel = x.id; draw(); } }, x.name || '（名前なし）')),
          h('button', { class: 'add', onclick: () => { const n = { id: uid(), name: '新しいテンプレート', title: '', body: '' }; cfg.templates.push(n); tplSel = n.id; draw(); } }, '＋ 追加'));
        const editor = t ? h('div', { class: 'tpl-edit form' },
          h('label', null, h('span', null, 'テンプレート名（メニューに表示）'), h('input', { value: t.name, oninput: (ev) => { t.name = ev.target.value; list.querySelector('.active').textContent = t.name || '（名前なし）'; } })),
          h('label', null, h('span', null, 'メモのタイトル'), h('input', { value: t.title || '', placeholder: '空欄ならテンプレート名', oninput: (ev) => { t.title = ev.target.value; } })),
          h('label', null, h('span', null, '本文（Markdown）'), (() => { const ta = h('textarea', { rows: 14, class: 'mono', oninput: (ev) => { t.body = ev.target.value; } }); ta.value = t.body; return ta; })()),
          h('p', { class: 'muted small-text' }, '使える差し込み: {{date}} → 2026/11/16、{{year}} {{month}} {{day}} {{weekday}} → 月'),
          h('div', { class: 'row-end' },
            h('button', { class: 'btn small', onclick: () => { const i = cfg.templates.indexOf(t); if (i > 0) { cfg.templates.splice(i, 1); cfg.templates.splice(i - 1, 0, t); draw(); } } }, '↑ 上へ'),
            h('button', { class: 'btn small danger', onclick: () => { if (!confirm(`テンプレート「${t.name}」を削除しますか？`)) return; cfg.templates.splice(cfg.templates.indexOf(t), 1); tplSel = cfg.templates[0]?.id || null; draw(); } }, '削除')))
          : h('p', { class: 'muted' }, 'テンプレートがありません。');
        body.replaceChildren(h('div', { class: 'tpl' }, list, editor));
      } else {
        const viewSel = h('select', { onchange: (ev) => { cfg.settings.defaultView = ev.target.value; } },
          [['month', '月'], ['week', '週'], ['list', '一覧']].map(([v, l]) => h('option', { value: v, selected: (cfg.settings.defaultView || 'month') === v }, l)));
        body.replaceChildren(h('div', { class: 'form' },
          h('label', null, h('span', null, '起動時の表示'), viewSel),
          syncSection(),
          h('div', null, h('h3', null, 'エクスポート（バックアップ）'),
            h('div', { class: 'row-start' },
              h('button', { class: 'btn', onclick: exportZip }, '全データをZIPで保存'),
              h('button', { class: 'btn', onclick: exportMarkdown }, 'メモを1つのMarkdownにまとめて保存'),
              h('button', { class: 'btn', onclick: exportCsv }, '予定をCSVで保存'))),
          h('div', null, h('h3', null, 'この端末のデータ'),
            h('p', { class: 'muted small-text' }, '友人の端末などで一時的に使ったあとに。Googleドライブ上のデータは消えません。'),
            h('button', { class: 'btn danger', onclick: wipeDevice }, 'この端末からデータを消してログアウト'))));
      }
    }
    draw();

    const close = openModal('設定', h('div', null, tabs, body), [
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => close() }, 'キャンセル'),
      h('button', { class: 'btn primary', onclick: async () => {
        // 消えたタグ・区分の後始末
        const tagIds = new Set(cfg.tags.map((t) => t.id));
        const catIds = new Set(cfg.categories.map((c) => c.id));
        const fallbackCat = cfg.categories[cfg.categories.length - 1].id;
        let evChanged = false, dtChanged = false;
        for (const e of S.events) {
          const tags = (e.tags || []).filter((t) => tagIds.has(t));
          if (tags.length !== (e.tags || []).length) { e.tags = tags; evChanged = true; }
          if (!catIds.has(e.category)) { e.category = fallbackCat; evChanged = true; }
        }
        for (const [d, v] of Object.entries(S.daytags)) {
          const nv = v.filter((t) => tagIds.has(t));
          if (nv.length !== v.length) { dtChanged = true; if (nv.length) S.daytags[d] = nv; else delete S.daytags[d]; }
        }
        [...S.filter.tags].forEach((t) => { if (!tagIds.has(t)) S.filter.tags.delete(t); });
        [...S.filter.cats].forEach((c) => { if (!catIds.has(c)) S.filter.cats.delete(c); });
        S.config = cfg;
        close();
        render(); if (!$('#filterbar').hidden) renderFilterbar(); if (S.openDate) renderDayPanel();
        await saveConfig();
        if (evChanged) await saveEvents();
        if (dtChanged) await saveDaytags();
        toast('設定を保存しました');
      } }, '保存'),
    ], { wide: true });
  }

  function download(name, text, type) {
    const blob = new Blob(['﻿' + text], { type });
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function exportMarkdown() {
    const idx = S.notesIndex;
    const dates = Object.keys(idx).sort();
    let out = '# こよみ帳 メモ一覧\n\n';
    for (const d of dates) {
      const notes = Store.notesOn(d);
      const tags = (S.daytags[d] || []).map(tagById).filter(Boolean).map((t) => '#' + t.name).join(' ');
      out += `\n---\n\n# ${fmtDate(d)}${tags ? '  ' + tags : ''}\n\n`;
      for (const n of notes) out += `## ${n.title || '（無題）'}\n\n${n.body.trim()}\n\n`;
    }
    download(`koyomicho-notes-${todayStr()}.md`, out, 'text/markdown');
  }

  function exportCsv() {
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const rows = [['開始日', '終了日', '開始時刻', '終了時刻', '予定名', '区分', 'タグ', 'メモ'].map(q).join(',')];
    for (const e of [...S.events].sort((a, b) => a.start.localeCompare(b.start))) {
      rows.push([e.start, e.end, e.startTime, e.endTime, e.title, catById(e.category).name,
        (e.tags || []).map(tagById).filter(Boolean).map((t) => t.name).join(' '), e.note].map(q).join(','));
    }
    download(`koyomicho-events-${todayStr()}.csv`, rows.join('\r\n'), 'text/csv');
  }

  function exportZip() {
    const files = [
      { name: 'koyomicho/config.json', text: JSON.stringify(S.config, null, 2) },
      { name: 'koyomicho/events.json', text: JSON.stringify(S.events, null, 2) },
      { name: 'koyomicho/daytags.json', text: JSON.stringify(S.daytags, null, 2) },
      ...Store.allNotesForExport().map((n) => ({ name: 'koyomicho/' + n.file, text: n.text })),
    ];
    const blob = makeZip(files);
    const a = h('a', { href: URL.createObjectURL(blob), download: `koyomicho-backup-${todayStr()}.zip` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function wipeDevice() {
    const st = Store.status();
    if (st.pending && !confirm(`まだGoogleドライブに送っていない変更が ${st.pending} 件あります。消すと失われます。\nそれでも消しますか？`)) return;
    if (!confirm('この端末のこよみ帳データを消してログアウトします。よろしいですか？')) return;
    await Store.wipeLocal();
    localStorage.clear();
    location.reload();
  }

  // ============================================================ 同期の表示
  const SYNC_LABEL = {
    local: ['📱', '端末のみ', 'Googleドライブとの同期は未設定です（config.js）'],
    notConnected: ['☁', 'Googleに接続', 'タップしてGoogleドライブと同期を始めます'],
    needAuth: ['☁', '再接続', 'Googleの接続が切れました。タップで再接続（書いた内容はこの端末に保存されています）'],
    offline: ['⛅', 'オフライン', 'ネットに戻ったら自動で同期します'],
    syncing: ['⟳', '同期中', '同期しています…'],
    pending: ['☁', '未送信', 'まもなく同期します（タップで今すぐ）'],
    synced: ['☁', '同期済み', 'Googleドライブと同期済み（タップで今すぐ同期）'],
    error: ['⚠', '同期エラー', ''],
  };

  function renderSyncChip(st = Store.status()) {
    const chip = $('#sync-chip');
    const [icon, label, tip] = SYNC_LABEL[st.state] || SYNC_LABEL.local;
    const pend = st.pending && st.state !== 'synced' ? ` ${st.pending}` : '';
    chip.replaceChildren(h('span', { class: 'si' + (st.state === 'syncing' ? ' spin' : '') }, icon), h('span', { class: 'sl' }, label + pend));
    chip.className = 'sync-chip s-' + st.state;
    chip.title = st.state === 'error' ? '同期できませんでした: ' + st.message + '（タップで再試行）'
      : tip + (st.lastSync ? `\n最終同期: ${new Date(st.lastSync).toLocaleString('ja-JP')}` : '');
  }

  async function onSyncChip() {
    const st = Store.status();
    if (st.state === 'local') { openSettings('other'); return; }
    if (st.state === 'notConnected' || st.state === 'needAuth') {
      try { await Store.connect(); toast('Googleドライブにつながりました'); } catch (e) { toast(e.message, true); }
      return;
    }
    if (st.state === 'offline') { toast('オフラインです。ネットに戻ったら自動で同期します'); return; }
    Store.sync();
  }

  function syncSection() {
    const st = Store.status();
    const box = h('div', { class: 'info' });
    const [, label] = SYNC_LABEL[st.state] || SYNC_LABEL.local;
    if (!Store.configured()) {
      box.append(
        h('p', null, h('b', null, '保存先： '), 'この端末のみ'),
        h('p', { class: 'muted small-text' }, 'Googleドライブと同期するには、config.js にクライアントIDを設定してください（手順は SETUP.md）。'));
    } else {
      box.append(
        h('p', null, h('b', null, '保存先： '), 'Googleドライブの「こよみ帳」フォルダ（＋この端末）'),
        h('p', null, h('b', null, '状態： '), label + (st.pending ? `（未送信 ${st.pending} 件）` : ''),
          st.lastSync ? h('span', { class: 'muted small-text' }, `　最終同期 ${new Date(st.lastSync).toLocaleString('ja-JP')}`) : null),
        st.state === 'error' ? h('p', { class: 'err' }, st.message) : null,
        h('div', { class: 'row-start' },
          (st.state === 'notConnected' || st.state === 'needAuth')
            ? h('button', { class: 'btn primary', onclick: async () => { try { await Store.connect(); toast('Googleドライブにつながりました'); } catch (e) { toast(e.message, true); } } }, 'Googleに接続')
            : h('button', { class: 'btn', onclick: () => Store.sync() }, '今すぐ同期'),
          (st.state !== 'notConnected') ? h('button', { class: 'btn ghost', onclick: () => {
            if (!confirm('Googleとの接続を切ります（データはこの端末とドライブの両方に残ります）')) return;
            Store.disconnect(); toast('接続を切りました');
          } }, '接続を切る') : null));
    }
    return h('div', null, h('h3', null, '同期'), box);
  }

  function onRemoteChange() {
    render();
    if (!S.openDate) return;
    const panel = $('#daypanel');
    if (panel.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return; // 入力中は邪魔しない
    const open = new Map(S.dayNotes.map((n) => [n.id, { o: n._open, e: n._edit }]));
    S.dayNotes = Store.notesOn(S.openDate);
    S.dayNotes.forEach((n) => { const f = open.get(n.id); n._open = f ? f.o : false; n._edit = f ? f.e : false; });
    renderDayPanel();
  }

  // ============================================================ 起動
  async function init() {
    await Store.init();
    S.view = S.config.settings?.defaultView || 'month';
    Store.onStatus(renderSyncChip);
    Store.onChange(onRemoteChange);
    renderSyncChip();
    $('#sync-chip').onclick = onSyncChip;

    $('#prev').onclick = () => move(-1);
    $('#next').onclick = () => move(1);
    $('#today').onclick = () => { S.cursor = new Date(); render(); };
    document.querySelectorAll('.views button').forEach((b) => { b.onclick = () => { S.view = b.dataset.view; render(); }; });
    $('#btn-add').onclick = () => openEventEditor(null);
    $('#btn-settings').onclick = () => openSettings();
    $('#btn-search').onclick = openSearch;
    $('#btn-filter').onclick = () => {
      const fb = $('#filterbar');
      fb.hidden = !fb.hidden;
      if (!fb.hidden) renderFilterbar();
      renderTitle();
    };
    $('#panel-backdrop').onclick = closeDay;

    document.addEventListener('keydown', (ev) => {
      if ($('#modal-root').children.length) return;
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 's') { ev.preventDefault(); flushNotes().then(() => toast('保存しました')); return; }
      if (ev.key === 'Escape' && S.openDate) { closeDay(); return; }
      if (typing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.key === 'ArrowLeft') move(-1);
      else if (ev.key === 'ArrowRight') move(1);
      else if (ev.key === 't') { S.cursor = new Date(); render(); }
    });
    window.addEventListener('beforeunload', (ev) => { if (saveTimers.size) { flushNotes(); ev.preventDefault(); ev.returnValue = ''; } });
    let rt;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 150); });

    render();
  }

  init().catch((e) => {
    console.error(e);
    document.body.append(h('div', { class: 'fatal' }, '起動できませんでした: ' + e.message));
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !window.KOYOMI_TEST) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  }
})();
