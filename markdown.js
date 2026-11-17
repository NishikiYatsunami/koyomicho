// 軽量Markdownレンダラー（外部ライブラリなし）
// 対応: 見出し / 太字 / 斜体 / 取り消し線 / コード / コードブロック / 引用 / 箇条書き /
//       番号付きリスト / チェックボックス / 表 / 水平線 / リンク / 改行
(function () {
  'use strict';
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ESC[c]);

  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    s = esc(s);
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
    s = s.replace(/(^|[\s(（])(https?:\/\/[^\s<）)]+)/g,
      '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\s](?:[^*]*?[^*\s])?)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
    return s;
  }

  const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const isFence = (l) => /^\s*```/.test(l);
  const isHeading = (l) => /^#{1,6}\s+/.test(l);
  const isHr = (l) => /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
  const isQuote = (l) => /^\s*>/.test(l);
  const isTableStart = (lines, i) =>
    /\|/.test(lines[i]) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1]);
  const isBlockStart = (lines, i) =>
    isFence(lines[i]) || isHeading(lines[i]) || isHr(lines[i]) || isQuote(lines[i]) ||
    LIST_RE.test(lines[i]) || isTableStart(lines, i);

  function render(src, ctx) {
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === '') { i++; continue; }
      if (isFence(line)) {
        const buf = []; i++;
        while (i < lines.length && !isFence(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
        continue;
      }
      let m = line.match(/^(#{1,6})\s+(.*)$/);
      if (m) { const n = m[1].length; out.push(`<h${n}>${inline(m[2])}</h${n}>`); i++; continue; }
      if (isHr(line)) { out.push('<hr>'); i++; continue; }
      if (isQuote(line)) {
        const buf = [];
        while (i < lines.length && isQuote(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        out.push(`<blockquote>${render(buf.join('\n'), { task: -1e9 })}</blockquote>`);
        continue;
      }
      if (isTableStart(lines, i)) {
        const row = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
        const head = row(lines[i]); i += 2;
        let html = '<div class="table-wrap"><table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== '') {
          html += '<tr>' + row(lines[i]).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>'; i++;
        }
        out.push(html + '</tbody></table></div>');
        continue;
      }
      if (LIST_RE.test(line)) {
        const r = list(lines, i, indentOf(line), ctx);
        out.push(r.html); i = r.i; continue;
      }
      const buf = [line]; i++;
      while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines, i)) { buf.push(lines[i]); i++; }
      out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
    }
    return out.join('\n');
  }

  const indentOf = (l) => l.match(/^(\s*)/)[1].replace(/\t/g, '    ').length;

  function list(lines, i, base, ctx) {
    const ordered = /\d/.test(lines[i].match(LIST_RE)[2]);
    let html = ordered ? '<ol>' : '<ul>';
    let open = false;
    while (i < lines.length) {
      const m = lines[i].match(LIST_RE);
      if (!m) break;
      const ind = indentOf(lines[i]);
      if (ind < base) break;
      if (ind > base) {
        const r = list(lines, i, ind, ctx);
        if (open) { html = html.slice(0, -5) + r.html + '</li>'; } else { html += '<li>' + r.html + '</li>'; }
        i = r.i; continue;
      }
      const cb = m[3].match(/^\[( |x|X)\](?:\s+(.*))?$/);
      if (cb) {
        const idx = ctx.task++;
        const checked = cb[1] !== ' ';
        html += `<li class="task${checked ? ' done' : ''}"><input type="checkbox" data-task="${idx}"${checked ? ' checked' : ''}${idx < 0 ? ' disabled' : ''}> <span>${inline(cb[2] || '')}</span></li>`;
      } else {
        html += `<li>${inline(m[3])}</li>`;
      }
      open = true; i++;
    }
    return { html: html + (ordered ? '</ol>' : '</ul>'), i };
  }

  window.renderMarkdown = (src) => render(src || '', { task: 0 });

  // プレビューのチェックボックスをクリックしたとき、元のMarkdownの n 番目の [ ] / [x] を切り替える
  window.toggleTaskInMarkdown = function (src, n) {
    const lines = src.split('\n');
    let count = 0, inFence = false;
    for (let i = 0; i < lines.length; i++) {
      if (isFence(lines[i])) { inFence = !inFence; continue; }
      if (inFence || isQuote(lines[i])) continue;
      const m = lines[i].match(/^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\](.*)$/);
      if (m) {
        if (count === n) { lines[i] = m[1] + (m[2] === ' ' ? '[x]' : '[ ]') + m[3]; break; }
        count++;
      }
    }
    return lines.join('\n');
  };
})();
