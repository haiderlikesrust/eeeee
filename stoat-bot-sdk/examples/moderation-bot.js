/**
 * Moderation bot — prefix commands for kick, ban, unban, purge (delete recent messages).
 *
 * Grant the bot Kick/Ban/Manage Messages **or** pass the command author's id as invoker so the
 * **server owner** can moderate without a mod role on the bot. The API enforces permissions.
 *
 * Run:
 *   BOT_TOKEN=your_bot_token BOT_API_BASE=http://localhost:14702 node examples/moderation-bot.js
 *
 * Commands (in a server text channel):
 *   !mod              — help
 *   !kick <user>     — user id, <@userId>, @username, or display name (mentions[] often empty from web)
 *   !ban <user> [reason...]
 *   !unban <userId>
 *   !purge [n]       — delete last n messages in channel (default 10, max 50); needs Manage Messages for others' messages
 */

import {
  StoatBotClient,
  GatewayIntents,
} from '../src/index.js';

const token = process.env.BOT_TOKEN;
const baseUrl = process.env.BOT_API_BASE || 'http://localhost:14702';

if (!token) {
  console.error('Set BOT_TOKEN to your bot token (Developer Portal → your bot → token).');
  process.exit(1);
}

function errMsg(err) {
  return err?.response?.error || err?.message || 'Request failed';
}

function messageAuthorId(message) {
  const a = message?.author;
  if (typeof a === 'string') return a;
  if (a && typeof a === 'object' && a._id) return a._id;
  return null;
}

function sameId(a, b) {
  return String(a ?? '') === String(b ?? '');
}

/** Raw user id from first mention, <@id>, or literal token (may be a name, not an id). */
function parseTargetUserId(raw, message) {
  const mentions = message?.mentions;
  if (Array.isArray(mentions) && mentions.length > 0) {
    const m = mentions[0];
    if (typeof m === 'string') return m;
    if (m && typeof m === 'object' && m._id) return m._id;
  }
  if (!raw) return null;
  const t = raw.trim();
  const br = t.match(/^<@!?([A-Za-z0-9]+)>$/);
  if (br) return br[1];
  return t;
}

/**
 * Resolve a member row: web UI often omits `mentions` in the API body, so @DisplayName is plain text.
 * Match by user id, <@id>, then username / display_name / nickname (case-insensitive).
 */
async function resolveTargetMember(bot, serverId, rawArg, message) {
  const members = await bot.getServerMembers(serverId);
  const list = members || [];

  const mentions = message?.mentions;
  if (Array.isArray(mentions) && mentions.length > 0) {
    const m = mentions[0];
    const uid = typeof m === 'string' ? m : m?._id;
    if (uid) {
      const row = list.find((x) => sameId(typeof x.user === 'object' ? x.user._id : x.user, uid));
      if (row) return row;
    }
  }

  if (!rawArg) return null;
  const t = rawArg.trim();
  const angle = t.match(/^<@!?([A-Za-z0-9]+)>$/);
  if (angle) {
    return list.find((m) => sameId(typeof m.user === 'object' ? m.user._id : m.user, angle[1])) || null;
  }

  const token = parseTargetUserId(rawArg, { mentions: [] });
  if (token && /^[A-Za-z0-9]{16,}$/.test(token)) {
    const byId = list.find((m) => sameId(typeof m.user === 'object' ? m.user._id : m.user, token));
    if (byId) return byId;
  }

  const name = t.replace(/^@/, '').trim().toLowerCase();
  if (!name) return null;
  return list.find((m) => {
    const u = m.user;
    const userObj = typeof u === 'object' && u ? u : null;
    const uname = (userObj?.username || '').toLowerCase();
    const dname = (userObj?.display_name || '').toLowerCase();
    const nick = (m.nickname || '').toLowerCase();
    return uname === name || dname === name || nick === name;
  }) || null;
}

const bot = new StoatBotClient({
  token,
  baseUrl,
  intents: GatewayIntents.GUILDS | GatewayIntents.GUILD_MESSAGES | GatewayIntents.MESSAGE_CONTENT,
  prefix: '!',
});

bot.on('open', () => console.log('[moderation-bot] connected'));
bot.on('error', (e) => console.error('[moderation-bot] error', e));

bot.command('mod', async (ctx) => {
  await ctx.reply(
    'Commands: `!kick`, `!ban`, `!unban`, `!purge`. Use a user id or `<@userId>` mention. '
    + 'Requires Kick/Ban/Manage Messages as appropriate.',
  );
});

bot.command('kick', async (ctx) => {
  const ch = await bot.getChannel(ctx.message.channel);
  const serverId = ch?.server;
  if (!serverId) {
    await ctx.reply('Use this in a server channel.');
    return;
  }
  if (!ctx.args[0]) {
    await ctx.reply('Usage: `!kick <user id or mention>`');
    return;
  }
  try {
    const row = await resolveTargetMember(bot, serverId, ctx.args[0], ctx.message);
    if (!row) {
      await ctx.reply('User is not a member of this server (or could not be resolved). Try `<@userId>` or the exact username.');
      return;
    }
    const invoker = messageAuthorId(ctx.message);
    await bot.kickMember(serverId, row._id, invoker ? { invokerUserId: invoker } : {});
    await ctx.reply('User kicked.');
  } catch (e) {
    await ctx.reply(`Kick failed: ${errMsg(e)}`);
  }
});

bot.command('ban', async (ctx) => {
  const ch = await bot.getChannel(ctx.message.channel);
  const serverId = ch?.server;
  if (!serverId) {
    await ctx.reply('Use this in a server channel.');
    return;
  }
  if (!ctx.args[0]) {
    await ctx.reply('Usage: `!ban <user id or mention> [reason...]`');
    return;
  }
  const reason = ctx.args.slice(1).join(' ').trim() || undefined;
  const invoker = messageAuthorId(ctx.message);
  try {
    const row = await resolveTargetMember(bot, serverId, ctx.args[0], ctx.message);
    if (!row) {
      await ctx.reply('User is not a member of this server (or could not be resolved). Try `<@userId>` or the exact username.');
      return;
    }
    const targetUserId = typeof row.user === 'object' && row.user ? row.user._id : row.user;
    await bot.banUser(serverId, targetUserId, {
      ...(reason ? { reason } : {}),
      ...(invoker ? { invokerUserId: invoker } : {}),
    });
    await ctx.reply('User banned.');
  } catch (e) {
    await ctx.reply(`Ban failed: ${errMsg(e)}`);
  }
});

bot.command('unban', async (ctx) => {
  const ch = await bot.getChannel(ctx.message.channel);
  const serverId = ch?.server;
  if (!serverId) {
    await ctx.reply('Use this in a server channel.');
    return;
  }
  const userId = (ctx.args[0] || '').trim();
  if (!userId) {
    await ctx.reply('Usage: `!unban <user id>`');
    return;
  }
  try {
    const invoker = messageAuthorId(ctx.message);
    await bot.unbanUser(serverId, userId, invoker ? { invokerUserId: invoker } : {});
    await ctx.reply('User unbanned.');
  } catch (e) {
    await ctx.reply(`Unban failed: ${errMsg(e)}`);
  }
});

bot.command('purge', async (ctx) => {
  const channelId = ctx.message.channel;
  let n = parseInt(ctx.args[0], 10);
  if (Number.isNaN(n) || n < 1) n = 10;
  n = Math.min(50, n);
  try {
    const msgs = await bot.fetchMessages(channelId, { limit: n });
    const list = Array.isArray(msgs) ? msgs : [];
    let deleted = 0;
    for (const m of list) {
      try {
        await bot.deleteMessage(channelId, m._id);
        deleted += 1;
      } catch (e) {
        // Missing MANAGE_MESSAGES on others' messages, etc.
        console.warn('delete skip', m._id, errMsg(e));
      }
    }
    await ctx.reply(`Deleted ${deleted} message(s) (requested ${n}).`);
  } catch (e) {
    await ctx.reply(`Purge failed: ${errMsg(e)}`);
  }
});

async function main() {
  bot.startCommandRouter();
  await bot.connect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
