import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import config from '../config.js';
import app from '../src/app.js';
import { recordServerEvent } from '../src/analytics/service.js';
import { AnalyticsEvent, UserSettings } from '../src/db/models/index.js';
import {
  buildClientBatchDocs,
  isAnalyticsOptOutValue,
  sanitizeProps,
  userHasAnalyticsOptOut,
} from '../src/analytics/service.js';

let connected = false;

before(async () => {
  try {
    await mongoose.connect(config.mongodb);
    connected = true;
  } catch {
    connected = false;
  }
});

after(async () => {
  if (!connected) return;
  await AnalyticsEvent.deleteMany({ event: /^test\.analytics/ });
  await UserSettings.deleteMany({
    user_id: { $in: ['test_analytics_user_01', 'test_analytics_user_02'] },
  });
  await mongoose.disconnect().catch(() => {});
});

test('isAnalyticsOptOutValue', () => {
  assert.equal(isAnalyticsOptOutValue('1'), true);
  assert.equal(isAnalyticsOptOutValue('true'), true);
  assert.equal(isAnalyticsOptOutValue('yes'), true);
  assert.equal(isAnalyticsOptOutValue('0'), false);
  assert.equal(isAnalyticsOptOutValue(null), false);
});

test('sanitizeProps caps size', () => {
  const big = { a: 'x'.repeat(20000) };
  assert.equal(sanitizeProps(big, 100), undefined);
  const ok = sanitizeProps({ channel_type: 'TextChannel', n: 1 }, config.analyticsMaxPropsBytes);
  assert.equal(ok.channel_type, 'TextChannel');
  assert.equal(ok.n, 1);
});

test('buildClientBatchDocs rejects invalid and accepts valid', () => {
  const empty = buildClientBatchDocs({}, null);
  assert.equal(empty.docs.length, 0);

  const badName = buildClientBatchDocs(
    {
      anonymous_id: 'valid_anon_id_12',
      platform: 'web',
      events: [{ event: 'BadName', client_ts: 1 }],
    },
    null,
  );
  assert.equal(badName.docs.length, 0);
  assert.ok(badName.rejected >= 1);

  const good = buildClientBatchDocs(
    {
      anonymous_id: 'valid_anon_id_12',
      platform: 'web',
      events: [{ event: 'test.analytics.ok', props: { x: 1 }, client_ts: 1, client_event_id: 'ce1' }],
    },
    'user_ulid_test_01',
  );
  assert.equal(good.docs.length, 1);
  assert.equal(good.docs[0].event, 'test.analytics.ok');
  assert.equal(good.docs[0].user_id, 'user_ulid_test_01');
});

test('userHasAnalyticsOptOut reads UserSettings', async () => {
  if (!connected) return;
  await UserSettings.deleteMany({ user_id: 'test_analytics_user_01' });
  assert.equal(await userHasAnalyticsOptOut('test_analytics_user_01'), false);
  await UserSettings.create({
    _id: 'uset_analytics_test_01',
    user_id: 'test_analytics_user_01',
    key: 'analytics_opt_out',
    value: '1',
  });
  assert.equal(await userHasAnalyticsOptOut('test_analytics_user_01'), true);
});

test('POST /analytics/batch no-op when analytics disabled', async () => {
  if (!connected) return;
  const prev = config.analyticsEnabled;
  try {
    config.analyticsEnabled = false;
    const anon = 'batch_test_disabled_01';
    await AnalyticsEvent.deleteMany({ anonymous_id: anon });
    const body = {
      anonymous_id: anon,
      platform: 'web',
      events: [{ event: 'test.analytics.disabled', client_event_id: 'd1', client_ts: 1 }],
    };
    const r = await request(app).post('/analytics/batch').set('Content-Type', 'application/json').send(body);
    assert.equal(r.status, 204);
    const n = await AnalyticsEvent.countDocuments({ event: 'test.analytics.disabled', anonymous_id: anon });
    assert.equal(n, 0);
  } finally {
    config.analyticsEnabled = prev;
  }
});

test('recordServerEvent no-op when analytics disabled', async () => {
  if (!connected) return;
  const prev = config.analyticsEnabled;
  try {
    config.analyticsEnabled = false;
    await recordServerEvent({ userId: 'x', event: 'test.analytics.server_off', props: {} });
    const n = await AnalyticsEvent.countDocuments({ event: 'test.analytics.server_off' });
    assert.equal(n, 0);
  } finally {
    config.analyticsEnabled = prev;
  }
});

test('POST /analytics/batch persists and dedupes client_event_id', async () => {
  if (!connected) return;
  const anon = 'batch_test_anon_id_01';
  await AnalyticsEvent.deleteMany({ anonymous_id: anon });

  const body = {
    anonymous_id: anon,
    platform: 'web',
    app_version: 'test',
    events: [
      {
        event: 'test.analytics.batch',
        client_ts: Date.now(),
        client_event_id: 'same_id_dup_test',
        props: { k: 1 },
      },
    ],
  };

  const r1 = await request(app).post('/analytics/batch').set('Content-Type', 'application/json').send(body);
  assert.equal(r1.status, 204);
  const r2 = await request(app).post('/analytics/batch').set('Content-Type', 'application/json').send(body);
  assert.equal(r2.status, 204);

  const n = await AnalyticsEvent.countDocuments({
    event: 'test.analytics.batch',
    anonymous_id: anon,
  });
  assert.equal(n, 1);
});

test('POST /analytics/batch no-op when user opted out', async () => {
  if (!connected) return;
  const anon = 'batch_test_anon_optout_1';
  await AnalyticsEvent.deleteMany({ anonymous_id: anon });
  const testUserId = 'test_analytics_user_02';
  await UserSettings.findOneAndUpdate(
    { user_id: testUserId, key: 'analytics_opt_out' },
    { $set: { user_id: testUserId, key: 'analytics_opt_out', value: '1' } },
    { upsert: true },
  );

  const { Session, User } = await import('../src/db/models/index.js');
  await User.findByIdAndDelete(testUserId).catch(() => {});
  await Session.deleteMany({ user_id: testUserId });
  const uniqUser = `atst_${Date.now()}`;
  await User.create({
    _id: testUserId,
    username: uniqUser,
    discriminator: '0001',
    last_acknowledged_policy_change: new Date(0),
  });
  const token = `test_analytics_tok_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await Session.create({
    _id: 'sess_analytics_test_02',
    user_id: testUserId,
    token,
    name: 'test',
  });

  const body = {
    anonymous_id: anon,
    platform: 'web',
    events: [{ event: 'test.analytics.optout_block', client_event_id: 'o1', client_ts: 1 }],
  };

  const r = await request(app)
    .post('/analytics/batch')
    .set('Content-Type', 'application/json')
    .set('x-session-token', token)
    .send(body);
  assert.equal(r.status, 204);

  const n = await AnalyticsEvent.countDocuments({
    event: 'test.analytics.optout_block',
    anonymous_id: anon,
  });
  assert.equal(n, 0);

  await Session.deleteMany({ user_id: testUserId });
  await User.deleteOne({ _id: testUserId });
  await UserSettings.deleteMany({ user_id: testUserId });
});
