import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkAnswer, parseText, linesToPairs, enhanceContrast, isSentence, cleanCell, scanQuality, blueInkShare, languageScore, splitByInk, buildQuiz, choicesFor, recordResult, isKnown, formatDate,
  pickLearnWords, learnPhases, learnRecords, hintFor,
} from '../logic.js';

test('checkAnswer: exact, hoofdletters en leestekens', () => {
  assert.equal(checkAnswer('School', 'school', 'nl'), 'correct');
  assert.equal(checkAnswer("  l'école. ", "l'école", 'fr'), 'correct');
  assert.equal(checkAnswer('l’école', "l'école", 'fr'), 'correct');
});

test('checkAnswer: accenten vergeten telt als bijna goed', () => {
  assert.equal(checkAnswer("l'ecole", "l'école", 'fr'), 'accent');
  assert.equal(checkAnswer('coeur', 'cœur', 'fr'), 'accent');
});

test('checkAnswer: Nederlands lidwoord is optioneel, Frans niet', () => {
  assert.equal(checkAnswer('school', 'de school', 'nl'), 'correct');
  assert.equal(checkAnswer('het huis', 'huis', 'nl'), 'correct');
  assert.equal(checkAnswer('école', "l'école", 'fr'), 'wrong');
});

test('checkAnswer: spaties tellen niet mee (aan elkaar geplakt door de scan)', () => {
  assert.equal(checkAnswer('we eten', 'weeten', 'nl'), 'correct');
  assert.equal(checkAnswer('onfait', 'on fait', 'fr'), 'correct');
  assert.equal(checkAnswer('le pere', 'lepère', 'fr'), 'accent');
  assert.equal(checkAnswer('we zien', 'weeten', 'nl'), 'wrong');
});

test('linesToPairs: "ikben" wordt "ik ben"', () => {
  const pairs = linesToPairs([line(0, ['je suis', 'ikben']), line(40, ['je cherche', 'ikzoek'])]);
  assert.deepEqual(pairs.map((p) => p.nl), ['ik ben', 'ik zoek']);
});

test('checkAnswer: alternatieven en haakjes', () => {
  assert.equal(checkAnswer('fiets', 'de fiets / rijwiel', 'nl'), 'correct');
  assert.equal(checkAnswer('rijwiel', 'de fiets / rijwiel', 'nl'), 'correct');
  assert.equal(checkAnswer('heel, erg', 'heel, erg', 'nl'), 'correct');
  assert.equal(checkAnswer('erg', 'heel, erg', 'nl'), 'correct');
  assert.equal(checkAnswer('laver', '(se) laver', 'fr'), 'correct');
  assert.equal(checkAnswer('se laver', '(se) laver', 'fr'), 'correct');
  assert.equal(checkAnswer('', 'iets', 'nl'), 'wrong');
  assert.equal(checkAnswer('auto', 'fiets', 'nl'), 'wrong');
});

test('parseText: diverse scheidingstekens, koppeltekens in woorden blijven heel', () => {
  const pairs = parseText("l'école = de school\nle chat\tde kat\npeut-être - misschien\n\n1. la maison ; het huis");
  assert.deepEqual(pairs, [
    { fr: "l'école", nl: 'de school' },
    { fr: 'le chat', nl: 'de kat' },
    { fr: 'peut-être', nl: 'misschien' },
    { fr: 'la maison', nl: 'het huis' },
  ]);
  assert.deepEqual(parseText('de kat = le chat', false), [{ fr: 'le chat', nl: 'de kat' }]);
});

// Bouwt een OCR-regel: cellen staan op vaste x-posities (kolommen), woorden in een cel 10px uit elkaar.
const COLS = [0, 300, 600, 900];
function line(y, cells, { marker = '©', conf = 90 } = {}) {
  const words = [];
  cells.forEach((cell, col) => {
    if (cell == null) return;
    let x = COLS[col];
    if (marker) { words.push({ text: marker, confidence: 90, bbox: { x0: x, y0: y, x1: x + 20, y1: y + 20 } }); x += 30; }
    for (const t of cell.split(' ')) {
      words.push({ text: t, confidence: conf, bbox: { x0: x, y0: y, x1: x + 40, y1: y + 20 } });
      x += 50;
    }
  });
  return { words };
}

test('linesToPairs: twee woordenlijsten naast elkaar met bolletjes', () => {
  const pairs = linesToPairs([
    line(0, ['Frans', 'Nederlands', 'Frans', 'Nederlands'], { marker: null }),
    line(40, ['la plage', 'het strand', "aujourd'hui", 'vandaag']),
    line(80, ['la mer', 'de zee', 'demain', 'morgen']),
  ]);
  assert.deepEqual(pairs, [
    { fr: 'la plage', nl: 'het strand' },
    { fr: "aujourd'hui", nl: 'vandaag' },
    { fr: 'la mer', nl: 'de zee' },
    { fr: 'demain', nl: 'morgen' },
  ]);
});

test('linesToPairs: gemist woord laat een lege cel, de rest verschuift niet', () => {
  const pairs = linesToPairs([
    line(0, ['un', 'een', 'deux', 'twee']),
    line(40, ['trois', 'drie', 'quatre', 'vier']),
    line(80, ['cinq', 'vijf', 'six', 'zes']),
    line(120, [null, 'zeven', 'huit', 'acht']),
  ]);
  assert.deepEqual(pairs.slice(-2), [{ fr: '', nl: 'zeven' }, { fr: 'huit', nl: 'acht' }]);
});

test('linesToPairs: vervolgregel zonder bolletje hoort bij de cel erboven', () => {
  const pairs = linesToPairs([
    line(0, ['le sport', 'de sport', 'voir', 'zien']),
    line(40, ['elle déteste', 'ze heeft een hekel', 'moi', 'ik']),
    line(80, [null, 'aan'], { marker: null }),
    line(120, ['on fait', 'we doen', 'autre', 'ander']),
  ]);
  assert.ok(pairs.some((p) => p.fr === 'elle déteste' && p.nl === 'ze heeft een hekel aan'));
  assert.ok(!pairs.some((p) => p.nl === 'aan' || p.fr === 'aan'));
});

test('linesToPairs: losse regel met = en omgekeerde kolommen', () => {
  const words = ['oui', '=', 'ja'].map((t, i) => ({ text: t, confidence: 90, bbox: { x0: i * 50, y0: 0, x1: i * 50 + 40, y1: 20 } }));
  assert.deepEqual(linesToPairs([{ words }]), [{ fr: 'oui', nl: 'ja' }]);
  assert.deepEqual(linesToPairs([line(0, ['de kat', 'le chat'])], false), [{ fr: 'le chat', nl: 'de kat' }]);
});

test('linesToPairs: woorden met lage zekerheid en losse tekens vallen weg', () => {
  const pairs = linesToPairs([line(0, ['le chat', 'de kat']), line(40, ['xq zz', 'wq'], { conf: 5 })]);
  assert.deepEqual(pairs, [{ fr: 'le chat', nl: 'de kat' }]);
});

test('isSentence en cleanCell', () => {
  assert.equal(isSentence('Hoe heet jij?'), true);
  assert.equal(isSentence("Je m'appelle Max"), true);
  assert.equal(isSentence('Dat is een stad.'), true);
  assert.equal(isSentence('ze heeft een hekel aan'), false);
  assert.equal(isSentence('la France'), false);
  assert.equal(isSentence('Ila15ans'), true);
  assert.equal(cleanCell('O iets.'), 'iets');
  assert.equal(cleanCell('O_iets'), 'iets');
  assert.equal(cleanCell('Oui'), 'Oui');
});

test('linesToPairs: zinnen overslaan', () => {
  const lines = [line(0, ['le chat', 'de kat']), line(40, ['Comment tu t\'appelles?', 'Hoe heet jij?'])];
  assert.equal(linesToPairs(lines).length, 2);
  assert.deepEqual(linesToPairs(lines, true, { skipSentences: true }), [{ fr: 'le chat', nl: 'de kat' }]);
});

test('linesToPairs: aan elkaar geplakte woorden splitsen op grote letterafstand', () => {
  // "lamer": tussen a en m zit 17px, tussen de andere letters 5 a 6px.
  const xs = [[0, 15], [20, 35], [52, 70], [76, 90], [96, 110]];
  const symbols = [...'lamer'].map((t, i) => ({ text: t, bbox: { x0: xs[i][0], x1: xs[i][1], y0: 0, y1: 33 } }));
  const w = { text: 'lamer', confidence: 90, bbox: { x0: 0, x1: 110, y0: 0, y1: 33 }, symbols };
  const zee = [{ text: 'de', confidence: 90, bbox: { x0: 400, x1: 430, y0: 0, y1: 33 } }, { text: 'zee', confidence: 90, bbox: { x0: 440, x1: 480, y0: 0, y1: 33 } }];
  assert.deepEqual(linesToPairs([{ words: [w, ...zee] }]), [{ fr: 'la mer', nl: 'de zee' }]);
  // "Frans" met één grote afstand na de F blijft heel (geen losse letter afsplitsen).
  const fr = [...'Frans'].map((t, i) => ({ text: t, bbox: { x0: i ? 40 + i * 20 : 0, x1: i ? 55 + i * 20 : 15, y0: 0, y1: 33 } }));
  assert.deepEqual(linesToPairs([{ words: [{ text: 'Frans', confidence: 90, bbox: { x0: 0, x1: 135, y0: 0, y1: 33 }, symbols: fr }] }]), []);
});

const complete = [
  line(0, ['un', 'een', 'deux', 'twee']),
  line(40, ['trois', 'drie', 'quatre', 'vier']),
  line(80, ['cinq', 'vijf', 'six', 'zes']),
];

test('linesToPairs: rij die als twee helften gelezen is wordt weer één paar', () => {
  const pairs = linesToPairs([...complete, line(120, ['peut-être', null, 'sept', 'zeven']), line(122, [null, 'misschien'])]);
  assert.ok(pairs.some((p) => p.fr === 'peut-être' && p.nl === 'misschien'), JSON.stringify(pairs));
  assert.ok(!pairs.some((p) => !p.fr || !p.nl));
});

test('linesToPairs: dubbel gelezen tekst en onzekere rommel vallen weg', () => {
  const ghost = line(80, ['ourquoi', 'ij'], { conf: 40 });
  const junk = line(200, ['te', 'Like'], { conf: 40 });
  const pairs = linesToPairs([line(80, ['pourquoi', 'waarom']), ghost, junk]);
  assert.deepEqual(pairs, [{ fr: 'pourquoi', nl: 'waarom' }]);
});

test('linesToPairs: gebogen pagina, Franse kolom een regel lager dan de Nederlandse', () => {
  // Zoals in het boek: "et" staat op de hoogte van "ja" in plaats van "en".
  const fr = ['et', 'oui', 'non', 'ici', 'alors'];
  const nl = ['en', 'ja', 'nee', 'hier', 'dus'];
  const cell = (text, x, y) => ({ words: [
    { text: 'O', confidence: 90, bbox: { x0: x, y0: y, x1: x + 20, y1: y + 20 } },
    { text, confidence: 90, bbox: { x0: x + 30, y0: y, x1: x + 90, y1: y + 20 } },
  ] });
  const lines = [...fr.map((t, i) => cell(t, 0, 30 + i * 30)), ...nl.map((t, i) => cell(t, 300, i * 30))];
  assert.deepEqual(linesToPairs(lines), fr.map((f, i) => ({ fr: f, nl: nl[i] })));
});

test('scanQuality: telt complete, zekere paren', () => {
  const q = scanQuality([{ fr: 'a b', nl: 'c', conf: 90 }, { fr: 'x', nl: '', conf: 90 }, { fr: 'y', nl: 'z', conf: 40 }]);
  assert.deepEqual(q, { good: 1, ratio: 1 / 3 });
});

test('blueInkShare: blauwe pen tegenover zwarte drukinkt', () => {
  const pixels = (rgb, n) => new Uint8ClampedArray(Array.from({ length: n }, () => [...rgb, 255]).flat());
  assert.ok(blueInkShare(pixels([67, 60, 101], 100)) > 0.9);
  assert.equal(blueInkShare(pixels([61, 56, 59], 100)), 0);
  assert.equal(blueInkShare(pixels([240, 240, 240], 100)), 0);
});

test('linesToPairs: dropCell laat cellen weg (handschrift)', () => {
  const pairs = linesToPairs([line(0, ['le chat', 'de kat']), line(40, ['moeilijk'])], true, { dropCell: (c) => c.y0 >= 40 });
  assert.deepEqual(pairs, [{ fr: 'le chat', nl: 'de kat' }]);
});

test('linesToPairs: tekst zonder bolletje (kop, instructie) valt weg als het boek bolletjes gebruikt', () => {
  const pairs = linesToPairs([
    line(0, ['Gebruik Slim stampen om'], { marker: null }),
    ...complete,
    line(160, ['cinquante-deux Chapitre'], { marker: null }),
  ]);
  assert.ok(!pairs.some((p) => /Slim|Chapitre/.test(p.fr + p.nl)), JSON.stringify(pairs));
  assert.equal(pairs.length, 6);
});

test('languageScore: duidelijke gevallen, twijfel blijft 0-achtig', () => {
  for (const fr of ["l'école", 'la fenêtre', 'merci', 'quelque chose', 'dangereux']) assert.ok(languageScore(fr) >= 1, fr);
  for (const nl of ['nee', 'dankjewel', 'het huis', 'ik ben', 'de school']) assert.ok(languageScore(nl) <= -0.5, nl);
  assert.ok(Math.abs(languageScore('super')) < 1);
});

test('linesToPairs: Nederlands woord alleen aan de Franse kant wordt verplaatst', () => {
  const pairs = linesToPairs([line(0, ['le chat', 'de kat']), line(40, ['dankjewel'])]);
  assert.deepEqual(pairs[1], { fr: '', nl: 'dankjewel' });
  const swapped = linesToPairs([line(0, ['het huis', 'la maison'])]);
  assert.deepEqual(swapped, [{ fr: 'la maison', nl: 'het huis' }]);
});

test('splitByInk: echte spatie in de pixels, apostrof en dunne letters blijven heel', () => {
  // Inktpatronen gemeten op de foto (1 = inkt in die pixelkolom).
  const cols = (p) => [...p].map((c) => c === '#');
  const word = (text, pattern, h) => ({ text, confidence: 90, bbox: { x0: 0, x1: pattern.length, y0: 0, y1: h } });
  const weeten = '.....###################################....####################..............####################..#################...####################......####################.....';
  assert.deepEqual(splitByInk(word('weeten', weeten, 37), cols(weeten)).map((w) => w.text), ['we', 'eten']);
  const onfait = '.....#####################......####################..............#################.##################.......######...################.....';
  assert.deepEqual(splitByInk(word('onfait', onfait, 39), cols(onfait)).map((w) => w.text), ['on', 'fait']);
  const habite = '##########..................##########..........##########........##########..........##########........##########......##########......##########';
  assert.deepEqual(splitByInk(word("J'habite", habite, 41), cols(habite)).map((w) => w.text), ["J'habite"]);
});

test('enhanceContrast: blauwe achtergrond wordt wit, tekst zwart', () => {
  const d = new Uint8ClampedArray([200, 215, 240, 255, 30, 30, 40, 255, 200, 215, 240, 255, 200, 215, 240, 255]);
  enhanceContrast(d);
  assert.equal(d[0], 255);
  assert.equal(d[4], 0);
  assert.equal(d[0], d[1]);
});

test('buildQuiz: 10 + 10, onbekende woorden eerst', () => {
  const pool = Array.from({ length: 15 }, (_, i) => ({ id: i, fr: `fr${i}`, nl: `nl${i}`, stats: {} }));
  for (let i = 0; i < 5; i++) pool[i].stats.fn = { streak: 3, right: 3, wrong: 0 };
  const quiz = buildQuiz(pool, 10);
  assert.equal(quiz.length, 20);
  const fn = quiz.filter((q) => q.dir === 'fn');
  assert.equal(fn.length, 10);
  assert.ok(fn.every((q) => q.word.id >= 5), 'geleerde woorden niet nodig als er genoeg andere zijn');
  assert.equal(quiz.filter((q) => q.dir === 'nf').length, 10);
});

test('buildQuiz: kleine lijst levert minder vragen, lege paren worden overgeslagen', () => {
  const pool = [{ fr: 'oui', nl: 'ja' }, { fr: 'non', nl: '' }];
  assert.equal(buildQuiz(pool, 10).length, 2);
});

test('choicesFor: goed antwoord zit erin, geen dubbele', () => {
  const pool = [{ fr: 'a', nl: 'x' }, { fr: 'b', nl: 'y' }, { fr: 'c', nl: 'Y' }, { fr: 'd', nl: 'z' }, { fr: 'e', nl: 'w' }];
  const choices = choicesFor({ answer: 'x', answerLang: 'nl' }, pool);
  assert.equal(choices.length, 4);
  assert.ok(choices.includes('x'));
  assert.equal(new Set(choices.map((c) => c.toLowerCase())).size, 4);
});

test('recordResult en isKnown', () => {
  const w = { fr: 'a', nl: 'b' };
  recordResult(w, 'fn', true); recordResult(w, 'fn', true);
  assert.equal(isKnown(w, 'fn'), false);
  recordResult(w, 'fn', true);
  assert.equal(isKnown(w, 'fn'), true);
  recordResult(w, 'fn', false);
  assert.equal(isKnown(w, 'fn'), false);
  assert.equal(w.stats.fn.right, 3);
});

test('formatDate: DD-MM-YYYY', () => {
  assert.equal(formatDate(new Date(2026, 9, 5)), '05-10-2026');
});

test('pickLearnWords: onbekende woorden eerst, bekende als laatste', () => {
  const known = { fr: 'oui', nl: 'ja', stats: { fn: { streak: 3 }, nf: { streak: 3 } } };
  const half = { fr: 'non', nl: 'nee', stats: { fn: { streak: 3 } } };
  const fresh = { fr: 'chat', nl: 'kat' };
  const empty = { fr: 'chien', nl: '' };
  assert.deepEqual(pickLearnWords([known, half, fresh, empty], 2), [fresh, half]);
  assert.equal(pickLearnWords([known, half, fresh], 5).length, 3);
});

test('learnPhases: kaartjes, meerkeuze in beide richtingen, intypen naar het Frans', () => {
  const words = [{ fr: 'a', nl: 'x' }, { fr: 'b', nl: 'y' }];
  const phases = learnPhases(words, true);
  assert.deepEqual(phases.map((p) => p.name), ['card', 'choice', 'type']);
  assert.equal(phases[0].items.length, 2);
  assert.equal(phases[1].items.filter((q) => q.dir === 'fn').length, 2);
  assert.equal(phases[1].items.filter((q) => q.dir === 'nf').length, 2);
  assert.ok(phases[2].items.every((q) => q.dir === 'nf' && q.answerLang === 'fr'));
  assert.deepEqual(learnPhases(words, false).map((p) => p.name), ['card', 'choice']);
});

test('learnRecords: welke stap telt mee voor "ken ik al"', () => {
  assert.equal(learnRecords('card', 'fn', true), false);
  assert.equal(learnRecords('choice', 'fn', true), true);
  assert.equal(learnRecords('choice', 'nf', true), false);
  assert.equal(learnRecords('choice', 'nf', false), true);
  assert.equal(learnRecords('type', 'nf', true), true);
});

test('hintFor: lidwoord plus eerste letter', () => {
  assert.equal(hintFor('la maison'), 'la m…');
  assert.equal(hintFor("l'école"), "l'é…");
  assert.equal(hintFor('manger'), 'm…');
  assert.equal(hintFor('(se) laver'), '(se) l…');
  assert.equal(hintFor('très / bien'), 't…');
  assert.equal(hintFor('à'), '');
});
