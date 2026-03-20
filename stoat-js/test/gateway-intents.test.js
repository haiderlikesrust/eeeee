import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GatewayIntents } from '../src/events.js';

test('GatewayIntents exposes expected bit flags', () => {
  assert.ok(GatewayIntents.GUILD_MESSAGES > 0);
  assert.ok(GatewayIntents.GUILDS > 0);
});
