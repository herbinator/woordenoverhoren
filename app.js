import {
  checkAnswer, parseText, linesToPairs, linesFromBlocks, enhanceContrast, scanQuality, blueInkShare, buildQuiz, choicesFor,
  recordResult, isKnown, formatDate, shuffle, pickLearnWords, learnPhases, learnRecords, hintFor, LEARN_SIZE,
} from './logic.js';

const VERSION = '2.0.0';
const STORE_KEY = 'woordenoverhoren:v1';
const PER_DIRECTION = 10;
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
// Hoge resolutie herkent kleine letters in lesboeken duidelijk beter (getest op echte foto's).
const MAX_SIDE = 4000;
const ACCENTS = ['é', 'è', 'ê', 'ë', 'à', 'â', 'ç', 'î', 'ï', 'ô', 'û', 'ù', 'œ', "'"];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
const canSpeak = 'speechSynthesis' in window;

// ---------- Opslag ----------

function defaultState() {
  return { lists: [], selected: [], settings: { mode: 'type', leftIsFr: true, skipSentences: true, skipTyping: false } };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    const d = defaultState();
    return { ...d, ...s, settings: { ...d.settings, ...s.settings } };
  } catch {
    return defaultState();
  }
}

let state = load();

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    toast(`Opslaan mislukt: ${e.message}`);
  }
}

navigator.storage?.persist?.().catch(() => {});

// ---------- Navigatie ----------

const VIEWS = ['home', 'editor', 'learn', 'quiz', 'result'];
const TITLES = { home: 'Woorden overhoren', editor: 'Woordenlijst', learn: 'Leren', quiz: 'Overhoring', result: 'Uitslag' };
let current = 'home';

function show(view, push = true) {
  current = view;
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== view;
  $('title').textContent = TITLES[view];
  $('back').hidden = view === 'home';
  if (push) history.pushState({ view }, '');
  window.scrollTo(0, 0);
  if (view === 'home') renderHome();
}

history.replaceState({ view: 'home' }, '');
window.addEventListener('popstate', (e) => {
  if (current === 'editor' && editorDirty && !confirm('Wijzigingen niet opslaan?')) {
    history.pushState({ view: 'editor' }, '');
    return;
  }
  if (current === 'quiz' && quiz && quiz.index < quiz.questions.length && !confirm('Overhoring stoppen?')) {
    history.pushState({ view: 'quiz' }, '');
    return;
  }
  if (current === 'learn' && learn && !learn.finished && !confirm('Stoppen met leren?')) {
    history.pushState({ view: 'learn' }, '');
    return;
  }
  editorDirty = false;
  show(['editor', 'learn', 'quiz'].includes(e.state?.view) ? 'home' : e.state?.view || 'home', false);
});
$('back').addEventListener('click', () => history.back());

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

// ---------- Start ----------

function listProgress(list) {
  const words = list.words.filter((w) => w.fr && w.nl);
  const total = words.length * 2;
  const known = words.reduce((n, w) => n + (isKnown(w, 'fn') ? 1 : 0) + (isKnown(w, 'nf') ? 1 : 0), 0);
  return { count: words.length, pct: total ? Math.round((known / total) * 100) : 0 };
}

function poolOf(ids) {
  return state.lists
    .filter((l) => ids.includes(l.id))
    .flatMap((l) => l.words)
    .filter((w) => w.fr && w.nl);
}
const selectedPool = () => poolOf(state.selected);

// Net opgeslagen lijst: bovenaan de start meteen leren of overhoren aanbieden.
let justSaved = null;

function renderHome() {
  state.selected = state.selected.filter((id) => state.lists.some((l) => l.id === id));
  const el = $('lists');
  if (!state.lists.length) {
    el.innerHTML = `<div class="card empty"><p><strong>Nog geen woordenlijsten.</strong></p>
      <p class="muted">Maak een nieuwe lijst en scan een foto uit je boek.</p></div>`;
  } else {
    el.innerHTML = state.lists.map((l) => {
      const p = listProgress(l);
      return `<div class="list-item">
        <input type="checkbox" data-select="${esc(l.id)}" aria-label="Overhoren: ${esc(l.name)}" ${state.selected.includes(l.id) ? 'checked' : ''}>
        <div class="info">
          <div class="name">${esc(l.name)}</div>
          <div class="muted">${p.count} woorden, ${p.pct}% geleerd</div>
          <div class="meter"><div style="width:${p.pct}%"></div></div>
        </div>
        <button class="btn secondary" data-edit="${esc(l.id)}">Bewerk</button>
      </div>`;
    }).join('');
  }

  const saved = state.lists.find((l) => l.id === justSaved);
  $('saved-banner').hidden = !saved || !poolOf([saved.id]).length;
  if (saved) $('saved-name').textContent = saved.name;

  const pool = selectedPool();
  const n = Math.min(pool.length, PER_DIRECTION) * 2;
  $('learn').disabled = !pool.length;
  $('skip-typing').checked = state.settings.skipTyping;
  $('learn-info').textContent = pool.length
    ? `Per ronde ${Math.min(pool.length, LEARN_SIZE)} woorden: eerst kaartjes bekijken, dan meerkeuze${state.settings.skipTyping ? '' : ' en daarna zelf het Frans intypen'}. Woorden die je nog niet kent komen het eerst aan bod.`
    : 'Vink hierboven aan welke lijsten je wilt leren.';
  $('start').disabled = n === 0;
  $('start').textContent = n ? `Start overhoring (${n} vragen)` : 'Start overhoring';
  $('start-info').textContent = !state.lists.length
    ? 'Maak eerst een woordenlijst.'
    : pool.length
      ? `${pool.length} woorden geselecteerd. Je krijgt ${Math.min(pool.length, PER_DIRECTION)} vragen Frans naar Nederlands en ${Math.min(pool.length, PER_DIRECTION)} vragen Nederlands naar Frans. Woorden die je nog niet kent komen het eerst aan bod.`
      : 'Vink hierboven aan welke lijsten je wilt overhoren.';
  document.querySelector(`input[name="mode"][value="${state.settings.mode}"]`).checked = true;
  $('version').textContent = `Versie ${VERSION}`;
}

$('lists').addEventListener('change', (e) => {
  const id = e.target.dataset.select;
  if (!id) return;
  state.selected = e.target.checked ? [...new Set([...state.selected, id])] : state.selected.filter((x) => x !== id);
  save();
  renderHome();
});
$('lists').addEventListener('click', (e) => {
  const id = e.target.dataset.edit;
  if (id) openEditor(state.lists.find((l) => l.id === id));
});
$('new-list').addEventListener('click', () => openEditor(null));
document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', () => {
  state.settings.mode = r.value;
  save();
}));
$('start').addEventListener('click', () => startQuiz(buildQuiz(selectedPool(), PER_DIRECTION), selectedPool()));
$('learn').addEventListener('click', () => startLearn(selectedPool()));
$('skip-typing').addEventListener('change', (e) => {
  state.settings.skipTyping = e.target.checked;
  save();
  renderHome();
});
$('saved-learn').addEventListener('click', () => {
  const pool = poolOf([justSaved]);
  justSaved = null;
  startLearn(pool);
});
$('saved-quiz').addEventListener('click', () => {
  const pool = poolOf([justSaved]);
  justSaved = null;
  startQuiz(buildQuiz(pool, PER_DIRECTION), pool);
});
$('saved-close').addEventListener('click', () => {
  justSaved = null;
  renderHome();
});

// ---------- Exporteren / importeren ----------

$('export').addEventListener('click', () => {
  const data = { app: 'woordenoverhoren', version: 1, exported: formatDate(), lists: state.lists };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `woordenoverhoren-${formatDate()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'woordenoverhoren' || !Array.isArray(data.lists)) throw new Error('Dit is geen export van deze app.');
    const lists = data.lists.filter((l) => l && l.id && l.name && Array.isArray(l.words));
    const existing = lists.filter((l) => state.lists.some((x) => x.id === l.id)).length;
    if (!confirm(`${lists.length} lijst(en) importeren?${existing ? ` ${existing} bestaande lijst(en) worden overschreven.` : ''}`)) return;
    for (const l of lists) {
      const i = state.lists.findIndex((x) => x.id === l.id);
      if (i >= 0) state.lists[i] = l; else state.lists.push(l);
    }
    save();
    renderHome();
    toast(`${lists.length} lijst(en) geïmporteerd.`);
  } catch (err) {
    toast(`Importeren mislukt: ${err.message}`);
  }
});

// ---------- Lijst bewerken ----------

let draft = null;
let editorDirty = false;

function openEditor(list) {
  draft = list
    ? structuredClone(list)
    : { id: uid(), name: '', created: formatDate(), words: [] };
  draft.isNew = !list;
  justSaved = null;
  snips.clear();
  editorDirty = false;
  $('list-name').value = draft.name;
  $('delete-list').hidden = draft.isNew;
  $('paste-panel').hidden = true;
  closeScan();
  renderRows();
  show('editor');
  if (draft.isNew) $('list-name').focus();
}

// Uitsnedes van de gescande regels, per woord-id. Alleen tijdens het bewerken,
// ze worden niet opgeslagen.
const snips = new Map();

function renderRows() {
  $('rows').innerHTML = draft.words.map((w, i) => {
    const snip = snips.get(w.id);
    return `<div class="word-wrap${w.fr && w.nl ? '' : ' incomplete'}" data-i="${i}">
      <div class="word-row">
        <input type="text" lang="fr" data-f="fr" value="${esc(w.fr)}" class="${w.fr ? '' : 'missing'}" aria-label="Frans" autocomplete="off" spellcheck="false">
        <input type="text" lang="nl" data-f="nl" value="${esc(w.nl)}" class="${w.nl ? '' : 'missing'}" aria-label="Nederlands" autocomplete="off" spellcheck="false">
        <button class="icon-btn" data-del="${i}" aria-label="Verwijder regel">&#10005;</button>
      </div>
      ${snip ? `<img class="snip" src="${snip}" alt="Deze regel op de foto">` : ''}
    </div>`;
  }).join('');
  const incomplete = draft.words.filter((w) => !w.fr || !w.nl).length;
  $('row-count').textContent = `${draft.words.length} woorden${incomplete ? `, ${incomplete} nog niet compleet (geel)` : ''}`;
}

function addPairs(pairs) {
  for (const p of pairs) {
    const id = uid();
    if (p.snip) snips.set(id, p.snip);
    draft.words.push({ id, fr: p.fr, nl: p.nl, stats: {} });
  }
  editorDirty = true;
  renderRows();
}

$('list-name').addEventListener('input', (e) => { draft.name = e.target.value; editorDirty = true; });
$('rows').addEventListener('input', (e) => {
  const row = e.target.closest('.word-wrap');
  if (!row) return;
  const w = draft.words[+row.dataset.i];
  w[e.target.dataset.f] = e.target.value;
  e.target.classList.toggle('missing', !e.target.value.trim());
  row.classList.toggle('incomplete', !w.fr.trim() || !w.nl.trim());
  editorDirty = true;
});
$('rows').addEventListener('click', (e) => {
  const i = e.target.dataset.del;
  if (i === undefined) return;
  draft.words.splice(+i, 1);
  editorDirty = true;
  renderRows();
});
$('add-row').addEventListener('click', () => {
  addPairs([{ fr: '', nl: '' }]);
  $('rows').lastElementChild?.querySelector('input')?.focus();
});
$('swap-cols').addEventListener('click', () => {
  for (const w of draft.words) {
    [w.fr, w.nl] = [w.nl, w.fr];
    w.stats = {};
  }
  editorDirty = true;
  renderRows();
});

$('open-paste').addEventListener('click', () => {
  closeScan();
  $('paste-panel').hidden = false;
  $('paste-text').focus();
});
const AI_PROMPT = 'Schrijf alle Franse woorden met hun Nederlandse vertaling van deze foto uit een lesboek over. '
  + "Eén woord per regel, in de vorm: Frans = Nederlands (bijvoorbeeld: l'école = de school). "
  + 'Neem lidwoorden over zoals ze in het boek staan. Geef alleen de lijst, zonder uitleg.';

$('copy-prompt').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(AI_PROMPT);
    toast('Opdracht gekopieerd. Plak hem samen met je foto in de AI-chat.');
  } catch {
    prompt('Kopieer deze opdracht:', AI_PROMPT);
  }
});
$('paste-cancel').addEventListener('click', () => { $('paste-panel').hidden = true; });
$('paste-add').addEventListener('click', () => {
  const pairs = parseText($('paste-text').value, true);
  addPairs(pairs);
  $('paste-text').value = '';
  $('paste-panel').hidden = true;
  toast(`${pairs.length} woorden toegevoegd.`);
});

$('save-list').addEventListener('click', () => {
  draft.name = draft.name.trim();
  if (!draft.name) {
    toast('Geef de lijst een naam.');
    $('list-name').focus();
    return;
  }
  const words = draft.words
    .map((w) => ({ ...w, fr: w.fr.trim(), nl: w.nl.trim() }))
    .filter((w) => w.fr || w.nl);
  const { isNew, ...list } = { ...draft, words };
  const i = state.lists.findIndex((l) => l.id === list.id);
  if (i >= 0) state.lists[i] = list; else state.lists.push(list);
  if (isNew) state.selected.push(list.id);
  justSaved = list.id;
  save();
  editorDirty = false;
  // Met complete woorden verschijnt bovenaan de start al een melding met knoppen.
  if (!poolOf([list.id]).length) toast('Opgeslagen.');
  history.back();
});

$('delete-list').addEventListener('click', () => {
  if (!confirm(`Lijst "${draft.name}" verwijderen? Dit kan niet ongedaan worden gemaakt.`)) return;
  state.lists = state.lists.filter((l) => l.id !== draft.id);
  save();
  editorDirty = false;
  history.back();
});

// ---------- Scannen ----------

let scanImage = null; // canvas met de (gedraaide) foto op werkformaat
let crop = null; // {x, y, w, h} in fotopixels
let ocrWorkerPromise = null;
let onOcrProgress = null;

$('open-scan').addEventListener('click', () => {
  $('paste-panel').hidden = true;
  $('scan-panel').hidden = false;
  document.querySelector(`input[name="left"][value="${state.settings.leftIsFr ? 'fr' : 'nl'}"]`).checked = true;
  $('skip-sentences').checked = state.settings.skipSentences;
  // Alvast laden, zodat het herkennen straks sneller start.
  getOcrWorker().catch(() => {});
});
$('scan-close').addEventListener('click', closeScan);
$('skip-sentences').addEventListener('change', (e) => {
  state.settings.skipSentences = e.target.checked;
  save();
});
document.querySelectorAll('input[name="left"]').forEach((r) => r.addEventListener('change', () => {
  state.settings.leftIsFr = r.value === 'fr';
  save();
}));

function closeScan() {
  $('scan-panel').hidden = true;
  $('scan-work').hidden = true;
  $('scan-progress').hidden = true;
  scanImage = null;
  crop = null;
}

async function onPhoto(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    scanImage = c;
    crop = null;
    drawScan();
    $('scan-work').hidden = false;
  } catch (err) {
    toast(`Kon de foto niet openen: ${err.message}`);
  }
}
$('scan-camera').addEventListener('change', onPhoto);
$('scan-file').addEventListener('change', onPhoto);

function drawScan() {
  const c = $('scan-canvas');
  c.width = scanImage.width;
  c.height = scanImage.height;
  c.getContext('2d').drawImage(scanImage, 0, 0);
  updateCropBox();
}

$('rotate').addEventListener('click', () => {
  if (!scanImage) return;
  const c = document.createElement('canvas');
  c.width = scanImage.height;
  c.height = scanImage.width;
  const ctx = c.getContext('2d');
  ctx.translate(c.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(scanImage, 0, 0);
  scanImage = c;
  crop = null;
  drawScan();
});
$('clear-crop').addEventListener('click', () => { crop = null; updateCropBox(); });

function updateCropBox() {
  const box = $('crop-box');
  if (!crop || !scanImage) { box.hidden = true; return; }
  const f = $('scan-canvas').clientWidth / scanImage.width;
  Object.assign(box.style, {
    left: `${crop.x * f}px`, top: `${crop.y * f}px`, width: `${crop.w * f}px`, height: `${crop.h * f}px`,
  });
  box.hidden = false;
}
window.addEventListener('resize', updateCropBox);

{
  const wrap = $('crop-wrap');
  let start = null;
  const toImage = (e) => {
    const r = $('scan-canvas').getBoundingClientRect();
    const f = scanImage.width / r.width;
    return {
      x: Math.max(0, Math.min(scanImage.width, (e.clientX - r.left) * f)),
      y: Math.max(0, Math.min(scanImage.height, (e.clientY - r.top) * f)),
    };
  };
  wrap.addEventListener('pointerdown', (e) => {
    if (!scanImage) return;
    wrap.setPointerCapture(e.pointerId);
    start = toImage(e);
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!start) return;
    const p = toImage(e);
    crop = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
    updateCropBox();
  });
  const end = () => {
    start = null;
    if (crop && (crop.w < 30 || crop.h < 30)) crop = null;
    updateCropBox();
  };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('tekstherkenning kon niet worden geladen (is er internet?)'));
    document.head.append(s);
  });
}

function getOcrWorker() {
  ocrWorkerPromise ??= (async () => {
    if (!window.Tesseract) await loadScript(TESSERACT_URL);
    const worker = await window.Tesseract.createWorker(['fra', 'nld'], 1, { logger: (m) => onOcrProgress?.(m) });
    // PSM 4: tekst in kolommen met regels van wisselende grootte, zoals woordenlijsten.
    await worker.setParameters({ tessedit_pageseg_mode: '4' });
    return worker;
  })().catch((err) => {
    ocrWorkerPromise = null;
    throw err;
  });
  return ocrWorkerPromise;
}

const OCR_STATUS = {
  'loading tesseract core': 'Herkenning laden',
  'initializing tesseract': 'Herkenning starten',
  'loading language traineddata': 'Taalbestanden laden',
  'initializing api': 'Herkenning starten',
  'recognizing text': 'Woorden herkennen',
};

function setProgress(label, fraction) {
  const p = $('scan-progress');
  p.hidden = false;
  p.querySelector('div').style.width = `${Math.round((fraction || 0) * 100)}%`;
  p.querySelector('span').textContent = label;
}

// Uitsnede van één woordpaar uit de (kleuren)foto. Ontbreekt een helft, dan
// loopt de uitsnede door naar de kant waar dat woord in het boek staat.
function rowSnippet(area, pair, leftIsFr) {
  const box = pair.box;
  if (!box || !scanImage) return null;
  const h = box.y1 - box.y0;
  const pad = Math.max(12, h * 0.6);
  const span = Math.max((box.x1 - box.x0) * 2.5, area.w * 0.4);
  const [leftText, rightText] = leftIsFr ? [pair.fr, pair.nl] : [pair.nl, pair.fr];
  let x0 = box.x0 - pad;
  let x1 = box.x1 + pad;
  if (!rightText) x1 = box.x0 + span;
  else if (!leftText) x0 = box.x1 - span;
  x0 = area.x + Math.max(0, x0);
  x1 = area.x + Math.min(area.w, x1);
  const y0 = Math.max(0, area.y + box.y0 - pad);
  const y1 = Math.min(scanImage.height, area.y + box.y1 + pad);
  const scale = Math.min(1, 900 / (x1 - x0));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round((x1 - x0) * scale));
  c.height = Math.max(1, Math.round((y1 - y0) * scale));
  c.getContext('2d').drawImage(scanImage, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

$('recognise').addEventListener('click', async () => {
  if (!scanImage) return;
  const btn = $('recognise');
  btn.disabled = true;
  onOcrProgress = (m) => setProgress(OCR_STATUS[m.status] || 'Bezig', m.progress);
  setProgress('Herkenning laden', 0);
  try {
    const area = crop || { x: 0, y: 0, w: scanImage.width, h: scanImage.height };
    const input = document.createElement('canvas');
    input.width = Math.round(area.w);
    input.height = Math.round(area.h);
    const ctx = input.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(scanImage, area.x, area.y, area.w, area.h, 0, 0, input.width, input.height);
    const pixels = ctx.getImageData(0, 0, input.width, input.height);
    enhanceContrast(pixels.data);
    ctx.putImageData(pixels, 0, 0);
    const worker = await getOcrWorker();
    // Handschrift (blauwe pen) overslaan: kijk naar de kleur in de originele foto.
    const colour = scanImage.getContext('2d', { willReadFrequently: true });
    const handwritten = (c) => {
      const w = Math.round(c.x1 - c.x0);
      const h = Math.round(c.y1 - c.y0);
      if (w < 2 || h < 2) return false;
      return blueInkShare(colour.getImageData(Math.round(area.x + c.x0), Math.round(area.y + c.y0), w, h).data) > 0.6;
    };
    // Per pixelkolom: zit er inkt in dit woordvak? Gebruikt om gemiste spaties te vinden ("we eten").
    const inkColumns = (b) => {
      const w = Math.round(b.x1 - b.x0);
      const h = Math.round(b.y1 - b.y0);
      if (w < 1 || h < 1) return [];
      const d = ctx.getImageData(Math.round(b.x0), Math.round(b.y0), w, h).data;
      const cols = new Array(w).fill(false);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) if (d[(y * w + x) * 4] < 110) cols[x] = true;
      }
      return cols;
    };
    const options = { skipSentences: state.settings.skipSentences, withBoxes: true, dropCell: handwritten, inkColumns };
    const { data } = await worker.recognize(input, {}, { text: true, blocks: true });
    let pairs = linesToPairs(linesFromBlocks(data.blocks), state.settings.leftIsFr, options);
    // Lastige foto (gebogen of scheef)? Dan nog een poging waarbij Tesseract elk
    // woord los zoekt, en het beste resultaat houden.
    if (scanQuality(pairs).ratio < 0.6) {
      onOcrProgress = (m) => setProgress(m.status === 'recognizing text' ? 'Lastige foto, tweede poging' : 'Bezig', m.progress);
      await worker.setParameters({ tessedit_pageseg_mode: '11' });
      try {
        const second = await worker.recognize(input, {}, { blocks: true });
        const alt = linesToPairs(linesFromBlocks(second.data.blocks), state.settings.leftIsFr, { ...options, sparse: true });
        if (scanQuality(alt).good > scanQuality(pairs).good) pairs = alt;
      } finally {
        await worker.setParameters({ tessedit_pageseg_mode: '4' });
      }
    }
    for (const p of pairs) p.snip = rowSnippet(area, p, state.settings.leftIsFr);
    if (!pairs.length && data.text) pairs = parseText(data.text, state.settings.leftIsFr);
    if (!pairs.length) {
      toast('Geen woorden gevonden. Probeer een scherpere foto of een kader om de lijst.');
      return;
    }
    addPairs(pairs);
    // Foto open laten: zo kun je meteen een kader om het volgende blok slepen.
    const scannedBlock = !!crop;
    crop = null;
    updateCropBox();
    toast(scannedBlock
      ? `${pairs.length} woorden toegevoegd. Sleep een kader om het volgende blok, of kies "Klaar met deze foto".`
      : `${pairs.length} woorden toegevoegd. Controleer ze even, scannen gaat niet altijd foutloos.`);
  } catch (err) {
    toast(`Scannen mislukt: ${err.message || err}`);
  } finally {
    btn.disabled = false;
    $('scan-progress').hidden = true;
    onOcrProgress = null;
  }
});

// ---------- Overhoring ----------

let quiz = null;

// Kies expliciet een Franse stem; alleen lang='fr-FR' zetten laat sommige
// browsers zwijgen of een Engelse stem gebruiken. De stemmenlijst laadt soms
// pas later, vandaar 'voiceschanged'.
let frenchVoice = null;
function pickFrenchVoice() {
  const voices = speechSynthesis.getVoices().filter((v) => /^fr/i.test(v.lang.replace('_', '-')));
  const rank = (v) => (/fr-FR/i.test(v.lang.replace('_', '-')) ? 2 : 0) + (/natural|google|online/i.test(v.name) ? 1 : 0);
  frenchVoice = voices.sort((a, b) => rank(b) - rank(a))[0] || null;
}
if (canSpeak) {
  pickFrenchVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickFrenchVoice);
}

function speak(text, quiet = false) {
  if (!canSpeak || !text) return;
  if (!frenchVoice) pickFrenchVoice();
  if (!frenchVoice) {
    if (quiet) return;
    toast('Geen Franse stem gevonden. Windows: Instellingen > Tijd en taal > Spraak > Stemmen toevoegen > Frans. Android: Instellingen > Tekst-naar-spraak.');
    return;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = frenchVoice;
  u.lang = frenchVoice.lang;
  u.rate = 0.9;
  // Chrome zwijgt soms als speak() direct na cancel() komt.
  setTimeout(() => speechSynthesis.speak(u), 60);
}

function accentBar(bar, input) {
  bar.innerHTML = ACCENTS.map((a) => `<button type="button" data-ch="${esc(a)}">${esc(a)}</button>`).join('');
  bar.addEventListener('pointerdown', (e) => {
    const ch = e.target.dataset.ch;
    if (!ch) return;
    e.preventDefault(); // focus in het invoerveld houden, zodat het toetsenbord open blijft
    const { selectionStart: s, selectionEnd: t, value } = input;
    input.value = value.slice(0, s) + ch + value.slice(t);
    input.setSelectionRange(s + ch.length, s + ch.length);
    input.focus();
  });
}
accentBar($('accents'), $('q-input'));
accentBar($('l-accents'), $('l-input'));

function startQuiz(questions, pool) {
  if (!questions.length) return;
  quiz = { questions, index: 0, results: [], pool };
  if (current === 'quiz') renderQuestion(); else { show('quiz'); renderQuestion(); }
}

function renderQuestion() {
  const q = quiz.questions[quiz.index];
  const total = quiz.questions.length;
  quiz.answered = false;
  $('q-count').textContent = `Vraag ${quiz.index + 1} van ${total}`;
  $('q-dir').textContent = q.dir === 'fn' ? 'Frans → Nederlands' : 'Nederlands → Frans';
  $('q-bar').style.width = `${(quiz.index / total) * 100}%`;
  $('q-prompt').textContent = q.prompt;
  $('q-prompt').lang = q.dir === 'fn' ? 'fr' : 'nl';
  $('q-speak').hidden = !(canSpeak && q.dir === 'fn');
  $('q-feedback').hidden = true;

  const typing = state.settings.mode === 'type';
  $('q-form').hidden = !typing;
  $('q-choices').hidden = typing;
  if (typing) {
    const input = $('q-input');
    input.value = '';
    input.disabled = false;
    input.lang = q.answerLang;
    input.placeholder = q.answerLang === 'fr' ? 'In het Frans' : 'In het Nederlands';
    $('accents').hidden = q.answerLang !== 'fr';
    $('q-check').hidden = false;
    input.focus();
  } else {
    const pool = quiz.pool.length >= 4 ? quiz.pool : quiz.questions.map((x) => x.word);
    $('q-choices').innerHTML = choicesFor(q, pool).map((c) => `<button class="btn secondary" data-choice="${esc(c)}">${esc(c)}</button>`).join('');
  }
}

function answer(given) {
  if (quiz.answered) return;
  quiz.answered = true;
  const q = quiz.questions[quiz.index];
  const verdict = state.settings.mode === 'choice'
    ? (given === q.answer ? 'correct' : 'wrong')
    : checkAnswer(given, q.answer, q.answerLang);
  quiz.results[quiz.index] = { q, given, ok: verdict !== 'wrong' };
  showFeedback(verdict);
}

function showFeedback(verdict) {
  const q = quiz.questions[quiz.index];
  const fb = $('q-feedback');
  fb.className = `feedback ${verdict}`;
  $('q-verdict').textContent = { correct: 'Goed!', accent: 'Goed, maar let op de accenten', wrong: 'Helaas, fout' }[verdict];
  $('q-correct').innerHTML = verdict === 'correct' ? '' : `Het juiste antwoord is: <strong lang="${q.answerLang}">${esc(q.answer)}</strong>`;
  $('q-override').hidden = verdict !== 'wrong' || state.settings.mode === 'choice';
  $('q-speak-answer').hidden = !canSpeak;
  fb.hidden = false;
  $('q-input').disabled = true;
  $('q-check').hidden = true;
  $('accents').hidden = true;
  document.querySelectorAll('#q-choices button').forEach((b) => {
    b.disabled = true;
    if (b.dataset.choice === q.answer) b.classList.add('right');
    else if (b.dataset.choice === quiz.results[quiz.index].given) b.classList.add('wrong');
  });
  $('q-next').focus();
}

$('q-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!quiz.answered) answer($('q-input').value);
});
$('q-choices').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-choice]');
  if (b) answer(b.dataset.choice);
});
$('q-override').addEventListener('click', () => {
  quiz.results[quiz.index].ok = true;
  quiz.results[quiz.index].overridden = true;
  showFeedback('correct');
});
$('q-speak').addEventListener('click', () => speak(quiz.questions[quiz.index].prompt));
$('q-speak-answer').addEventListener('click', () => {
  const q = quiz.questions[quiz.index];
  speak(q.dir === 'fn' ? q.prompt : q.answer);
});

$('q-next').addEventListener('click', () => {
  const r = quiz.results[quiz.index];
  recordResult(r.q.word, r.q.dir, r.ok);
  save();
  quiz.index++;
  if (quiz.index < quiz.questions.length) renderQuestion(); else showResult();
});

// ---------- Uitslag ----------

function showResult() {
  const res = quiz.results;
  const good = res.filter((r) => r.ok).length;
  const part = (dir) => {
    const rs = res.filter((r) => r.q.dir === dir);
    return rs.length ? `${rs.filter((r) => r.ok).length} van ${rs.length}` : null;
  };
  $('r-score').textContent = `${good} / ${res.length}`;
  $('r-detail').textContent = [
    part('fn') && `Frans → Nederlands: ${part('fn')}`,
    part('nf') && `Nederlands → Frans: ${part('nf')}`,
  ].filter(Boolean).join('. ');
  const wrong = res.filter((r) => !r.ok);
  $('r-mistakes').innerHTML = wrong.length
    ? `<h2>Fouten</h2>${wrong.map((r) => `<div class="mistake">
        <div class="q">${esc(r.q.prompt)}</div>
        <div class="a">Jouw antwoord: ${esc(r.given || '(leeg)')}. Goed is: <strong>${esc(r.q.answer)}</strong></div>
      </div>`).join('')}`
    : '<p class="muted">Geen fouten. Knap gedaan!</p>';
  $('r-retry').hidden = !wrong.length;
  history.replaceState({ view: 'result' }, '');
  current = 'result';
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== 'result';
  $('title').textContent = TITLES.result;
  window.scrollTo(0, 0);
}

$('r-retry').addEventListener('click', () => {
  const again = shuffle(quiz.results.filter((r) => !r.ok).map((r) => r.q));
  history.replaceState({ view: 'quiz' }, '');
  current = 'quiz';
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== 'quiz';
  $('title').textContent = TITLES.quiz;
  startQuiz(again, quiz.pool);
});
$('r-again').addEventListener('click', () => {
  history.replaceState({ view: 'quiz' }, '');
  current = 'quiz';
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== 'quiz';
  $('title').textContent = TITLES.quiz;
  startQuiz(buildQuiz(quiz.pool, PER_DIRECTION), quiz.pool);
});
$('r-home').addEventListener('click', () => history.back());

// ---------- Leren ----------

let learn = null;
const STEP_NAMES = { card: 'Kaartjes bekijken', choice: 'Meerkeuze', type: 'Zelf intypen' };
// Hoe vaak een woord per stap aan bod komt als het niet lukt.
const MAX_TRIES = { card: 3, choice: 2, type: 3 };

const learnStep = () => learn.phases[learn.phase].name;

function startLearn(pool) {
  const words = pickLearnWords(pool, LEARN_SIZE);
  if (!words.length) return;
  const typing = !state.settings.skipTyping;
  const phases = learnPhases(words, typing);
  learn = {
    pool, words, typing, phases, phase: 0, queue: [], done: 0, missed: new Set(), finished: false,
    total: phases.reduce((n, p) => n + p.items.length, 0),
  };
  learn.queue = phases[0].items.map((q) => ({ q, tries: 0 }));
  if (current !== 'learn') show('learn');
  nextLearnItem();
}

function nextLearnItem() {
  while (!learn.queue.length) {
    learn.phase++;
    if (learn.phase >= learn.phases.length) {
      showLearnDone();
      return;
    }
    learn.queue = learn.phases[learn.phase].items.map((q) => ({ q, tries: 0 }));
  }
  learn.item = learn.queue.shift();
  learn.answered = false;
  renderLearnItem();
}

function renderLearnItem() {
  const step = learnStep();
  const { q } = learn.item;
  $('l-step').textContent = `Stap ${learn.phase + 1} van ${learn.phases.length}: ${STEP_NAMES[step]}`;
  $('l-count').hidden = false;
  $('l-count').textContent = `nog ${learn.queue.length + 1}`;
  $('l-bar').style.width = `${(learn.done / learn.total) * 100}%`;
  $('l-done').hidden = true;
  $('l-card-step').hidden = step !== 'card';
  $('l-question').hidden = step === 'card';
  window.scrollTo(0, 0);

  if (step === 'card') {
    $('l-front').textContent = q.word.fr;
    $('l-back').textContent = q.word.nl;
    $('l-back').hidden = true;
    $('l-tap').hidden = false;
    $('l-card-answer').hidden = true;
    $('l-card-speak').hidden = !canSpeak;
    $('l-card').focus();
    speak(q.word.fr, true);
    return;
  }

  $('l-prompt').textContent = q.prompt;
  $('l-prompt').lang = q.dir === 'fn' ? 'fr' : 'nl';
  $('l-speak').hidden = !(canSpeak && q.dir === 'fn');
  $('l-feedback').hidden = true;
  const typing = step === 'type';
  $('l-form').hidden = !typing;
  $('l-choices').hidden = typing;
  if (typing) {
    const input = $('l-input');
    input.value = '';
    input.disabled = false;
    const hint = hintFor(q.answer);
    $('l-hint').textContent = hint ? `Begint met: ${hint}` : '';
    $('l-accents').hidden = false;
    $('l-check').hidden = false;
    input.focus();
  } else {
    const pool = learn.pool.length >= 4 ? learn.pool : learn.words;
    $('l-choices').innerHTML = choicesFor(q, pool).map((c) => `<button class="btn secondary" data-choice="${esc(c)}">${esc(c)}</button>`).join('');
  }
}

// Verwerkt het antwoord op het huidige woord en gaat door. Lukt het niet,
// dan komt het woord aan het eind van deze stap nog een keer terug.
function learnResult(ok) {
  const it = learn.item;
  const step = learnStep();
  if (it.tries === 0 && learnRecords(step, it.q.dir, learn.typing)) {
    recordResult(it.q.word, it.q.dir, ok);
    save();
  }
  if (!ok) learn.missed.add(it.q.word);
  if (!ok && it.tries < MAX_TRIES[step] - 1) {
    it.tries++;
    learn.queue.push(it);
  } else {
    learn.done++;
  }
  nextLearnItem();
}

function learnAnswer(given) {
  if (learn.answered) return;
  learn.answered = true;
  const { q } = learn.item;
  const verdict = learnStep() === 'type'
    ? checkAnswer(given, q.answer, q.answerLang)
    : (given === q.answer ? 'correct' : 'wrong');
  learn.given = given;
  learn.ok = verdict !== 'wrong';
  showLearnFeedback(verdict);
}

function showLearnFeedback(verdict) {
  const { q, tries } = learn.item;
  const step = learnStep();
  const fb = $('l-feedback');
  fb.className = `feedback ${verdict}`;
  $('l-verdict').textContent = { correct: 'Goed!', accent: 'Goed, maar let op de accenten', wrong: 'Helaas, fout' }[verdict];
  const again = verdict === 'wrong' && tries < MAX_TRIES[step] - 1 ? ' Dit woord komt straks nog een keer terug.' : '';
  $('l-correct').innerHTML = verdict === 'correct' ? '' : `Het juiste antwoord is: <strong lang="${q.answerLang}">${esc(q.answer)}</strong>.${again}`;
  $('l-override').hidden = verdict !== 'wrong' || step !== 'type';
  $('l-speak-answer').hidden = !canSpeak;
  fb.hidden = false;
  $('l-input').disabled = true;
  $('l-check').hidden = true;
  $('l-accents').hidden = true;
  document.querySelectorAll('#l-choices button').forEach((b) => {
    b.disabled = true;
    if (b.dataset.choice === q.answer) b.classList.add('right');
    else if (b.dataset.choice === learn.given) b.classList.add('wrong');
  });
  $('l-next').focus();
}

function showLearnDone() {
  learn.finished = true;
  $('l-step').textContent = 'Ronde klaar';
  $('l-count').hidden = true;
  $('l-bar').style.width = '100%';
  $('l-card-step').hidden = true;
  $('l-question').hidden = true;
  $('l-done').hidden = false;
  const hard = learn.words.filter((w) => learn.missed.has(w)).length;
  $('l-summary').textContent = hard
    ? `Je hebt ${learn.words.length} woorden geoefend. ${hard === 1 ? '1 woord ging' : `${hard} woorden gingen`} nog niet meteen goed (oranje).`
    : `Je hebt ${learn.words.length} woorden geoefend en alles ging meteen goed.`;
  $('l-words').innerHTML = learn.words.map((w) => `<div class="word-result${learn.missed.has(w) ? ' hard' : ''}">
      <strong lang="fr">${esc(w.fr)}</strong> <span class="muted">= ${esc(w.nl)}</span>
    </div>`).join('');
  window.scrollTo(0, 0);
}

$('l-card').addEventListener('click', () => {
  $('l-back').hidden = false;
  $('l-tap').hidden = true;
  $('l-card-answer').hidden = false;
});
$('l-card-speak').addEventListener('click', () => speak(learn.item.q.word.fr));
$('l-know').addEventListener('click', () => learnResult(true));
$('l-again').addEventListener('click', () => learnResult(false));
$('l-choices').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-choice]');
  if (b) learnAnswer(b.dataset.choice);
});
$('l-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!learn.answered) learnAnswer($('l-input').value);
});
$('l-override').addEventListener('click', () => {
  learn.ok = true;
  showLearnFeedback('correct');
});
$('l-speak').addEventListener('click', () => speak(learn.item.q.prompt));
$('l-speak-answer').addEventListener('click', () => {
  const { q } = learn.item;
  speak(q.dir === 'fn' ? q.prompt : q.answer);
});
$('l-next').addEventListener('click', () => learnResult(learn.ok));
$('l-more').addEventListener('click', () => startLearn(learn.pool));
$('l-to-quiz').addEventListener('click', () => startQuiz(buildQuiz(learn.pool, PER_DIRECTION), learn.pool));
$('l-home').addEventListener('click', () => history.back());

// ---------- Start de app ----------

renderHome();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
