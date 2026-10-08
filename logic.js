// Pure functies zonder DOM, zodat ze ook in Node getest kunnen worden.

export const KNOWN_STREAK = 3;

const DUTCH_ARTICLES = /^(de|het|een|'t)\s+/;

export function normalize(s) {
  return String(s ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,!?;:]+|[\s.,!?;:]+$/g, '')
    .replace(/\s*'\s*/g, "'")
    .trim();
}

export function stripAccents(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae');
}

// Alle geldige schrijfwijzen van een antwoord, bijv. "(se) laver / se laver".
export function answerVariants(key, lang) {
  const out = new Set();
  // Het volledige antwoord telt ook, naast elk alternatief los.
  for (const alt of [String(key), ...String(key).split(/[\/;,]/)]) {
    const base = normalize(alt);
    if (!base) continue;
    const forms = [
      base,
      normalize(base.replace(/\([^)]*\)/g, ' ')),
      normalize(base.replace(/[()]/g, '')),
    ];
    for (const f of forms) {
      if (!f) continue;
      out.add(f);
      if (lang === 'nl') out.add(f.replace(DUTCH_ARTICLES, ''));
    }
  }
  return [...out].filter(Boolean);
}

// Geeft 'correct', 'accent' (alleen accenten verkeerd, telt als goed) of 'wrong'.
export function checkAnswer(input, key, lang) {
  let given = normalize(input);
  if (!given) return 'wrong';
  const variants = answerVariants(key, lang);
  const givenForms = [given];
  if (lang === 'nl') givenForms.push(given.replace(DUTCH_ARTICLES, ''));
  if (variants.some((v) => givenForms.includes(v))) return 'correct';
  const loose = givenForms.map(stripAccents);
  if (variants.some((v) => loose.includes(stripAccents(v)))) return 'accent';
  // Spaties tellen niet mee: de scan plakt soms woorden aan elkaar ("weeten").
  const tight = (x) => x.replace(/\s+/g, '');
  if (variants.some((v) => givenForms.some((g) => tight(g) === tight(v)))) return 'correct';
  if (variants.some((v) => loose.some((g) => tight(g) === tight(stripAccents(v))))) return 'accent';
  return 'wrong';
}

const LEADING_JUNK = /^\s*(\d+[.)]?|[•·*•▪●–—-]|[OoQ0](?=\s))\s+/;
const SEPARATOR = /\s*(?:=|\t|;|\s[-–—]\s|:)\s*/;

export function cleanCell(s) {
  const t = String(s ?? '')
    .replace(/[|_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LEADING_JUNK, '');
  // Een losse punt achter één woord is meestal ruis van de scan ("iets.").
  return /^\S+\.$/.test(t) && !/\.\S/.test(t) ? t.slice(0, -1) : t;
}

// Zinnen (voorbeeldzinnen in het boek) herkennen we aan leestekens aan het eind
// of aan een hoofdletter met minstens drie woorden.
export function isSentence(text) {
  const t = String(text ?? '').trim();
  if (!t) return false;
  if (/[?!.]$/.test(t)) return true;
  // Woordjes bevatten geen cijfers; "Il a 15 ans", telefoonnummers en paginanummers wel.
  if (/\d/.test(t)) return true;
  return /^\p{Lu}/u.test(t) && t.split(/\s+/).length >= 3;
}

// "école = school" per regel. leftIsFr bepaalt welke kant Frans is.
export function parseText(text, leftIsFr = true) {
  const pairs = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(SEPARATOR);
    let left = line;
    let right = '';
    if (m) {
      left = line.slice(0, m.index);
      right = line.slice(m.index + m[0].length);
    }
    left = cleanCell(left);
    right = cleanCell(right);
    if (!left && !right) continue;
    pairs.push(leftIsFr ? { fr: left, nl: right } : { fr: right, nl: left });
  }
  return pairs;
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Bolletjes/vakjes vóór elk woord in lesboeken leest OCR als ©, @, O, ® enz.
// Losse tekens zonder betekenis tellen we ook als zo'n markering.
const MARKER_CHARS = '©®@°•●○◯⊙◉øØ¢€$£%&#*';
const KEEP_SINGLE = /^[a-zàâäéèêëîïôöùûüçy]$/; // a, y, à enz. zijn echte woorden
const HEADER = /^(frans|nederlands|fran[cç]ais|n[eé]erlandais)$/i;

// Kolomkoppen ("Frans", "Nederlands") hebben geen bolletje; het woordje "Frans"
// (français = Frans) wel. OCR maakt van koppen soms "Nederlang,".
function isHeader(c) {
  if (c.marked) return false;
  const t = c.text.replace(/[^\p{L}]/gu, '');
  return HEADER.test(t) || (t.length >= 7 && similar(t, 'nederlands'));
}

function isMarker(text) {
  const t = text.trim();
  if (!t) return true;
  if ([...t].every((c) => MARKER_CHARS.includes(c))) return true;
  if (t === '/' || t === ',') return false; // betekenisvol: "Hallo / Hoi"
  if (/^[\/,]$/.test(t)) return false;
  if (/^(o|O|0|Q|Ô|ô|DO?|O\W?|\W+)$/.test(t)) return true;
  return [...t].length === 1 && !KEEP_SINGLE.test(t);
}

function stripMarkerPrefix(text) {
  return text.replace(new RegExp(`^[${MARKER_CHARS}]+`), '');
}

// OCR plakt soms twee woorden aan elkaar ("lamer"). Een opvallend grote ruimte
// tussen twee letters verraadt dan de gemiste spatie.
function splitGlued(w) {
  const s = w.symbols;
  if (!s || s.length < 4) return [w];
  const h = w.bbox.y1 - w.bbox.y0;
  const gaps = s.slice(1).map((x, i) => x.bbox.x0 - s[i].bbox.x1);
  const limit = Math.max(0.3 * h, 2.5 * Math.max(median(gaps), 3));
  const parts = [];
  let start = 0;
  gaps.forEach((g, i) => {
    // Geen losse letter afsplitsen ("F rans"), elk deel minstens twee tekens.
    if (g >= limit && i + 1 - start >= 2 && s.length - (i + 1) >= 2) {
      parts.push(s.slice(start, i + 1));
      start = i + 1;
    }
  });
  parts.push(s.slice(start));
  if (parts.length === 1) return [w];
  return parts.map((ps) => ({
    text: ps.map((x) => x.text).join(''),
    confidence: w.confidence,
    bbox: { x0: ps[0].bbox.x0, x1: ps[ps.length - 1].bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1 },
  }));
}

// Letterbreedtes (ongeveer, gewoon lettertype) om te schatten na welke letter
// een gevonden spatie valt; de letterposities van Tesseract zijn te onnauwkeurig.
function charWidth(ch) {
  if (/[ijlftr.,'’!:;|]/.test(ch)) return 0.55;
  if (/[mwMW]/.test(ch)) return 1.5;
  if (/\p{Lu}/u.test(ch)) return 1.2;
  return 1;
}

// Splitst een woord op een witruimte in de pixels zelf. cols[i] is true als
// kolom i (vanaf bbox.x0) inkt bevat. Een spatie is een blanco strook van
// minstens 35% van de letterhoogte en ruim breder dan de gewone letterafstand.
export function splitByInk(w, cols) {
  const chars = [...w.text];
  const first = cols.indexOf(true);
  const last = cols.lastIndexOf(true);
  if (chars.length < 4 || first < 0) return [w];
  const runs = [];
  let start = -1;
  for (let i = first; i <= last; i++) {
    if (!cols[i] && start < 0) start = i;
    if (cols[i] && start >= 0) { runs.push({ start, len: i - start }); start = -1; }
  }
  if (!runs.length) return [w];
  const h = w.bbox.y1 - w.bbox.y0;
  const limit = Math.max(0.35 * h, 2.2 * Math.max(median(runs.map((r) => r.len)), 2));
  const widths = chars.map(charWidth);
  const total = widths.reduce((a, b) => a + b, 0);
  const cuts = [];
  for (const r of runs.filter((x) => x.len >= limit)) {
    const at = (r.start + r.len / 2 - first) / Math.max(1, last - first);
    // Na welke letter valt dit punt? Kies de grens die er het dichtst bij ligt.
    let best = -1;
    let bestDiff = Infinity;
    let cum = 0;
    for (let k = 1; k < chars.length; k++) {
      cum += widths[k - 1];
      const diff = Math.abs(cum / total - at);
      if (diff < bestDiff) { bestDiff = diff; best = k; }
    }
    const prevCut = cuts[cuts.length - 1] ?? 0;
    const before = chars.slice(prevCut, best).join('');
    const after = chars.slice(best).join('');
    // Niet naast een apostrof of leesteken, en geen stukjes van één teken.
    if (/['’,.;:!?]/.test(chars[best - 1] + chars[best])) continue;
    if ((before.match(/\p{L}/gu) || []).length < 2 || (after.match(/\p{L}/gu) || []).length < 2) continue;
    cuts.push(best);
  }
  if (!cuts.length) return [w];
  const bounds = [0, ...cuts, chars.length];
  const width = w.bbox.x1 - w.bbox.x0;
  const cumTo = (k) => widths.slice(0, k).reduce((a, b) => a + b, 0) / total;
  return bounds.slice(0, -1).map((b, i) => ({
    text: chars.slice(b, bounds[i + 1]).join(''),
    confidence: w.confidence,
    bbox: {
      x0: Math.round(w.bbox.x0 + cumTo(b) * width),
      x1: Math.round(w.bbox.x0 + cumTo(bounds[i + 1]) * width),
      y0: w.bbox.y0,
      y1: w.bbox.y1,
    },
  }));
}

// Woorden met lage zekerheid (bijv. door onderstreping met pen) houden we als ze
// lang genoeg zijn; liever iets om te verbeteren dan een leeg vakje.
function confidentEnough(w, minConfidence) {
  const c = w.confidence ?? 100;
  if (c >= minConfidence) return true;
  return c >= 5 && (w.text.match(/\p{L}/gu) || []).length >= 4;
}

// inkColumns(bbox) geeft per pixelkolom aan of er inkt is; zonder die functie
// valt het splitsen terug op de (minder nauwkeurige) letterposities van Tesseract.
const splitter = (inkColumns) => (w) => (inkColumns && !isMarker(w.text) ? splitByInk(w, inkColumns(w.bbox)) : splitGlued(w));

function lineCells(line, minConfidence, inkColumns) {
  const words = (line.words || [])
    .filter((w) => w.text && w.text.trim() && confidentEnough(w, minConfidence))
    .flatMap(splitter(inkColumns));
  if (!words.length) return [];
  const h = median(words.map((w) => w.bbox.y1 - w.bbox.y0)) || 10;
  const cells = [];
  let cur = null;
  let prev = null;
  for (const w of words) {
    const marker = isMarker(w.text);
    const bigGap = prev && w.bbox.x0 - prev.bbox.x1 > h * 2; // kolommen liggen ver uit elkaar, gewone spaties niet
    if (marker || bigGap || !cur) {
      cur = { words: [], confs: [], marked: marker, x0: w.bbox.x0, x1: w.bbox.x1, y0: Infinity, y1: -Infinity, h };
      cells.push(cur);
    }
    if (!marker) {
      const text = stripMarkerPrefix(w.text.trim());
      if (text) {
        if (!cur.words.length) cur.x0 = w.bbox.x0;
        cur.y0 = Math.min(cur.y0, w.bbox.y0);
        cur.y1 = Math.max(cur.y1, w.bbox.y1);
        cur.x1 = w.bbox.x1;
        cur.words.push(text);
        cur.confs.push(w.confidence ?? 100);
      }
    }
    prev = w;
  }
  return cells
    .map((c) => ({ ...c, text: cleanCell(c.words.join(' ')), conf: c.confs.reduce((a, b) => a + b, 0) / Math.max(1, c.confs.length) }))
    .filter((c) => c.text && !isHeader(c) && /\p{L}/u.test(c.text));
}

// Bouwt cellen uit losse woorden (voor PSM 11, waar Tesseract geen regels
// levert): woorden die vlak naast elkaar op dezelfde hoogte staan horen bij
// elkaar, een bolletje links ervan markeert het begin.
function wordsToCells(lines, minConfidence, inkColumns) {
  const words = lines.flatMap((l) => l.words || [])
    .filter((w) => w.text && w.text.trim() && confidentEnough(w, minConfidence))
    .flatMap(splitter(inkColumns))
    .sort((a, b) => a.bbox.x0 - b.bbox.x0);
  if (!words.length) return [];
  const h = median(words.map((w) => w.bbox.y1 - w.bbox.y0)) || 10;
  const yc = (b) => (b.y0 + b.y1) / 2;
  const markers = words.filter((w) => isMarker(w.text));
  const cells = [];
  for (const w of words) {
    if (isMarker(w.text)) continue;
    const text = stripMarkerPrefix(w.text.trim());
    if (!text) continue;
    const cell = cells.find((c) => {
      const gap = w.bbox.x0 - c.x1;
      return gap > -h * 0.3 && gap < h * 1.2 && Math.abs(yc(w.bbox) - (c.y0 + c.y1) / 2) < h * 0.45;
    });
    if (cell) {
      cell.words.push(text);
      cell.confs.push(w.confidence ?? 100);
      cell.x1 = w.bbox.x1;
      cell.y0 = Math.min(cell.y0, w.bbox.y0);
      cell.y1 = Math.max(cell.y1, w.bbox.y1);
    } else {
      const marked = markers.some((m) => m.bbox.x1 <= w.bbox.x0 + h * 0.2 && w.bbox.x0 - m.bbox.x1 < h * 2
        && Math.abs(yc(m.bbox) - yc(w.bbox)) < h * 0.6);
      cells.push({ words: [text], confs: [w.confidence ?? 100], marked, x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1, h });
    }
  }
  return cells
    .map((c) => ({ ...c, text: cleanCell(c.words.join(' ')), conf: c.confs.reduce((a, b) => a + b, 0) / c.confs.length }))
    .filter((c) => c.text && !isHeader(c) && /\p{L}/u.test(c.text));
}

// Cellen op ongeveer dezelfde hoogte vormen samen een rij.
function cellsToRows(cells) {
  const rows = [];
  for (const c of [...cells].sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1))) {
    const row = rows[rows.length - 1];
    const yc = (c.y0 + c.y1) / 2;
    if (row && Math.abs(yc - row.yc) < c.h * 0.6) {
      row.cells.push(c);
      row.yc = row.cells.reduce((s, x) => s + (x.y0 + x.y1) / 2, 0) / row.cells.length;
    } else rows.push({ yc, cells: [c] });
  }
  return rows.map((r) => r.cells.sort((a, b) => a.x0 - b.x0));
}

// Zet de regels van Tesseract om in woordparen. Tesseract volgt zelf al de
// scheefstand van de foto, dus één regel is één rij op de pagina. Een rij wordt
// gesplitst op bolletjes en grote witruimtes; de stukken worden van links naar
// rechts per twee gekoppeld (twee woordenlijsten naast elkaar gaat dus goed).
// dropCell: optionele functie die een cel (met x0/x1/y0/y1) afkeurt, bijv. handschrift.
export function linesToPairs(lines, leftIsFr = true, { skipSentences = false, minConfidence = 30, withBoxes = false, sparse = false, dropCell = null, inkColumns = null } = {}) {
  let rows = sparse
    ? cellsToRows(wordsToCells(lines, minConfidence, inkColumns))
    : lines.map((l) => lineCells(l, minConfidence, inkColumns));
  if (dropCell) rows = rows.map((r) => r.filter((c) => !dropCell(c)));
  rows = dropDuplicates(rows);
  if (skipSentences) rows = rows.map((r) => r.filter((c) => !isSentence(c.text)));
  rows = rows.filter((r) => r.length);
  const markedShare = rows.flat().filter((c) => c.marked).length / Math.max(1, rows.flat().length);
  const pairs = [];
  const makePair = (left, right) => {
    const pair = leftIsFr
      ? { fr: left?.text ?? '', nl: right?.text ?? '' }
      : { fr: right?.text ?? '', nl: left?.text ?? '' };
    for (const [c, side] of [[left, 'left'], [right, 'right']]) {
      if (c) { c.pair = pair; c.field = (side === 'left') === leftIsFr ? 'fr' : 'nl'; }
    }
    pairs.push(pair);
    geometry.set(pair, { left, right });
  };
  const geometry = new Map();

  // Eerst per kolom koppelen (robuust bij een gebogen of scheve pagina), de rest per rij.
  const { matched, skip } = columnPairs(rows.flat());
  for (const [l, r] of matched) {
    makePair(l, r);
    geometry.get(pairs[pairs.length - 1]).byColumn = true;
  }
  rows = rows.map((r) => r.filter((c) => !skip.has(c))).filter((r) => r.length);
  const role = columnRoles(rows);

  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const cell = row[i];
      const next = row[i + 1];
      const r = role(cell);
      if (r === 'right') {
        // De linkerhelft is niet herkend: leeg laten in plaats van alles te verschuiven.
        makePair(null, cell);
      } else if (next && (r === null || role(next) !== 'left' || row.length === 2)) {
        makePair(cell, next);
        i++;
      } else {
        makePair(cell, null);
      }
    }
  }
  pairs.sort((a, b) => {
    const ca = geometry.get(a).left || geometry.get(a).right;
    const cb = geometry.get(b).left || geometry.get(b).right;
    return ca.y0 - cb.y0 || ca.x0 - cb.x0;
  });
  let result = joinHalves(pairs, geometry);
  // Boek met bolletjes? (Bij losse-woordenscan worden niet alle bolletjes gelezen.)
  const usesCircles = markedShare > 0.35;
  if (usesCircles) result = attachContinuations(result, geometry, rows.flat());
  // Pas na het samenvoegen filteren, anders vallen korte helften ("in") onterecht weg.
  // Duidelijk verkeerde kant? Rechtzetten op basis van de woorden zelf.
  for (const p of result) {
    // "ikben" -> "ik ben": in het Nederlands is "ik" + medeklinker nooit één woord.
    p.nl = p.nl.replace(/(?<!\p{L})ik(?=[bcdfghjklmnpqrstvwxz]\p{L}{2,})/giu, (m) => `${m} `);
    const fr = languageScore(p.fr);
    const nl = languageScore(p.nl);
    if (p.fr && !p.nl && fr <= -1.5) [p.fr, p.nl] = ['', p.fr];
    else if (p.nl && !p.fr && nl >= 1.5) [p.fr, p.nl] = [p.nl, ''];
    else if (p.fr && p.nl && fr <= -1.5 && nl >= 1.5) [p.fr, p.nl] = [p.nl, p.fr];
  }
  const kept = result.filter((p) => {
    if (skipSentences && (isSentence(p.fr) || isSentence(p.nl))) return false;
    // Rijen met alleen losse letters, of waarin alles onzeker is (handschrift), zijn ruis.
    // Korte echte woordjes ("et = en") blijven staan: samen minstens 4 letters.
    const letters = [p.fr, p.nl].map((t) => (t.match(/\p{L}/gu) || []).length);
    if (Math.max(...letters) < 3 && letters[0] + letters[1] < 4) return false;
    const { left, right } = geometry.get(p);
    // In een boek met bolletjes voor elk woord is tekst zonder bolletje een kop,
    // instructie of paginanummer ("Gebruik Slim stampen om ...").
    if (usesCircles && !left?.marked && !right?.marked) return false;
    return ![left, right].filter(Boolean).every((c) => c.conf < 50);
  });
  if (!withBoxes) return kept;
  // Waar op de foto staat dit paar? Gebruikt om een uitsnede van de regel te tonen.
  return kept.map((p) => {
    const { left, right, extra = [] } = geometry.get(p);
    const cells = [left, right, ...extra].filter(Boolean);
    const box = {
      x0: Math.min(...cells.map((c) => c.x0)),
      x1: Math.max(...cells.map((c) => c.x1)),
      y0: Math.min(...cells.map((c) => c.y0)),
      y1: Math.max(...cells.map((c) => c.y1)),
    };
    // Hoe zeker is dit paar? Gebruikt om tussen scaninstellingen te kiezen.
    const conf = Math.min(...[left, right].map((c) => (c ? c.conf : 0)));
    return { ...p, box, conf, byColumn: !!geometry.get(p).byColumn, marked: !!(left?.marked || right?.marked) };
  });
}

// Een halve rij zonder bolletje is meestal het vervolg van de cel erboven
// ("ze heeft een hekel" / "aan"). Plak die eraan vast.
function attachContinuations(pairs, geometry, cells) {
  const removed = new Set();
  for (const p of pairs) {
    const g = geometry.get(p);
    const cell = g && (g.left && !g.right ? g.left : !g.left && g.right ? g.right : null);
    if (!cell || cell.marked) continue;
    const above = cells
      .filter((c) => c !== cell && c.pair && c.pair !== p && !removed.has(c.pair))
      .filter((c) => Math.abs(c.x0 - cell.x0) < cell.h * 3)
      .filter((c) => cell.y0 - c.y1 > -cell.h * 0.3 && cell.y0 - c.y1 < cell.h * 1.5)
      .sort((a, b) => (cell.y0 - a.y1) - (cell.y0 - b.y1))[0];
    if (!above) continue;
    const current = above.pair[above.field];
    // Soms levert de scan dezelfde regel twee keer; dan niet dubbel plakken.
    if (!current.endsWith(cell.text)) above.pair[above.field] = `${current} ${cell.text}`.trim();
    const g2 = geometry.get(above.pair);
    g2.extra = [...(g2.extra || []), cell];
    removed.add(p);
  }
  return pairs.filter((p) => !removed.has(p));
}

// Bijna dezelfde tekst: de een bevat de ander, of hooguit twee tekens verschil.
function similar(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  if (x.includes(y) || y.includes(x)) return true;
  const d = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[y.length] <= 2;
}

function overlapShare(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return 0;
  const area = (c) => Math.max(1, (c.x1 - c.x0) * (c.y1 - c.y0));
  return (w * h) / Math.min(area(a), area(b));
}

// Tesseract leest een stuk tekst soms twee keer ("ourquoi" over "pourquoi").
// Een cel die grotendeels over een eerdere cel heen ligt, laten we vallen;
// van twee overlappende cellen houden we de zekerste.
function dropDuplicates(rows) {
  const all = rows.flat();
  const drop = new Set();
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (drop.has(all[i]) || drop.has(all[j])) continue;
      if (overlapShare(all[i], all[j]) > 0.5 && similar(all[i].text, all[j].text)) {
        // Houd de cel met bolletje (die staat in een echte rij), anders de zekerste.
        const [a, b] = [all[i], all[j]];
        const keepA = a.marked !== b.marked ? a.marked : a.conf >= b.conf - 10;
        drop.add(keepA ? b : a);
      }
    }
  }
  return rows.map((r) => r.filter((c) => !drop.has(c)));
}

// Een rij die als twee helften is gelezen ("peut-être | leeg" en "leeg | misschien")
// weer samenvoegen als beide helften op dezelfde hoogte staan.
function joinHalves(pairs, geometry) {
  const removed = new Set();
  const lefts = pairs.filter((p) => geometry.get(p)?.left && !geometry.get(p).right);
  const rights = pairs.filter((p) => geometry.get(p)?.right && !geometry.get(p).left);
  for (const p of lefts) {
    const l = geometry.get(p).left;
    const yc = (l.y0 + l.y1) / 2;
    const match = rights
      .filter((q) => !removed.has(q))
      .map((q) => ({ q, r: geometry.get(q).right }))
      .filter(({ r }) => r.x0 > l.x1 && r.x0 - l.x1 < l.h * 15 && Math.abs((r.y0 + r.y1) / 2 - yc) < l.h * 0.7)
      .sort((a, b) => a.r.x0 - b.r.x0)[0];
    if (!match) continue;
    const field = p.fr ? 'nl' : 'fr';
    p[field] = match.q[field];
    match.r.pair = p;
    geometry.set(p, { left: l, right: match.r });
    removed.add(match.q);
  }
  return pairs.filter((p) => !removed.has(p));
}

// Kolommen zoeken op x-positie. Gebruikt voor de kolomkoppeling en de rollen.
function clusterColumns(cells, h) {
  const sorted = [...cells].sort((a, b) => a.x0 - b.x0);
  const clusters = [];
  for (const c of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && c.x0 - last.max < h * 4) { last.max = c.x0; last.cells.push(c); } else clusters.push({ min: c.x0, max: c.x0, cells: [c] });
  }
  return clusters;
}

// Koppelt per kolom: in een lesboek hoort het 1e Franse woord van een blok bij
// het 1e Nederlandse woord ernaast, ook als een gebogen pagina de kolommen een
// hele regel ten opzichte van elkaar verschuift. Alleen groepen met evenveel
// woorden worden zo gekoppeld; de rest gaat terug naar de koppeling per rij.
function columnPairs(cells) {
  const matched = [];
  const skip = new Set();
  if (cells.length < 4) return { matched, skip };
  const h = median(cells.map((c) => c.h)) || 20;
  const columns = clusterColumns(cells, h).map((k) => k.cells.sort((a, b) => a.y0 - b.y0));

  // Groepen binnen een kolom, gescheiden door een witregel.
  const groups = columns.map((col, k) => {
    const out = [];
    for (const c of col) {
      const g = out[out.length - 1];
      if (g && c.y0 - g.cells[g.cells.length - 1].y1 < h) g.cells.push(c);
      else out.push({ k, cells: [c] });
    }
    for (const g of out) { g.y0 = g.cells[0].y0; g.y1 = g.cells[g.cells.length - 1].y1; }
    return out;
  });

  const role = parityRoles(cells, h);
  const all = groups.flat();
  const usedRight = new Set();
  for (const g of all) {
    if (g.cells.length < 2 || role(g.cells[0]) !== 'left') continue;
    // Alleen de groep in de direct naastgelegen kolom komt in aanmerking, en
    // alleen als die evenveel woorden heeft. Nooit een kolom overslaan.
    const beside = all
      .filter((q) => q.k > g.k && Math.min(g.y1, q.y1) - Math.max(g.y0, q.y0) > 0)
      .sort((a, b) => a.k - b.k || b.cells.length - a.cells.length)[0];
    const partner = beside && !usedRight.has(beside) && beside.cells.length === g.cells.length
      && role(beside.cells[0]) === 'right' ? beside : null;
    if (!partner) continue;
    // Elk paar moet ongeveer op dezelfde hoogte staan (hooguit anderhalve regel verschoven).
    const zip = g.cells.map((c, i) => [c, partner.cells[i]]);
    if (!zip.every(([a, b]) => Math.abs(a.y0 - b.y0) < h * 2.2)) continue;
    usedRight.add(partner);
    for (const [a, b] of zip) {
      matched.push([a, b]);
      skip.add(a);
      skip.add(b);
    }
  }
  return { matched, skip };
}

// Staat een cel links (Frans) of rechts (vertaling) in een paar? Tel hoeveel
// kolommen er op die hoogte links van de cel staan: even = links, oneven = rechts.
// Werkt per hoogte, dus ook als blokken met 4 en met 2 kolommen elkaar afwisselen.
function parityRoles(cells, h) {
  const columns = clusterColumns(cells, h);
  const colOf = new Map();
  columns.forEach((k, i) => k.cells.forEach((c) => colOf.set(c, i)));
  const yc = (c) => (c.y0 + c.y1) / 2;
  return (cell) => {
    const k = colOf.get(cell);
    if (k === undefined) return null;
    let n = 0;
    for (let i = 0; i < k; i++) {
      // Losse ruis telt niet: minstens twee cellen van die kolom in de buurt.
      const near = columns[i].cells.filter((c) => Math.abs(yc(c) - yc(cell)) < h * 4).length;
      if (near >= 2) n++;
    }
    return n % 2 === 0 ? 'left' : 'right';
  };
}

// Bepaalt per kolom (op x-positie) of die links (Frans) of rechts (vertaling)
// in een paar staat, op basis van de rijen die compleet lijken.
function columnRoles(rows) {
  const cells = rows.flat();
  const clusters = clusterColumns(cells, median(cells.map((c) => c.h)) || 20)
    .map((k) => ({ ...k, set: new Set(k.cells), left: 0, right: 0 }));
  const clusterOf = (c) => clusters.find((k) => k.set.has(c));
  for (const row of rows) {
    if (row.length < 4 || row.length % 2) continue;
    row.forEach((c, i) => { const k = clusterOf(c); if (i % 2) k.right++; else k.left++; });
  }
  return (cell) => {
    const k = clusterOf(cell);
    if (!k || k.cells.length < 3 || k.left + k.right < 2) return null;
    if (k.left >= 2 * k.right) return 'left';
    if (k.right >= 2 * k.left) return 'right';
    return null;
  };
}

// Hoe bruikbaar is een scanresultaat? Telt complete paren waarvan de scan
// behoorlijk zeker was. Werkt op de uitvoer van linesToPairs met withBoxes.
export function scanQuality(pairs) {
  const good = pairs.filter((p) => p.fr && p.nl && (p.conf ?? 100) >= 80).length;
  return { good, ratio: pairs.length ? good / pairs.length : 0 };
}

// Aandeel blauwe inkt onder de donkere pixels van een RGBA-uitsnede.
// Pen (handschrift) is blauw, drukinkt grijs/zwart. Getest: gedrukte woorden
// tot 0.38 (ook als ze onderstreept zijn), handschrift 0.85 of hoger.
export function blueInkShare(d) {
  let dark = 0;
  let blue = 0;
  for (let i = 0; i < d.length; i += 8) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r + g + b < 360) {
      dark++;
      if (b - Math.max(r, g) > 15) blue++;
    }
  }
  return dark > 10 ? blue / dark : 0;
}

// Eenvoudige taalherkenning voor korte woordjes: positief = Frans, negatief =
// Nederlands, rond 0 = weet niet. Alleen bedoeld om duidelijke gevallen recht te
// zetten (een Nederlands woord dat aan de Franse kant terechtkwam).
const FR_WORDS = new Set(['le', 'la', 'les', 'un', 'une', 'du', 'des', 'au', 'aux', 'il', 'elle', 'on', 'tu', 'nous', 'vous',
  'ils', 'est', 'et', 'oui', 'non', 'avec', 'dans', 'pour', 'très', 'trop', 'aussi', 'toujours', 'merci', 'bonjour', 'pardon',
  'voilà', 'alors', 'ici', 'mais', 'qui', 'que', 'quoi', 'pas', 'mon', 'ma', 'mes', 'ton', 'ta', 'son', 'sa']);
const NL_WORDS = new Set(['het', 'een', 'ik', 'jij', 'hij', 'zij', 'wij', 'we', 'ze', 'u', 'is', 'zijn', 'ja', 'nee', 'niet',
  'ook', 'heel', 'erg', 'dus', 'hier', 'van', 'op', 'met', 'naar', 'wat', 'waar', 'hoe', 'dat', 'dit', 'er', 'veel', 'altijd',
  'dank', 'geen', 'tot', 'ziens', 'hallo', 'sorry', 'bijna', 'iets', 'mooi', 'morgen', 'vandaag', 'misschien', 'waarom']);

export function languageScore(text) {
  const t = normalize(text);
  if (!t) return 0;
  let score = 0;
  for (const w of t.split(/[\s,;/()]+/).filter(Boolean)) {
    if (/^[ldjnmstc]'/.test(w) || /^qu/.test(w)) score += 1;
    const bare = w.replace(/^[ldjnmstc]'/, '');
    if (FR_WORDS.has(bare)) score += 1.5;
    if (NL_WORDS.has(bare)) score -= 1.5;
    if (bare === 'de') score -= 0.5;
    if (/[éèêàâçîïôûùœ]/.test(bare)) score += 1;
    if (/(tion|eux|euse|ais|aise|ère|ette|oir|ille|que|eau)$/.test(bare)) score += 1;
    if (/ij|sch|aa|ee|uu|oo|kj/.test(bare)) score -= 1;
    if (/[kwz]/.test(bare)) score -= 0.5;
  }
  return score;
}

export function linesFromBlocks(blocks) {
  const out = [];
  for (const b of blocks || [])
    for (const p of b.paragraphs || [])
      for (const l of p.lines || []) out.push(l);
  return out;
}

// Grijs maken en contrast oprekken: gekleurde achtergronden (blauwe kaders in
// lesboeken) worden licht, tekst wordt donker. Werkt in-place op RGBA-pixels.
export function enhanceContrast(d) {
  const n = d.length / 4;
  const g = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const r = d[i * 4], gr = d[i * 4 + 1], b = d[i * 4 + 2];
    g[i] = (Math.min(r, gr, b) + 0.299 * r + 0.587 * gr + 0.114 * b) / 2;
    hist[g[i]]++;
  }
  let lo = 0, hi = 255, acc = 0;
  while (lo < 255 && (acc += hist[lo]) < n * 0.01) lo++;
  acc = 0;
  while (hi > 0 && (acc += hist[hi]) < n * 0.05) hi--;
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < n; i++) {
    const v = ((g[i] - lo) * 255) / range;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
  }
  return d;
}

export function shuffle(arr, rnd = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function emptyStats() {
  return { streak: 0, right: 0, wrong: 0 };
}

export function isKnown(word, dir) {
  return (word.stats?.[dir]?.streak ?? 0) >= KNOWN_STREAK;
}

// Voortgang van een lijst. Elke keer goed op rij telt mee (1 van de 3 is een
// derde), zodat je ook na één ronde al ziet dat je opschiet. "known" telt de
// woorden die in beide richtingen helemaal geleerd zijn.
export function listProgress(words) {
  const usable = words.filter((w) => w.fr && w.nl);
  const part = (w, dir) => Math.min(w.stats?.[dir]?.streak ?? 0, KNOWN_STREAK) / KNOWN_STREAK;
  const sum = usable.reduce((n, w) => n + part(w, 'fn') + part(w, 'nf'), 0);
  return {
    count: usable.length,
    known: usable.filter((w) => isKnown(w, 'fn') && isKnown(w, 'nf')).length,
    pct: usable.length ? Math.round((sum / (usable.length * 2)) * 100) : 0,
  };
}

// Kiest per richting de woorden die het minst bekend zijn, met wat toeval.
export function pickWords(pool, dir, count, rnd = Math.random) {
  const usable = pool.filter((w) => w.fr && w.nl);
  return shuffle(usable, rnd)
    .map((w) => ({ w, key: (isKnown(w, dir) ? 1000 : 0) + (w.stats?.[dir]?.streak ?? 0) + rnd() }))
    .sort((a, b) => a.key - b.key)
    .slice(0, count)
    .map((x) => x.w);
}

export function question(w, dir) {
  return dir === 'fn'
    ? { word: w, dir, prompt: w.fr, answer: w.nl, answerLang: 'nl' }
    : { word: w, dir, prompt: w.nl, answer: w.fr, answerLang: 'fr' };
}

export function buildQuiz(pool, perDirection = 10, rnd = Math.random) {
  const fn = shuffle(pickWords(pool, 'fn', perDirection, rnd), rnd).map((w) => question(w, 'fn'));
  const nf = shuffle(pickWords(pool, 'nf', perDirection, rnd), rnd).map((w) => question(w, 'nf'));
  return [...fn, ...nf];
}

// ---------- Leren ----------

export const LEARN_SIZE = 5;

// De woorden die in beide richtingen het minst bekend zijn.
export function pickLearnWords(pool, count = LEARN_SIZE, rnd = Math.random) {
  const streak = (w, dir) => w.stats?.[dir]?.streak ?? 0;
  return shuffle(pool.filter((w) => w.fr && w.nl), rnd)
    .map((w) => ({
      w,
      key: (isKnown(w, 'fn') && isKnown(w, 'nf') ? 1000 : 0) + streak(w, 'fn') + streak(w, 'nf') + rnd(),
    }))
    .sort((a, b) => a.key - b.key)
    .slice(0, count)
    .map((x) => x.w);
}

// Een leerronde: kaartjes bekijken, meerkeuze in beide richtingen en
// (behalve als dat is uitgezet) het Frans zelf intypen.
export function learnPhases(words, typing = true, rnd = Math.random) {
  const phases = [
    { name: 'card', items: shuffle(words, rnd).map((w) => question(w, 'fn')) },
    { name: 'choice', items: shuffle([...words.map((w) => question(w, 'fn')), ...words.map((w) => question(w, 'nf'))], rnd) },
  ];
  if (typing) phases.push({ name: 'type', items: shuffle(words, rnd).map((w) => question(w, 'nf')) });
  return phases;
}

// Welke richting telt mee voor "ken ik al" in deze stap? Meerkeuze telt alleen
// voor Nederlands → Frans als het intypen is overgeslagen.
export function learnRecords(phase, dir, typing) {
  if (phase === 'choice') return dir === 'fn' || !typing;
  return phase === 'type';
}

// Hulp bij intypen: lidwoord plus eerste letter, bijv. "la m…" of "l'é…".
export function hintFor(answer) {
  const main = String(answer ?? '').split(/[\/;,]/)[0].trim();
  const m = main.match(/^((?:\([^)]*\)\s*)?(?:(?:le|la|les|un|une|des|du|de la)\s+|[ld]['’]\s*)?)(\S)(.*)$/i);
  if (!m || !m[3].trim()) return '';
  return `${m[1]}${m[2]}…`;
}

// Meerkeuze: het goede antwoord plus maximaal drie andere uit dezelfde pool.
export function choicesFor(question, pool, rnd = Math.random) {
  const field = question.answerLang;
  const correct = question.answer;
  const seen = new Set([normalize(correct)]);
  const others = [];
  for (const w of shuffle(pool, rnd)) {
    const v = w[field];
    if (!v || seen.has(normalize(v))) continue;
    seen.add(normalize(v));
    others.push(v);
    if (others.length === 3) break;
  }
  return shuffle([correct, ...others], rnd);
}

export function recordResult(word, dir, ok) {
  word.stats ??= {};
  const s = (word.stats[dir] ??= emptyStats());
  if (ok) {
    s.right++;
    s.streak++;
  } else {
    s.wrong++;
    s.streak = 0;
  }
}

export function formatDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}
