/* Tests for the parsers in aboutme-panel.js (19 Oct 2026): how each Notion
   page of the About Me tab is read. Run: node tests/aboutme.test.mjs
   The panel runs in a sandbox with a stub window and document. The
   personality text here is invented. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const SRC = fs.readFileSync(new URL('../aboutme-panel.js', import.meta.url), 'utf8');
const ctx = { window: {}, document: { addEventListener() {}, getElementById() { return null; } } };
vm.createContext(ctx);
vm.runInContext(SRC, ctx);
const P = ctx.window.__meParse;
const plain = (x) => JSON.parse(JSON.stringify(x));

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', n, name); };

t('impact: years since, plus signs, lists and the Netflix line', () => {
  const s = plain(P.parseImpact('Dancing since: 2009 (\\~16 years)\nMermaid performer since: \\~2016\nCertifications: 18+\nCountries: 8+ (USA, China)\nCrew size: 13+ years\nNetflix feature: MerPeople\n*a note in italics*', 2026)
    .map((x) => [x.big, x.sub]));
  assert.deepEqual(s, [
    ['16 yrs', 'Dancing, since 2009'],
    ['10 yrs', 'Mermaid performer, since 2016'],
    ['18+', 'Certifications'],
    ['8+', 'Countries: USA, China'],
    ['13+ yrs', 'Crew size'],
    ['MerPeople', 'Netflix feature'],
  ]);
});

t('medals: year, title, extras, place, group and medal', () => {
  const md = '## Mermaid Competitions\n- 2023 — 1st Winner, Open Category, Some Cup\n- 2023 — Runner-up 1 Costume, A Contest, Bangkok\n- 2022 — Sea Queen of X · Top 10 Finalist · Runner-up Most Talented (Miami, USA)\n- 2021 — Country Representative, Big Open\n- 2020 — Finalist, Show Cup\n## Dance Competitions\n- 2010–2014 — Multiple 1st / 2nd place titles\n- 2018 — Juara Menari (solo)';
  const m = plain(P.parseMedals(md));
  assert.equal(m.length, 7);
  assert.deepEqual(m.map((x) => x.kind), ['gold', 'silver', 'star', 'flag', 'ribbon', 'gold', 'gold']);
  assert.equal(m[2].title, 'Sea Queen of X');
  assert.deepEqual(m[2].extra, ['Top 10 Finalist', 'Runner-up Most Talented']);
  assert.equal(m[2].where, 'Miami, USA');
  assert.equal(m[5].year, '2010–2014');
  assert.equal(m[5].group, 'dance');
  assert.equal(m[6].where, 'solo');
});

t('film: posters with role and year, the rest as stage lines', () => {
  const f = plain(P.parseFilm('## Film & TV\n- "Deep" — Netflix documentary series (Cast, 2023)\n- "Wave" — short film (Talent & Director, 2024)\n## Performance\n- Aquarium — performer (2016–2020)'));
  assert.deepEqual(f.films.map((x) => [x.title, x.role, x.year, x.netflix]), [['Deep', 'Cast', '2023', true], ['Wave', 'Talent & Director', '2024', false]]);
  assert.equal(f.stage.length, 1);
  assert.equal(f.stage[0].section, 'Performance');
});

t('personality: type chips, through-line, traits, profile and tarot', () => {
  const md = '# Test\nBirth: invented · Blood type O · MBTI INFP.\n## Core Synthesis — STABLE\nThe through-line: a calm sea with a strong current.\n- Gentle leader — INFP + Water.\n- Curious mind — Sun + Moon.\n## Per-System Read\nAstrology: Sun in Leo (bright).\nChinese zodiac: Fire Horse — quick.\n## Practical Profile — STABLE\nStrengths: patience; warmth.\nBlind spots: overthinking.\n## Current Period — Tarot — REFRESH\n- Where you are — The Sun: bright days.\n- The knot — Three of Swords reversed: healing.\n## Who you are\n- A builder.';
  const p = plain(P.parsePersonality(md));
  assert.deepEqual(p.types.map((x) => x.k), ['INFP', 'Leo', 'Fire Horse', 'Type O']);
  assert.equal(p.through, 'a calm sea with a strong current.');
  assert.deepEqual(p.core, [{ trait: 'Gentle leader', from: 'INFP + Water.' }, { trait: 'Curious mind', from: 'Sun + Moon.' }]);
  assert.deepEqual(p.profile.map((x) => x.k), ['Strengths', 'Blind spots']);
  assert.deepEqual(p.tarot.map((x) => [x.role, x.card, x.reversed]), [['Where you are', 'The Sun', false], ['The knot', 'Three of Swords reversed', true]]);
  assert.deepEqual(p.who, ['A builder.']);
});

t('kind words: bullets and quotes, never an empty dash', () => {
  assert.deepEqual(plain(P.parseKind('Intro line.\n-\n- Thank you coach!\n> You changed my daughter')), ['Thank you coach!', 'You changed my daughter']);
});

t('images: only https photos from the page', () => {
  assert.deepEqual(plain(P.images('text\n![Stage](https://a.test/x.jpg)\n![](http://b.test/y.jpg)\n![](https://c.test/z.png)')), [{ src: 'https://a.test/x.jpg', cap: 'Stage' }, { src: 'https://c.test/z.png', cap: '' }]);
});

t('birth chart: placements, retrograde, houses, longitude, balance and aspects', () => {
  const md = [
    '## Per-System Read', "Astrology: Sun in Pisces; Aquarius rising; Moon in Gemini.",
    '## Birth Chart (STABLE)', 'Chart: tropical zodiac, Placidus houses.',
    'Elements: Water 6 · Earth 2 · Air 2 · Fire 0', 'Modes: Mutable 5 · Fixed 3 · Cardinal 2',
    "- Sun: Pisces 2°03' · house 1 · Feels first.",
    "- Mercury: Pisces 0°48' R · house 1 · Thinks in images.",
    "- Ascendant: Aquarius 9°15' · Visionary first.",
    '- Not a placement line',
    "- Moon: Atlantis 3°00' · house 5 · not a sign, ignored",
    '## Key Aspects (STABLE)',
    "- Sun conjunct Saturn, orb 0°42': Discipline sits in your identity.",
    "- Sun trine Moon, orb 5°29': Will and feelings cooperate.",
    '- a note without the pattern',
  ].join('\n');
  const c = plain(P.parseChart(md));
  assert.deepEqual(c.placements.map((p) => [p.name, p.sign, p.house, p.retro, Math.round(p.lon * 100) / 100]),
    [['Sun', 'Pisces', 1, false, 332.05], ['Mercury', 'Pisces', 1, true, 330.8], ['Ascendant', 'Aquarius', null, false, 309.25]]);
  assert.equal(c.placements[0].text, 'Feels first.');
  assert.deepEqual(c.elements, [{ k: 'Water', n: 6 }, { k: 'Earth', n: 2 }, { k: 'Air', n: 2 }, { k: 'Fire', n: 0 }]);
  assert.equal(c.modes.length, 3);
  assert.deepEqual(c.aspects.map((a) => [a.a, a.type, a.b, a.orb]), [['Sun', 'conjunct', 'Saturn', "0°42'"], ['Sun', 'trine', 'Moon', "5°29'"]]);
  assert.deepEqual(plain(P.parsePersonality(md).types).map((x) => x.v), ['Sun sign', 'Moon sign', 'Rising sign']);
  assert.deepEqual(plain(P.parseChart('## Other\n- Sun: Pisces 2°03\'')).placements, [], 'only the Birth Chart section counts');
});

console.log(n + ' passed');
