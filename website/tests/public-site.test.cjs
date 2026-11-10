'use strict';
// Release checks for the public website (www.taxiflow.co.za). The approved
// export's own checks are in prototype.test.cjs; these cover the Log in link and
// every call to action's destination or behaviour.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dist = path.join(__dirname, '..', 'dist');
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(dist, 'app.js'), 'utf8');
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const nav = /<nav aria-label="Main navigation">([\s\S]*?)<\/nav>/.exec(html)[1];

test('Log in is in the main navigation (desktop and mobile menu) and opens the operations app', () => {
  const links = [...nav.matchAll(/<a\b([^>]*)>([^<]*)<\/a>/g)];
  const login = links.filter(([, , label]) => label.trim() === 'Log in');
  assert.equal(login.length, 1);
  assert.match(login[0][1], /href="https:\/\/taxiflow\.co\.za"/);
  assert.doesNotMatch(login[0][1], /target=/, 'opens in the same tab, like a normal sign-in link');
  // The mobile menu is this same <nav> (toggled by .menu-toggle), so no second copy is needed.
  assert.match(js, /document\.querySelector\('\.header nav'\)\.classList\.toggle\('is-open'/);
});

test('every link is an in-page fragment that exists, the app sign-in, or a home/top link', () => {
  const hrefs = [...html.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length > 10);
  for (const href of hrefs) {
    if (href === '#') continue; // logo "home" and "Back to top"
    if (href === 'https://taxiflow.co.za') continue; // Log in
    assert.match(href, /^#[\w-]+$/, `unexpected destination ${href}`);
    assert.ok(ids.has(href.slice(1)), `fragment target missing: ${href}`);
  }
});

test('every button has a defined behaviour', () => {
  const buttons = [...html.matchAll(/<button\b([^>]*)>/g)].map((m) => m[1]);
  for (const attrs of buttons) {
    const id = /\sid="([^"]+)"/.exec(attrs)?.[1];
    const known =
      /data-enquiry/.test(attrs) || // opens the walkthrough planner dialog
      /data-step=/.test(attrs) || // walkthrough steps
      /role="tab"/.test(attrs) || // sample board tabs
      /class="menu-toggle"/.test(attrs) ||
      /class="dialog-close"/.test(attrs) ||
      /type="submit"/.test(attrs) ||
      (id && js.includes(`#${id}`));
    assert.ok(known, `button without a handler: ${attrs.trim()}`);
  }
});

test('the walkthrough planner sends nothing and never claims an enquiry was received', () => {
  assert.doesNotMatch(js, /\bfetch\(|XMLHttpRequest|sendBeacon|navigator\.sendBeacon|<form[^>]*action=/);
  assert.doesNotMatch(html, /<form[^>]*\saction=/);
  assert.match(js, /No enquiry was sent\./);
  assert.match(html, /No enquiry is sent and no personal details are collected\./);
  assert.doesNotMatch(js + html, /thank you for your enquiry|we will be in touch|we.ll contact you|enquiry (sent|received|submitted)/i);
});
