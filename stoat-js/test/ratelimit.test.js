import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { ratelimit } from '../src/middleware/ratelimit.js';

test('ratelimit returns 429 after max requests', async () => {
  const app = express();
  app.use(ratelimit({ max: 2, windowMs: 60_000 }));
  app.get('/t', (req, res) => res.json({ ok: true }));

  await request(app).get('/t');
  await request(app).get('/t');
  const res = await request(app).get('/t');
  assert.equal(res.status, 429);
});
