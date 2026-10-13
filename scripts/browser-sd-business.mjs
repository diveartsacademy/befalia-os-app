// Makes the browser copy of api/_sd-business.js for the Sea Diva dashboard
// (divearts-os/sd-business.js), so the Pack and ship page and the Business tab
// sort orders by exactly the same rules.
//
//   node scripts/browser-sd-business.mjs > ../divearts-os/sd-business.js
//
// The only changes: the import line goes (the page loads sd-overview.js
// first), "export " is dropped, and the whole file is wrapped so it sets
// window.SDBusiness. Nothing else is touched.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const src = readFileSync(new URL('../api/_sd-business.js', import.meta.url), 'utf8');
const sha = createHash('sha256').update(src).digest('hex').slice(0, 12);
let body = src.replace(/^import '\.\/_sd-overview\.js';\n/m, '');
if (/^import /m.test(body)) throw new Error('unexpected import left in _sd-business.js');
const names = [...body.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]);
body = body.replace(/^export /gm, '');
process.stdout.write(
`/* sd-business.js — GENERATED, do not edit by hand.
   Browser copy of befalia-os-app/api/_sd-business.js (sha256 ${sha}), made by
   befalia-os-app/scripts/browser-sd-business.mjs. Needs sd-overview.js first.
   Edit the original, run the script, copy the result here. */
(function (root) {
'use strict';
${body}
root.SDBusiness = { ${names.join(', ')} };
})(typeof window !== 'undefined' ? window : globalThis);
`);
