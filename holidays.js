// 日本の祝日計算（振替休日・国民の休日を含む）。インターネット不要。
(function () {
  'use strict';
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

  function nthMonday(y, m, n) {
    const first = new Date(y, m - 1, 1);
    return new Date(y, m - 1, 1 + ((8 - first.getDay()) % 7) + (n - 1) * 7);
  }

  function compute(y) {
    const H = new Map();
    const add = (m, d, name) => H.set(ymd(new Date(y, m - 1, d)), name);
    const addD = (dt, name) => H.set(ymd(dt), name);
    const k = Math.floor((y - 1980) / 4);

    add(1, 1, '元日');
    if (y >= 2000) addD(nthMonday(y, 1, 2), '成人の日'); else add(1, 15, '成人の日');
    add(2, 11, '建国記念の日');
    if (y >= 2020) add(2, 23, '天皇誕生日');
    else if (y >= 1989 && y <= 2018) add(12, 23, '天皇誕生日');
    add(3, Math.floor(20.8431 + 0.242194 * (y - 1980) - k), '春分の日');
    add(4, 29, y >= 2007 ? '昭和の日' : 'みどりの日');
    add(5, 3, '憲法記念日');
    if (y >= 2007) add(5, 4, 'みどりの日');
    add(5, 5, 'こどもの日');
    if (y === 2020) add(7, 23, '海の日');
    else if (y === 2021) add(7, 22, '海の日');
    else if (y >= 2003) addD(nthMonday(y, 7, 3), '海の日');
    else if (y >= 1996) add(7, 20, '海の日');
    if (y === 2020) add(8, 10, '山の日');
    else if (y === 2021) add(8, 8, '山の日');
    else if (y >= 2016) add(8, 11, '山の日');
    if (y >= 2003) addD(nthMonday(y, 9, 3), '敬老の日'); else add(9, 15, '敬老の日');
    add(9, Math.floor(23.2488 + 0.242194 * (y - 1980) - k), '秋分の日');
    const sports = y >= 2020 ? 'スポーツの日' : '体育の日';
    if (y === 2020) add(7, 24, sports);
    else if (y === 2021) add(7, 23, sports);
    else if (y >= 2000) addD(nthMonday(y, 10, 2), sports);
    else add(10, 10, sports);
    add(11, 3, '文化の日');
    add(11, 23, '勤労感謝の日');
    if (y === 2019) { add(5, 1, '天皇の即位の日'); add(10, 22, '即位礼正殿の儀'); }

    // 国民の休日（祝日に挟まれた平日）
    for (const key of [...H.keys()].sort()) {
      const d = parse(key);
      if (H.has(ymd(addDays(d, 2)))) {
        const mid = addDays(d, 1);
        if (!H.has(ymd(mid)) && mid.getDay() !== 0) H.set(ymd(mid), '国民の休日');
      }
    }
    // 振替休日（日曜の祝日の次の平日）
    for (const key of [...H.keys()].sort()) {
      const d = parse(key);
      if (d.getDay() === 0) {
        let n = addDays(d, 1);
        while (H.has(ymd(n))) n = addDays(n, 1);
        H.set(ymd(n), '振替休日');
      }
    }
    return H;
  }

  const cache = new Map();
  window.holidayName = function (dateStr) {
    const y = Number(dateStr.slice(0, 4));
    if (!cache.has(y)) cache.set(y, compute(y));
    return cache.get(y).get(dateStr) || '';
  };
})();
