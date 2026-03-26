import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicSlug, normalizePublicSlug } from '../src/publicServer.js';

test('normalizePublicSlug lowercases and trims', () => {
  assert.equal(normalizePublicSlug('  AbC  '), 'abc');
  assert.equal(normalizePublicSlug(''), null);
  assert.equal(normalizePublicSlug(null), null);
});

test('validatePublicSlug accepts 3–32 char slugs', () => {
  const a = validatePublicSlug('gta5');
  assert.equal(a.ok, true);
  assert.equal(a.slug, 'gta5');
  const b = validatePublicSlug('ab');
  assert.equal(b.ok, false);
  const long = 'a'.repeat(33);
  assert.equal(validatePublicSlug(long).ok, false);
});

test('validatePublicSlug rejects reserved names', () => {
  const r = validatePublicSlug('admin');
  assert.equal(r.ok, false);
});

test('validatePublicSlug allows hyphen and underscore', () => {
  const r = validatePublicSlug('my_server-1');
  assert.equal(r.ok, true);
  assert.equal(r.slug, 'my_server-1');
});
