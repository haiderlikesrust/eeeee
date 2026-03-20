import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';

test('GET / returns API info', async () => {
  const res = await request(app).get('/');
  assert.equal(res.status, 200);
  assert.ok(res.body.revolt);
  assert.ok(Object.prototype.hasOwnProperty.call(res.body, 'vapid'));
});

test('GET /health is ok', async () => {
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
});
