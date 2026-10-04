import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMessage, stripTracking } from './markdown';

test('message markdown escapes html and applies the subset', () => {
  const h = renderMessage('<img src=x onerror=alert(1)> **b** *i* `<x>` ||s|| > no');
  assert.ok(!h.includes('<img'));
  assert.match(h, /<strong>b<\/strong>/);
  assert.match(h, /<em>i<\/em>/);
  assert.match(h, /<code>&lt;x&gt;<\/code>/);
  assert.match(h, /class="spoiler"/);
});

test('links can be disabled (lockdown)', () => {
  assert.match(renderMessage('see https://example.com/a'), /<a href="https:\/\/example.com\/a"/);
  const off = renderMessage('see https://example.com/a', { links: false });
  assert.ok(!off.includes('<a '));
  assert.match(off, /link-off/);
  assert.ok(!renderMessage('javascript:alert(1)').includes('<a '));
});

test('code blocks keep their content unformatted', () => {
  const h = renderMessage('```\n**not bold**\n```');
  assert.match(h, /<pre><code>\*\*not bold\*\*<\/code><\/pre>/);
});

test('tracking parameters are stripped, others kept', () => {
  assert.equal(stripTracking('x https://a.com/p?utm_source=tw&id=4&fbclid=zz y'), 'x https://a.com/p?id=4 y');
  assert.equal(stripTracking('https://a.com/p?utm_medium=e'), 'https://a.com/p');
  assert.equal(stripTracking('https://a.com/p?q=1'), 'https://a.com/p?q=1');
});
