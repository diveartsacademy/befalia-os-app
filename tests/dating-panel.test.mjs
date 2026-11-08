/* Tests for dating-panel.js (8 Nov 2026): how the Dating Profile Answers page
   in Notion is read and drawn. Run: node tests/dating-panel.test.mjs
   The panel runs in a sandbox with a stub window and document. The answers
   here are invented. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const SRC = fs.readFileSync(new URL('../dating-panel.js', import.meta.url), 'utf8');
const ctx = { window: {}, document: { addEventListener() {}, getElementById() { return null; }, body: { classList: { contains() { return false; } } } } };
vm.createContext(ctx);
vm.runInContext(SRC, ctx);
const D = ctx.window.__dpParse;
const plain = (x) => JSON.parse(JSON.stringify(x));

// What the phone bridge (api/notion.js fetchPageText) sends: plain text, bold lost.
export const PHONE = `<content>
My master answers for dating forms. Copy from here.
## Applications
- Matchmaker One: submitted 8 Nov 2026
- Matchmaker Two: started 8 Nov 2026, page 2 of 8
- App Three: active profile
## Quick fields
Name: Test Person (Tess)
Age / date of birth: 30 / 1 Jan 1996
Based: Ubud, Bali, Indonesia (I travel often)
Height: 5'4" (163 cm)
Email: test@example.com
LinkedIn: https://www.linkedin.com/in/test/
Languages: English, Indonesian
## About me
What I do professionally
I run a small studio. I love it.
Education
I studied architecture.
Drink, smoke, drugs
I don't smoke. I drink occasionally.
## What I'm looking for
Physical
Tall and kind.
Deal-breakers
Personality: cheating, gaslighting or manipulation, yelling during fights, and lack of ambition. Physical: none beyond my height range.
Age range: 30 to 42
Height range: 5'8" to 6'3"
Locations and relocation
Open anywhere if serious.
## Quick answers
- Want kids: Yes
- Have kids: No
- Ideal first date: Either dinner and drinks, or a walk and coffee
## Best photos to use
1. Studio portrait
2. Beach photo
Use original files, not screenshots.
## Interview prep (still to think through)
- [ ] My timeline
- [x] Family views
</content>`;

// What the desktop connector sends: <b> labels, markdown links, escapes.
const DESKTOP = `<content>
## Quick fields
<b>Name:</b> Test Person (Tess)
<b>Email:</b> [test@example.com](mailto:test@example.com)
## About me
<b>What I do professionally</b>
I run a small studio.
<b>Age range:</b> 30 to 42
</content>`;

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', n, name); };

t('phone format: intro, sections and every item type', () => {
  const p = plain(D.parse(PHONE));
  assert.equal(p.intro, 'My master answers for dating forms. Copy from here.');
  assert.deepEqual(p.sections.map((s) => s.title), ['Applications', 'Quick fields', 'About me', "What I'm looking for", 'Quick answers', 'Best photos to use', 'Interview prep (still to think through)']);
  const apps = p.sections[0].items;
  assert.equal(apps.length, 3);
  assert.deepEqual([apps[1].type, apps[1].label, apps[1].value], ['fact', 'Matchmaker Two', 'started 8 Nov 2026, page 2 of 8']);
  const about = p.sections[2].items;
  assert.deepEqual(about.map((x) => [x.type, x.label]), [['block', 'What I do professionally'], ['block', 'Education'], ['block', 'Drink, smoke, drugs']]);
  assert.equal(about[0].text, 'I run a small studio. I love it.');
  const look = p.sections[3].items;
  assert.equal(look[1].label, 'Deal-breakers');
  assert.ok(look[1].text.startsWith('Personality: cheating'), 'the answer under a title is never read as a fact');
  assert.deepEqual([look[2].type, look[2].value], ['fact', '30 to 42']);
  assert.deepEqual(p.sections[5].items.map((x) => x.type), ['num', 'num', 'p']);
  assert.deepEqual(p.sections[6].items.map((x) => [x.type, x.done]), [['todo', false], ['todo', true]]);
});

t('desktop format reads the same as the phone', () => {
  const p = plain(D.parse(DESKTOP));
  assert.deepEqual(p.sections[0].items.map((x) => [x.label, x.value]), [['Name', 'Test Person (Tess)'], ['Email', 'test@example.com']]);
  assert.deepEqual(p.sections[1].items.map((x) => [x.type, x.label]), [['block', 'What I do professionally'], ['fact', 'Age range']]);
});

t('deal-breakers become chips with the physical note apart', () => {
  const d = plain(D.dealBreakers('Personality: cheating, gaslighting or manipulation, yelling during fights, and lack of ambition. Physical: none beyond my height range.'));
  assert.deepEqual(d.chips, ['cheating', 'gaslighting or manipulation', 'yelling during fights', 'lack of ambition']);
  assert.equal(d.physical, 'none beyond my height range');
  assert.deepEqual(plain(D.dealBreakers('Just be kind.')).chips, []);
});

t('application status, yes/no and icons', () => {
  assert.equal(D.status('submitted 8 Nov').k, 'done');
  assert.equal(D.status('started, page 2 of 8').k, 'wip');
  assert.equal(D.status('active profile').k, 'live');
  assert.equal(D.yesNo('Yes, for the right person'), 'yes');
  assert.equal(D.yesNo('No'), 'no');
  assert.equal(D.yesNo('Either'), 'info');
  assert.equal(D.icon('Height range'), '📏');
  assert.equal(D.icon('Religion'), '🕊️');
  assert.notEqual(D.icon('Ideal first date'), '🚫', '"ideal" is not a deal-breaker');
  assert.equal(D.icon('Deal-breakers'), '🚫');
});

t('long yes/no questions are still read as answers', () => {
  const p = plain(D.parse('<content>\n## Quick answers\n- A perfect match 2 inches outside my height range: Yes\n- Open to dating someone with kids: Yes, for the right person\n</content>'));
  assert.deepEqual(p.sections[0].items.map((x) => [x.type, x.value]), [['fact', 'Yes'], ['fact', 'Yes, for the right person']]);
});

t('drawn page: every section, copy buttons, nothing raw, everything private', () => {
  const h = D.html(PHONE);
  for (const want of ['Where I have applied', 'At a glance', "What I&#39;m looking for", 'About me', 'Form basics', 'Best photos to use', 'Interview prep']) assert.ok(h.includes(want), want);
  assert.ok(h.includes('class="no-chip">cheating<'));
  assert.ok(h.includes('<div class="n">30 to 42</div>'));
  assert.ok(h.includes('1 of 2 still to think through'));
  assert.ok((h.match(/data-copy=/g) || []).length >= 10);
  assert.ok(!/<b>|\*\*|mailto/.test(h));
  const sections = h.match(/<section class="[^"]*"/g);
  assert.ok(sections.every((s) => s.includes('sensitive')), 'every section blurs in private mode');
});

t('text from Notion is escaped', () => {
  const h = D.html('<content>\n## About me\nWho\n<img src=x onerror=alert(1)>\n</content>');
  assert.ok(!h.includes('<img src=x'));
  assert.ok(h.includes('&lt;img'));
});

t('a photo added in Notion shows in the hero and the photo section', () => {
  const h = D.html('<content>\n## Quick fields\nName: A\n## Best photos to use\n![Portrait](https://example.com/a.jpg)\n1. Portrait\n</content>');
  assert.equal((h.match(/src="https:\/\/example.com\/a.jpg"/g) || []).length, 2);
});

console.log('all', n, 'passed');
