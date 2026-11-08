/* Tests for renderProfile in index.html (8 Nov 2026): the Dating profile card in
   the Relationship tab reads a Notion page of "Label: answer" lines, bullets and
   to-dos. Run: node tests/dating-profile.test.mjs
   The answers here are invented. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const HTML = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const grab = (name) => {
  const start = HTML.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' is missing from index.html');
  const end = HTML.indexOf('\nasync function fetchNotion(', start) > -1 && name === 'renderProfile'
    ? HTML.indexOf('\nasync function fetchNotion(', start)
    : HTML.indexOf('\n', start);
  return HTML.slice(start, end);
};
const ctx = {};
vm.createContext(ctx);
vm.runInContext(grab('escapeHtml') + '\n' + grab('renderProfile'), ctx);
const R = ctx.renderProfile;

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', n, name); };

t('phone format: headings, plain lines, bullets and to-dos', () => {
  const h = R('# Title\n## Quick fields\nName: Test Person\n- Want kids: Yes\n- [ ] Think about timeline\n- [x] Done item\n1. First photo');
  assert.ok(!h.includes('Title'), 'the page title is skipped');
  assert.ok(h.includes('<div class="feed-h">Quick fields</div>'));
  assert.ok(h.includes('<div class="feed-p">Name: Test Person</div>'));
  assert.ok(h.includes('<div class="feed-p">• Want kids: Yes</div>'));
  assert.ok(h.includes('<div class="feed-p">☐ Think about timeline</div>'));
  assert.ok(h.includes('<div class="feed-p">☑ Done item</div>'));
  assert.ok(h.includes('<div class="feed-p">1. First photo</div>'));
});

t('desktop format: <b> and ** labels become bold, links become their text', () => {
  const h = R('<b>Height:</b> 5\'1"\n**Age range:** 28 to 45\n<b>Email:</b> [a@b.com](mailto:a@b.com)\n<b>Physical</b>');
  assert.ok(h.includes('<strong>Height:</strong> 5\'1&quot;'));
  assert.ok(h.includes('<strong>Age range:</strong> 28 to 45'));
  assert.ok(h.includes('<strong>Email:</strong> a@b.com'));
  assert.ok(h.includes('<strong>Physical</strong></div>'));
  assert.ok(!h.includes('mailto'));
});

t('text is escaped, nothing from Notion becomes live HTML', () => {
  const h = R('<script>alert(1)</script>\n<b><img src=x onerror=1></b> hi');
  assert.ok(!h.includes('<script>'));
  assert.ok(!h.includes('<img'));
});

t('an empty page says so instead of showing a blank card', () => {
  assert.ok(R('').includes('empty in Notion'));
});

t('renderFeed uses the card own renderer when one is given', () => {
  assert.ok(HTML.includes('(f.render||(f.tiles?renderTiles:renderMini))'));
  assert.ok(HTML.includes("render:renderProfile},'dating-profile')"));
  assert.ok(HTML.includes('id="dating-profile"'));
});

console.log('all', n, 'passed');
