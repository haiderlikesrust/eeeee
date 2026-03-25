/**
 * Rigby - powerful moderation bot example
 *
 * Run:
 *   BOT_TOKEN=your_bot_token BOT_API_BASE=http://localhost:14702 BOT_PREFIX=! node examples/rigby-moderation-bot.js
 *
 * Highlights:
 * - Rich help command with command categories and detailed per-command help.
 * - Interaction 2.0: buttons, select menus, modals, context commands, ephemeral/deferred/follow-up replies.
 * - Moderation: kick, ban, unban, bans, purge, warn, warnings, clearwarnings, nickname, role edit.
 * - Info: serverinfo, userinfo, memberinfo.
 * - Configuration: mod roles, whitelist, log channel, warn thresholds.
 * - Live automod: invite blocking, bad-word filter, mention limit, anti-spam.
 *
 * Notes:
 * - Commands are prefix-based (default "!").
 * - Moderation commands require server owner OR configured moderator role.
 * - API permission and hierarchy checks still apply to the bot account.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  GatewayEvents,
  GatewayIntents,
  ModalBuilder,
  SelectMenuBuilder,
  StoatBotClient,
  TextInputBuilder,
  TextInputStyle,
} from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '.bot-data');
const STORE_PATH = join(DATA_DIR, 'rigby-moderation.json');

const BOT_TOKEN = "Eo98okdcen5M1ElsWapJzL9WY39z8Gky37o6Mb25c7D2zoPkgdyktz7TTrKgkMUu";
const BOT_API_BASE = process.env.BOT_API_BASE || 'http://localhost:14702';
const PREFIX = String(process.env.BOT_PREFIX || '!').trim() || '!';

if (!BOT_TOKEN) {
  console.error('Set BOT_TOKEN first.');
  process.exit(1);
}

const bot = new StoatBotClient({
  token: BOT_TOKEN,
  baseUrl: BOT_API_BASE,
  intents: GatewayIntents.GUILDS | GatewayIntents.GUILD_MEMBERS | GatewayIntents.GUILD_MESSAGES | GatewayIntents.MESSAGE_CONTENT,
  prefix: PREFIX,
  ignoreBotMessages: true,
});

function nowIso() {
  return new Date().toISOString();
}

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

function uniqueStrings(arr) {
  return [...new Set(
    safeArray(arr)
      .filter((x) => x != null)
      .map((x) => String(x).trim())
      .filter(Boolean),
  )];
}

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function loadStore() {
  if (!existsSync(STORE_PATH)) {
    return { servers: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(STORE_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : { servers: {} };
  } catch {
    return { servers: {} };
  }
}

function saveStore() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

function defaultServerConfig() {
  return {
    logChannelId: null,
    modRoleIds: [],
    whitelistUserIds: [],
    warningThresholds: {
      kick: 3,
      ban: 5,
    },
    warnings: {},
    caseCounter: 1,
    automod: {
      enabled: true,
      blockInvites: true,
      maxMentions: 8,
      badWords: [],
      antiSpam: {
        enabled: true,
        maxMessages: 6,
        windowSeconds: 8,
        action: 'warn', // warn | kick | ban
      },
    },
  };
}

const store = loadStore();

function getServerConfig(serverId) {
  if (!store.servers || typeof store.servers !== 'object') store.servers = {};
  const current = store.servers[serverId] || {};
  const base = defaultServerConfig();
  const cfg = {
    ...base,
    ...current,
    modRoleIds: uniqueStrings(current.modRoleIds ?? base.modRoleIds),
    whitelistUserIds: uniqueStrings(current.whitelistUserIds ?? base.whitelistUserIds),
    warningThresholds: {
      ...base.warningThresholds,
      ...(current.warningThresholds || {}),
    },
    warnings: (current.warnings && typeof current.warnings === 'object') ? current.warnings : {},
    automod: {
      ...base.automod,
      ...(current.automod || {}),
      badWords: uniqueStrings(current?.automod?.badWords ?? base.automod.badWords).map((w) => w.toLowerCase()),
      antiSpam: {
        ...base.automod.antiSpam,
        ...(current?.automod?.antiSpam || {}),
      },
    },
  };
  cfg.warningThresholds.kick = clampInt(cfg.warningThresholds.kick, 0, 50, base.warningThresholds.kick);
  cfg.warningThresholds.ban = clampInt(cfg.warningThresholds.ban, 0, 50, base.warningThresholds.ban);
  cfg.automod.maxMentions = clampInt(cfg.automod.maxMentions, 0, 100, base.automod.maxMentions);
  cfg.automod.antiSpam.maxMessages = clampInt(cfg.automod.antiSpam.maxMessages, 2, 25, base.automod.antiSpam.maxMessages);
  cfg.automod.antiSpam.windowSeconds = clampInt(cfg.automod.antiSpam.windowSeconds, 2, 30, base.automod.antiSpam.windowSeconds);
  if (!['warn', 'kick', 'ban'].includes(cfg.automod.antiSpam.action)) {
    cfg.automod.antiSpam.action = base.automod.antiSpam.action;
  }
  if (!Number.isFinite(Number(cfg.caseCounter))) cfg.caseCounter = 1;
  store.servers[serverId] = cfg;
  return cfg;
}

function messageAuthorId(message) {
  const a = message?.author;
  if (typeof a === 'string') return a;
  if (a && typeof a === 'object' && a._id) return a._id;
  return null;
}

function isBotAuthor(message) {
  const a = message?.author;
  if (!a || typeof a !== 'object') return false;
  if (a.bot === true) return true;
  if (a.bot && typeof a.bot === 'object' && a.bot.owner) return true;
  return false;
}

function extractIdToken(raw) {
  const token = String(raw || '').trim();
  if (!token) return null;
  const mention = token.match(/^<@!?([A-Za-z0-9]+)>$/);
  if (mention) return mention[1];
  return token;
}

function userIdFromMemberRow(row) {
  const u = row?.user;
  if (typeof u === 'string') return u;
  if (u && typeof u === 'object' && u._id) return u._id;
  return null;
}

function displayNameFromMemberRow(row) {
  const u = row?.user;
  const userObj = (u && typeof u === 'object') ? u : null;
  return row?.nickname || userObj?.display_name || userObj?.username || userIdFromMemberRow(row) || 'Unknown';
}

function parseMentionCount(content) {
  if (!content) return 0;
  const m = String(content).match(/<@!?[A-Za-z0-9]+>|@everyone|@here/g);
  return m ? m.length : 0;
}

function hasInviteLink(content) {
  if (!content) return false;
  return /(discord\.gg\/|discord\.com\/invite\/|discordapp\.com\/invite\/|\/invite\/[a-z0-9_-]{4,})/i.test(String(content));
}

function hasBadWord(content, badWords) {
  const text = String(content || '').toLowerCase();
  for (const w of safeArray(badWords)) {
    const needle = String(w || '').trim().toLowerCase();
    if (!needle) continue;
    if (text.includes(needle)) return needle;
  }
  return null;
}

const channelCache = new Map(); // channelId -> { server, at }
const CHANNEL_CACHE_TTL_MS = 5 * 60 * 1000;

async function getChannelCached(channelId) {
  const key = String(channelId || '');
  const cached = channelCache.get(key);
  if (cached && (Date.now() - cached.at) < CHANNEL_CACHE_TTL_MS) return cached.channel;
  const ch = await bot.getChannel(key);
  channelCache.set(key, { channel: ch, at: Date.now() });
  return ch;
}

async function resolveServerIdForMessage(message) {
  const channelId = message?.channel;
  if (!channelId) return null;
  try {
    const ch = await getChannelCached(channelId);
    return ch?.server || null;
  } catch {
    return null;
  }
}

async function getServerAndConfigFromContext(ctx) {
  const serverId = await resolveServerIdForMessage(ctx.message);
  if (!serverId) {
    await ctx.reply('Use this command in a server channel.');
    return null;
  }
  const cfg = getServerConfig(serverId);
  return { serverId, cfg };
}

async function getMembers(serverId) {
  const members = await bot.getServerMembers(serverId);
  return safeArray(members);
}

async function findMemberByUserId(serverId, userId) {
  const uid = String(userId || '').trim();
  if (!uid) return null;
  const members = await getMembers(serverId);
  return members.find((m) => String(userIdFromMemberRow(m) || '') === uid) || null;
}

async function resolveMember(serverId, rawArg, message) {
  const members = await getMembers(serverId);
  const mentions = safeArray(message?.mentions);
  if (mentions.length > 0) {
    const mentionId = typeof mentions[0] === 'string' ? mentions[0] : mentions[0]?._id;
    if (mentionId) {
      const byMention = members.find((m) => String(userIdFromMemberRow(m) || '') === String(mentionId));
      if (byMention) return byMention;
    }
  }

  const token = extractIdToken(rawArg);
  if (!token) return null;

  const byAnyId = members.find((m) => {
    const memberId = String(m?._id || '');
    const uid = String(userIdFromMemberRow(m) || '');
    return memberId === token || uid === token;
  });
  if (byAnyId) return byAnyId;

  const query = token.replace(/^@/, '').toLowerCase();
  const exact = members.find((m) => {
    const u = (m.user && typeof m.user === 'object') ? m.user : {};
    const username = String(u.username || '').toLowerCase();
    const display = String(u.display_name || '').toLowerCase();
    const nick = String(m.nickname || '').toLowerCase();
    return username === query || display === query || nick === query;
  });
  if (exact) return exact;

  return members.find((m) => {
    const u = (m.user && typeof m.user === 'object') ? m.user : {};
    const username = String(u.username || '').toLowerCase();
    const display = String(u.display_name || '').toLowerCase();
    const nick = String(m.nickname || '').toLowerCase();
    return username.includes(query) || display.includes(query) || nick.includes(query);
  }) || null;
}

async function isModerator(serverId, userId, cfg) {
  if (!userId) return false;
  const uid = String(userId);
  if (safeArray(cfg.whitelistUserIds).includes(uid)) return true;
  let server = null;
  try {
    server = await bot.getServer(serverId);
  } catch {}
  if (server?.owner && String(server.owner) === uid) return true;

  const member = await findMemberByUserId(serverId, uid);
  if (!member) return false;
  const roles = safeArray(member.roles).map((r) => String(r));
  const modRoleSet = new Set(safeArray(cfg.modRoleIds).map((r) => String(r)));
  return roles.some((r) => modRoleSet.has(r));
}

async function requireModerator(ctx, serverId, cfg) {
  const invoker = messageAuthorId(ctx.message);
  const ok = await isModerator(serverId, invoker, cfg);
  if (ok) return invoker;
  await ctx.reply('You are not allowed to use this moderation command.');
  return null;
}

async function sendModLog(serverId, text) {
  const cfg = getServerConfig(serverId);
  if (!cfg.logChannelId) return;
  try {
    await bot.sendMessage(cfg.logChannelId, text);
  } catch {}
}

function ensureWarningsBucket(cfg, userId) {
  if (!cfg.warnings || typeof cfg.warnings !== 'object') cfg.warnings = {};
  if (!Array.isArray(cfg.warnings[userId])) cfg.warnings[userId] = [];
  return cfg.warnings[userId];
}

function addWarning(cfg, userId, actorUserId, reason, source = 'manual') {
  const bucket = ensureWarningsBucket(cfg, userId);
  const caseId = cfg.caseCounter++;
  const entry = {
    id: caseId,
    userId: String(userId),
    actorUserId: actorUserId ? String(actorUserId) : null,
    reason: String(reason || 'No reason').slice(0, 400),
    source,
    at: nowIso(),
  };
  bucket.push(entry);
  if (bucket.length > 100) bucket.splice(0, bucket.length - 100);
  return { entry, count: bucket.length };
}

function listWarnings(cfg, userId) {
  return ensureWarningsBucket(cfg, userId).slice();
}

function clearWarnings(cfg, userId) {
  if (!cfg.warnings || typeof cfg.warnings !== 'object') cfg.warnings = {};
  const count = Array.isArray(cfg.warnings[userId]) ? cfg.warnings[userId].length : 0;
  delete cfg.warnings[userId];
  return count;
}

async function applyWarningEscalation(serverId, userId, warningCount, invokerUserId, reasonText) {
  const cfg = getServerConfig(serverId);
  const kickAt = Number(cfg.warningThresholds.kick || 0);
  const banAt = Number(cfg.warningThresholds.ban || 0);
  const maybeMember = await findMemberByUserId(serverId, userId);
  const invokerOpts = invokerUserId ? { invokerUserId } : {};

  if (banAt > 0 && warningCount === banAt) {
    try {
      await bot.banUser(serverId, userId, {
        reason: `Auto-ban after ${warningCount} warnings: ${reasonText}`.slice(0, 250),
        ...(invokerUserId ? { invokerUserId } : {}),
      });
      await sendModLog(serverId, `[Rigby] Auto-ban triggered for <@${userId}> at ${warningCount} warnings.`);
    } catch {}
    return;
  }

  if (kickAt > 0 && warningCount === kickAt && maybeMember?._id) {
    try {
      await bot.kickMember(serverId, maybeMember._id, invokerOpts);
      await sendModLog(serverId, `[Rigby] Auto-kick triggered for <@${userId}> at ${warningCount} warnings.`);
    } catch {}
  }
}

function errMsg(err) {
  return err?.response?.error || err?.message || 'Request failed';
}

function parseCsvIds(raw) {
  return uniqueStrings(String(raw || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean));
}

function modalValuesMap(interaction) {
  const map = {};
  for (const row of safeArray(interaction?.modal?.values)) {
    const key = String(row?.custom_id || '').trim();
    if (!key) continue;
    map[key] = String(row?.value || '').trim();
  }
  return map;
}

async function interactionServerId(interaction) {
  if (interaction?.guild_id) return String(interaction.guild_id);
  if (!interaction?.channel_id) return null;
  try {
    const ch = await getChannelCached(interaction.channel_id);
    return ch?.server ? String(ch.server) : null;
  } catch {
    return null;
  }
}

const commandDocs = [];

function registerCommand(name, meta, handler) {
  const doc = {
    name,
    aliases: safeArray(meta.aliases),
    category: meta.category || 'General',
    usage: meta.usage || '',
    description: meta.description || '',
  };
  commandDocs.push(doc);
  bot.command(name, handler, {
    aliases: doc.aliases,
    description: doc.description,
    usage: doc.usage,
  });
}

function findCommandDoc(nameOrAlias) {
  const needle = String(nameOrAlias || '').trim().toLowerCase();
  if (!needle) return null;
  return commandDocs.find((d) => {
    if (d.name.toLowerCase() === needle) return true;
    return d.aliases.some((a) => String(a).toLowerCase() === needle);
  }) || null;
}

const HELP_PAGE_SIZE = 6;
const HELP_CUSTOM_ID_PREFIX = 'rigby_help_page_';
const HELP_SELECT_CUSTOM_ID = 'rigby_help_select';
const HELP_SETUP_MODAL_OPEN = 'rigby_help_setup_modal_open';
const HELP_SETUP_MODAL_ID = 'rigby_help_setup_modal';

function getHelpRows() {
  return commandDocs
    .slice()
    .sort((a, b) => {
      const cat = String(a.category || '').localeCompare(String(b.category || ''));
      if (cat !== 0) return cat;
      return String(a.name || '').localeCompare(String(b.name || ''));
    })
    .map((d) => `\`${PREFIX}${d.name}\` - ${d.description}`);
}

function totalHelpPages() {
  return Math.max(1, Math.ceil(getHelpRows().length / HELP_PAGE_SIZE));
}

function buildHelpEmbedPage(page) {
  const rows = getHelpRows();
  const maxPages = totalHelpPages();
  const current = clampInt(page, 1, maxPages, 1);
  const start = (current - 1) * HELP_PAGE_SIZE;
  const pageRows = rows.slice(start, start + HELP_PAGE_SIZE);
  const categories = ['General', 'Info', 'Moderation', 'Automod', 'Config'];
  const embed = new EmbedBuilder()
    .setTitle(`Rigby Moderation Bot - Help (${current}/${maxPages})`)
    .setDescription(`Prefix: \`${PREFIX}\` | Use \`${PREFIX}help <command>\` for details.\n\n${pageRows.join('\n') || 'No commands available.'}`)
    .setColor('#10b981')
    .setFooter(`Page ${current} of ${maxPages}`)
    .setTimestamp();
  embed.addField('Categories', categories.join(', '), false);
  return embed;
}

function buildHelpComponents(page) {
  const maxPages = totalHelpPages();
  const current = clampInt(page, 1, maxPages, 1);
  const rows = [];

  if (maxPages > 1) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${HELP_CUSTOM_ID_PREFIX}${Math.max(1, current - 1)}`)
        .setLabel('Prev')
        .setStyle(ButtonStyle.SECONDARY)
        .setDisabled(current <= 1),
      new ButtonBuilder()
        .setCustomId(`${HELP_CUSTOM_ID_PREFIX}${Math.min(maxPages, current + 1)}`)
        .setLabel('Next')
        .setStyle(ButtonStyle.PRIMARY)
        .setDisabled(current >= maxPages),
    ));

    const pageCap = 25;
    const startPage = maxPages <= pageCap
      ? 1
      : Math.max(1, Math.min(current - Math.floor(pageCap / 2), (maxPages - pageCap + 1)));
    const endPage = Math.min(maxPages, startPage + pageCap - 1);
    const options = [];
    for (let p = startPage; p <= endPage; p += 1) {
      options.push({
        label: `Page ${p}`,
        value: String(p),
        default: p === current,
      });
    }

    rows.push(new ActionRowBuilder().addComponents(
      new SelectMenuBuilder()
        .setCustomId(HELP_SELECT_CUSTOM_ID)
        .setPlaceholder('Jump to help page...')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options),
    ));
  }

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(HELP_SETUP_MODAL_OPEN)
      .setLabel('Quick Setup Wizard')
      .setStyle(ButtonStyle.SUCCESS),
  ));

  return rows.map((r) => r.toJSON());
}

function helpPageFromCustomId(customId) {
  const m = String(customId || '').match(/^rigby_help_page_(\d{1,3})$/);
  if (!m) return null;
  return clampInt(m[1], 1, 999, 1);
}

function helpPageFromSelectValues(values) {
  const value = safeArray(values)[0];
  if (!value) return null;
  return clampInt(value, 1, totalHelpPages(), 1);
}

function buildRigbySetupModal() {
  return new ModalBuilder()
    .setCustomId(HELP_SETUP_MODAL_ID)
    .setTitle('Rigby Quick Setup')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('log_channel_id')
          .setLabel('Log Channel ID (or "off")')
          .setStyle(TextInputStyle.SHORT)
          .setPlaceholder('Example: 01ABC...')
          .setRequired(false),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('mod_role_ids')
          .setLabel('Moderator Role IDs (comma-separated)')
          .setStyle(TextInputStyle.PARAGRAPH)
          .setPlaceholder('Example: 01ROLE1, 01ROLE2')
          .setRequired(false),
      ),
    );
}

function formatDurationSeconds(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

// ----- Commands -----

registerCommand('help', {
  category: 'General',
  usage: `${PREFIX}help [command]`,
  description: 'Show command list or command details.',
}, async (ctx) => {
  const target = (ctx.args[0] || '').trim();
  if (!target) {
    const page = 1;
    await ctx.reply({
      embeds: [buildHelpEmbedPage(page).toJSON()],
      components: buildHelpComponents(page),
    });
    return;
  }
  const doc = findCommandDoc(target);
  if (!doc) {
    await ctx.reply(`Unknown command: \`${target}\``);
    return;
  }
  const detail = new EmbedBuilder()
    .setTitle(`Command: ${PREFIX}${doc.name}`)
    .setColor('#10b981')
    .setDescription(doc.description || 'No description')
    .addField('Category', doc.category, true)
    .addField('Usage', `\`${doc.usage || `${PREFIX}${doc.name}`}\``, false)
    .setTimestamp();
  if (doc.aliases.length > 0) {
    detail.addField('Aliases', doc.aliases.map((a) => `\`${PREFIX}${a}\``).join(', '), false);
  }
  await ctx.reply({ embeds: [detail.toJSON()] });
});

registerCommand('ping', {
  category: 'General',
  usage: `${PREFIX}ping`,
  description: 'Check if Rigby is alive.',
}, async (ctx) => {
  await ctx.reply('Rigby online.');
});

registerCommand('config', {
  category: 'Config',
  usage: `${PREFIX}config`,
  description: 'Show Rigby settings for this server.',
}, async (ctx) => {
  const sctx = await getServerAndConfigFromContext(ctx);
  if (!sctx) return;
  const { serverId, cfg } = sctx;
  const antiSpam = cfg.automod.antiSpam;
  const lines = [
    `Server: \`${serverId}\``,
    `Log channel: ${cfg.logChannelId ? `\`${cfg.logChannelId}\`` : 'not set'}`,
    `Moderator roles: ${cfg.modRoleIds.length ? cfg.modRoleIds.map((r) => `\`${r}\``).join(', ') : 'none'}`,
    `Whitelist users: ${cfg.whitelistUserIds.length ? cfg.whitelistUserIds.map((u) => `\`${u}\``).join(', ') : 'none'}`,
    `Warn thresholds: kick=${cfg.warningThresholds.kick}, ban=${cfg.warningThresholds.ban}`,
    `Automod: ${cfg.automod.enabled ? 'on' : 'off'} (invites=${cfg.automod.blockInvites ? 'on' : 'off'}, maxMentions=${cfg.automod.maxMentions}, badWords=${cfg.automod.badWords.length})`,
    `Anti-spam: ${antiSpam.enabled ? 'on' : 'off'} (${antiSpam.maxMessages} msgs / ${formatDurationSeconds(antiSpam.windowSeconds)}, action=${antiSpam.action})`,
  ];
  await ctx.reply(lines.join('\n'));
});

registerCommand('setlog', {
  category: 'Config',
  usage: `${PREFIX}setlog <channelId|off>`,
  description: 'Set or disable moderation log channel.',
}, async (ctx) => {
  const sctx = await getServerAndConfigFromContext(ctx);
  if (!sctx) return;
  const { serverId, cfg } = sctx;
  const invoker = await requireModerator(ctx, serverId, cfg);
  if (!invoker) return;

  const arg = String(ctx.args[0] || '').trim();
  if (!arg) {
    await ctx.reply(`Current log channel: ${cfg.logChannelId ? `\`${cfg.logChannelId}\`` : 'not set'}`);
    return;
  }
  if (arg.toLowerCase() === 'off' || arg.toLowerCase() === 'none') {
    cfg.logChannelId = null;
    saveStore();
    await ctx.reply('Log channel disabled.');
    return;
  }
  cfg.logChannelId = extractIdToken(arg);
  saveStore();
  await ctx.reply(`Log channel set to \`${cfg.logChannelId}\`.`);
  await sendModLog(serverId, `[Rigby] Logging configured by <@${invoker}>.`);
});

registerCommand('modrole', {
  category: 'Config',
  usage: `${PREFIX}modrole <add|remove|list> [roleId]`,
  description: 'Manage role IDs allowed to run moderation commands.',
}, async (ctx) => {
  const sctx = await getServerAndConfigFromContext(ctx);
  if (!sctx) return;
  const { serverId, cfg } = sctx;
  const invoker = await requireModerator(ctx, serverId, cfg);
  if (!invoker) return;

  const sub = String(ctx.args[0] || '').toLowerCase();
  const roleId = extractIdToken(ctx.args[1] || '');
  if (!sub || sub === 'list') {
    await ctx.reply(cfg.modRoleIds.length
      ? `Moderator roles: ${cfg.modRoleIds.map((r) => `\`${r}\``).join(', ')}`
      : 'No moderator roles configured.');
    return;
  }
  if (!roleId) {
    await ctx.reply(`Usage: \`${PREFIX}modrole <add|remove|list> [roleId]\``);
    return;
  }
  if (sub === 'add') cfg.modRoleIds = uniqueStrings([...cfg.modRoleIds, roleId]);
  else if (sub === 'remove') cfg.modRoleIds = cfg.modRoleIds.filter((r) => String(r) !== roleId);
  else {
    await ctx.reply('Subcommand must be add, remove, or list.');
    return;
  }
  saveStore();
  await ctx.reply(`Moderator roles updated. Count: ${cfg.modRoleIds.length}`);
  await sendModLog(serverId, `[Rigby] Moderator roles updated by <@${invoker}>.`);
});

registerCommand('whitelist', {
  category: 'Config',
  usage: `${PREFIX}whitelist <add|remove|list> [userId]`,
  description: 'Whitelist users from automod and grant moderator command access.',
}, async (ctx) => {
  const sctx = await getServerAndConfigFromContext(ctx);
  if (!sctx) return;
  const { serverId, cfg } = sctx;
  const invoker = await requireModerator(ctx, serverId, cfg);
  if (!invoker) return;

  const sub = String(ctx.args[0] || '').toLowerCase();
  const userId = extractIdToken(ctx.args[1] || '');
  if (!sub || sub === 'list') {
    await ctx.reply(cfg.whitelistUserIds.length
      ? `Whitelist: ${cfg.whitelistUserIds.map((u) => `\`${u}\``).join(', ')}`
      : 'Whitelist is empty.');
    return;
  }
  if (!userId) {
    await ctx.reply(`Usage: \`${PREFIX}whitelist <add|remove|list> [userId]\``);
    return;
  }
  if (sub === 'add') cfg.whitelistUserIds = uniqueStrings([...cfg.whitelistUserIds, userId]);
  else if (sub === 'remove') cfg.whitelistUserIds = cfg.whitelistUserIds.filter((u) => String(u) !== userId);
  else {
    await ctx.reply('Subcommand must be add, remove, or list.');
    return;
  }
  saveStore();
  await ctx.reply(`Whitelist updated. Count: ${cfg.whitelistUserIds.length}`);
  await sendModLog(serverId, `[Rigby] Whitelist updated by <@${invoker}>.`);
});

registerCommand('threshold', {
  category: 'Config',
  usage: `${PREFIX}threshold <kick|ban> <count>`,
  description: 'Set warning escalation thresholds.',
}, async (ctx) => {
  const sctx = await getServerAndConfigFromContext(ctx);
  if (!sctx) return;
  const { serverId, cfg } = sctx;
  const invoker = await requireModerator(ctx, serverId, cfg);
  if (!invoker) return;

  const kind = String(ctx.args[0] || '').toLowerCase();
  const count = clampInt(ctx.args[1], 0, 50, NaN);
  if (!['kick', 'ban'].includes(kind) || !Number.isFinite(count)) {
    await ctx.reply(`Usage: \`${PREFIX}threshold <kick|ban> <count>\``);
    return;
  }
  cfg.warningThresholds[kind] = count;
  saveStore();
  await ctx.reply(`Warning threshold updated: ${kind}=${count}`);
  await sendModLog(serverId, `[Rigby] Warning threshold updated by <@${invoker}>: ${kind}=${count}`);
});

registerCommand('serverinfo', {
  category: 'Info',
  usage: `${PREFIX}serverinfo`,
  description: 'Show server, channel, role, and member counts.',
}, async (ctx) => {
  const sctx = await getServerAndConfigFromContext(ctx);
  if (!sctx) return;
  const { serverId } = sctx;
  try {
    const [server, members, roles] = await Promise.all([
      bot.getServer(serverId),
      bot.getServerMembers(serverId),
      bot.getServerRoles(serverId),
    ]);
    const channels = safeArray(server?.channels).filter((c) => typeof c === 'object');
    const textCount = channels.filter((c) => c.channel_type !== 'VoiceChannel').length;
    const voiceCount = channels.filter((c) => c.channel_type === 'VoiceChannel').length;
    await ctx.reply(
      `Server: **${server?.name || serverId}**\n`
      + `ID: \`${serverId}\`\n`
      + `Owner: \`${server?.owner || 'unknown'}\`\n`
      + `Members: ${safeArray(members).length}\n`
      + `Roles: ${safeArray(roles).length}\n`
      + `Channels: ${channels.length} (text: ${textCount}, voice: ${voiceCount})`,
    );
  } catch (e) {
    await ctx.reply(`serverinfo failed: ${errMsg(e)}`);
  }
});

registerCommand('userinfo', {
  category: 'Info',
  usage: `${PREFIX}userinfo <userId|mention|name>`,
  description: 'Show public user profile data.',
}, async (ctx) => {
  const sctx = await getServerAndConfigFromContext(ctx);
  if (!sctx) return;
  const { serverId } = sctx;
  const query = ctx.args[0];
  if (!query) {
    await ctx.reply(`Usage: \`${PREFIX}userinfo <userId|mention|name>\``);
    return;
  }
  try {
    const member = await resolveMember(serverId, query, ctx.message);
    const userId = member ? userIdFromMemberRow(member) : extractIdToken(query);
    if (!userId) {
      await ctx.reply('Could not resolve user.');
      return;
    }
    const user = await bot.getUser(userId);
    await ctx.reply(
      `User: ${user?.display_name || user?.username || userId}\n`
      + `ID: \`${userId}\`\n`
      + `Username: ${user?.username || 'unknown'}\n`
      + `Discriminator: ${user?.discriminator || 'n/a'}\n`
      + `Bot: ${user?.bot ? 'yes' : 'no'}`,
    );
  } catch (e) {
    await ctx.reply(`userinfo failed: ${errMsg(e)}`);
  }
});

registerCommand('memberinfo', {
  category: 'Info',
  usage: `${PREFIX}memberinfo <memberId|userId|mention|name>`,
  description: 'Show member metadata (nickname, roles, join time).',
}, async (ctx) => {
  const sctx = await getServerAndConfigFromContext(ctx);
  if (!sctx) return;
  const { serverId } = sctx;
  if (!ctx.args[0]) {
    await ctx.reply(`Usage: \`${PREFIX}memberinfo <memberId|userId|mention|name>\``);
    return;
  }
  try {
    const row = await resolveMember(serverId, ctx.args[0], ctx.message);
    if (!row) {
      await ctx.reply('Member not found.');
      return;
    }
    const roles = safeArray(row.roles);
    await ctx.reply(
      `Member: ${displayNameFromMemberRow(row)}\n`
      + `Member ID: \`${row._id}\`\n`
      + `User ID: \`${userIdFromMemberRow(row) || 'unknown'}\`\n`
      + `Nickname: ${row.nickname || 'none'}\n`
      + `Roles: ${roles.length ? roles.map((r) => `\`${r}\``).join(', ') : 'none'}\n`
      + `Joined: ${row.joined_at || 'unknown'}`,
    );
  } catch (e) {
    await ctx.reply(`memberinfo failed: ${errMsg(e)}`);
  }
});

registerCommand('warn', {
  category: 'Moderation',
  usage: `${PREFIX}warn <member> [reason]`,
  description: 'Warn a member and apply threshold escalations.',
}, async (ctx) => {
  const sctx = await getServerAndConfigFromContext(ctx);
  if (!sctx) return;
  const { serverId, cfg } = sctx;
  const invoker = await requireModerator(ctx, serverId, cfg);
  if (!invoker) return;
  const query = ctx.args[0];
  if (!query) {
    await ctx.reply(`Usage: \`${PREFIX}warn <member> [reason]\``);
    return;
  }
  try {
    const row = await resolveMember(serverId, query, ctx.message);
    if (!row) {
      await ctx.reply('Member not found.');
      return;
    }
    const userId = userIdFromMemberRow(row);
    const reason = ctx.args.slice(1).join(' ').trim() || 'No reason provided';
    const { entry, count } = addWarning(cfg, userId, invoker, reason, 'manual');
    saveStore();
    await ctx.reply(`Warned ${displayNameFromMemberRow(row)}. Total warnings: ${count}. Case #${entry.id}.`);
    await sendModLog(serverId, `[Rigby] Warning #${entry.id} for <@${userId}> by <@${invoker}>: ${entry.reason}`);
    await applyWarningEscalation(serverId, userId, count, invoker, reason);
  } catch (e) {
    await ctx.reply(`warn failed: ${errMsg(e)}`);
  }
});

registerCommand('warnings', {
  aliases: ['warns'],
  category: 'Moderation',
  usage: `${PREFIX}warnings <member>`,
  description: 'Show warning history for a member.',
}, async (ctx) => {
  const sctx = await getServerAndConfigFromContext(ctx);
  if (!sctx) return;
  const { serverId, cfg } = sctx;
  const invoker = await requireModerator(ctx, serverId, cfg);
  if (!invoker) return;
  if (!ctx.args[0]) {
    await ctx.reply(`Usage: \`${PREFIX}warnings <member>\``);
    return;
  }
  try {
    const row = await resolveMember(serverId, ctx.args[0], ctx.message);
    if (!row) {
      await ctx.reply('Member not found.');
      return;
    }
    const userId = userIdFromMemberRow(row);
    const warnings = listWarnings(cfg, userId);
    if (!warnings.length) {
      await ctx.reply(`${displayNameFromMemberRow(row)} has no warnings.`);
      return;
    }
    const latest = warnings.slice(-10).map((w) => `#${w.id} ${w.source} - ${w.reason} (${w.at})`);
    await ctx.reply(
      `${displayNameFromMemberRow(row)} has ${warnings.length} warning(s):\n${latest.join('\n').slice(0, 1600)}`,
    );
  } catch (e) {
    await ctx.reply(`warnings failed: ${errMsg(e)}`);
  }
});

registerCommand('clearwarnings', {
  aliases: ['clearwarns'],
  category: 'Moderation',
  usage: `${PREFIX}clearwarnings <member>`,
  description: 'Clear warning history for a member.',
}, async (ctx) => {
  const sctx = await getServerAndConfigFromContext(ctx);
  if (!sctx) return;
  const { serverId, cfg } = sctx;
  const invoker = await requireModerator(ctx, serverId, cfg);
  if (!invoker) return;
  if (!ctx.args[0]) {
    await ctx.reply(`Usage: \`${PREFIX}clearwarnings <member>\``);
    return;
  }
  try {
    const row = await resolveMember(serverId, ctx.args[0], ctx.message);
    if (!row) {
      await ctx.reply('Member not found.');
      return;
    }
    const userId = userIdFromMemberRow(row);
    const removed = clearWarnings(cfg, userId);
    saveStore();
    await ctx.reply(`Cleared ${removed} warning(s) for ${displayNameFromMemberRow(row)}.`);
    await sendModLog(serverId, `[Rigby] Warnings cleared for <@${userId}> by <@${invoker}>.`);
  } catch (e) {
    await ctx.reply(`clearwarnings failed: ${errMsg(e)}`);
  }
});

registerCommand('kick', {
  category: 'Moderation',
  usage: `${PREFIX}kick <member> [reason]`,
  description: 'Kick a member from the server.',
}, async (ctx) => {
  const sctx = await getServerAndConfigFromContext(ctx);
  if (!sctx) return;
  const { serverId, cfg } = sctx;
  const invoker = await requireModerator(ctx, serverId, cfg);
  if (!invoker) return;
  if (!ctx.args[0]) {
    await ctx.reply(`Usage: \`${PREFIX}kick <member> [reason]\``);
    return;
  }
  try {
    const row = await resolveMember(serverId, ctx.args[0], ctx.message);
    if (!row) {
      await ctx.reply('Member not found.');
      return;
    }
    const reason = ctx.args.slice(1).join(' ').trim() || 'No reason';
    await bot.kickMember(serverId, row._id, { invokerUserId: invoker });
    await ctx.reply(`Kicked ${displayNameFromMemberRow(row)}.`);
    await sendModLog(serverId, `[Rigby] Kick by <@${invoker}> -> <@${userIdFromMemberRow(row)}> (${reason})`);
  } catch (e) {
    await ctx.reply(`kick failed: ${errMsg(e)}`);
  }
});

registerCommand('ban', {
  category: 'Moderation',
  usage: `${PREFIX}ban <member|userId> [reason]`,
  description: 'Ban a user from the server.',
}, async (ctx) => {
  const sctx = await getServerAndConfigFromContext(ctx);
  if (!sctx) return;
  const { serverId, cfg } = sctx;
  const invoker = await requireModerator(ctx, serverId, cfg);
  if (!invoker) return;
  if (!ctx.args[0]) {
    await ctx.reply(`Usage: \`${PREFIX}ban <member|userId> [reason]\``);
    return;
  }
  try {
    const row = await resolveMember(serverId, ctx.args[0], ctx.message);
    const targetUserId = row ? userIdFromMemberRow(row) : extractIdToken(ctx.args[0]);
    if (!targetUserId) {
      await ctx.reply('Could not resolve target user id.');
      return;
    }
    const reason = ctx.args.slice(1).join(' ').trim() || 'No reason';
    await bot.banUser(serverId, targetUserId, { reason, invokerUserId: invoker });
    await ctx.reply(`Banned <@${targetUserId}>.`);
    await sendModLog(serverId, `[Rigby] Ban by <@${invoker}> -> <@${targetUserId}> (${reason})`);
  } catch (e) {
    await ctx.reply(`ban failed: ${errMsg(e)}`);
  }
});

registerCommand('unban', {
  category: 'Moderation',
  usage: `${PREFIX}unban <userId>`,
  description: 'Unban a user.',
}, async (ctx) => {
  const sctx = await getServerAndConfigFromContext(ctx);
  if (!sctx) return;
  const { serverId, cfg } = sctx;
  const invoker = await requireModerator(ctx, serverId, cfg);
  if (!invoker) return;
  const userId = extractIdToken(ctx.args[0] || '');
  if (!userId) {
    await ctx.reply(`Usage: \`${PREFIX}unban <userId>\``);
    return;
  }
  try {
    await bot.unbanUser(serverId, userId, { invokerUserId: invoker });
    await ctx.reply(`Unbanned <@${userId}>.`);
    await sendModLog(serverId, `[Rigby] Unban by <@${invoker}> -> <@${userId}>`);
  } catch (e) {
    await ctx.reply(`unban failed: ${errMsg(e)}`);
  }
});

registerCommand('bans', {
  category: 'Moderation',
  usage: `${PREFIX}bans`,
  description: 'List current bans.',
}, async (ctx) => {
  const sctx = await getServerAndConfigFromContext(ctx);
  if (!sctx) return;
  const { serverId, cfg } = sctx;
  const invoker = await requireModerator(ctx, serverId, cfg);
  if (!invoker) return;
  try {
    const data = await bot.listServerBans(serverId, { invokerUserId: invoker });
    const bans = safeArray(data?.bans);
    if (!bans.length) {
      await ctx.reply('No bans.');
      return;
    }
    const rows = bans.slice(0, 20).map((b) => {
      const uid = (typeof b.user === 'object' && b.user)?._id || b.user;
      const uname = (typeof b.user === 'object' && b.user)?.username || uid;
      return `- ${uname} (\`${uid}\`)${b.reason ? `: ${b.reason}` : ''}`;
    });
    await ctx.reply(`Bans (${bans.length}):\n${rows.join('\n')}`);
  } catch (e) {
    await ctx.reply(`bans failed: ${errMsg(e)}`);
  }
});

registerCommand('nickname', {
  aliases: ['nick'],
  category: 'Moderation',
  usage: `${PREFIX}nickname <member> <new nickname|clear>`,
  description: 'Change or clear member nickname.',
}, async (ctx) => {
  const sctx = await getServerAndConfigFromContext(ctx);
  if (!sctx) return;
  const { serverId, cfg } = sctx;
  const invoker = await requireModerator(ctx, serverId, cfg);
  if (!invoker) return;
  if (!ctx.args[0] || ctx.args.length < 2) {
    await ctx.reply(`Usage: \`${PREFIX}nickname <member> <new nickname|clear>\``);
    return;
  }
  try {
    const row = await resolveMember(serverId, ctx.args[0], ctx.message);
    if (!row) {
      await ctx.reply('Member not found.');
      return;
    }
    const value = ctx.args.slice(1).join(' ').trim();
    const nickname = (value.toLowerCase() === 'clear' || value.toLowerCase() === 'none') ? null : value.slice(0, 32);
    await bot.editServerMember(serverId, row._id, { nickname }, { invokerUserId: invoker });
    await ctx.reply(`Nickname updated for ${displayNameFromMemberRow(row)}.`);
    await sendModLog(serverId, `[Rigby] Nickname updated by <@${invoker}> for <@${userIdFromMemberRow(row)}>`);
  } catch (e) {
    await ctx.reply(`nickname failed: ${errMsg(e)}`);
  }
});

registerCommand('role', {
  category: 'Moderation',
  usage: `${PREFIX}role <add|remove|set> <member> <roleId ...>`,
  description: 'Add, remove, or set member role IDs.',
}, async (ctx) => {
  const sctx = await getServerAndConfigFromContext(ctx);
  if (!sctx) return;
  const { serverId, cfg } = sctx;
  const invoker = await requireModerator(ctx, serverId, cfg);
  if (!invoker) return;

  const mode = String(ctx.args[0] || '').toLowerCase();
  if (!['add', 'remove', 'set'].includes(mode) || !ctx.args[1]) {
    await ctx.reply(`Usage: \`${PREFIX}role <add|remove|set> <member> <roleId ...>\``);
    return;
  }
  const roleIds = uniqueStrings(ctx.args.slice(2).map((r) => extractIdToken(r || '')));
  if (mode !== 'set' && roleIds.length === 0) {
    await ctx.reply('Provide at least one role id.');
    return;
  }
  try {
    const row = await resolveMember(serverId, ctx.args[1], ctx.message);
    if (!row) {
      await ctx.reply('Member not found.');
      return;
    }
    const current = uniqueStrings(safeArray(row.roles));
    let next = current;
    if (mode === 'add') next = uniqueStrings([...current, ...roleIds]);
    if (mode === 'remove') next = current.filter((r) => !roleIds.includes(r));
    if (mode === 'set') next = roleIds;
    await bot.editServerMember(serverId, row._id, { roles: next }, { invokerUserId: invoker });
    await ctx.reply(`Roles updated for ${displayNameFromMemberRow(row)}. Total roles: ${next.length}`);
    await sendModLog(serverId, `[Rigby] Role ${mode} by <@${invoker}> for <@${userIdFromMemberRow(row)}> -> ${next.join(', ') || 'none'}`);
  } catch (e) {
    await ctx.reply(`role failed: ${errMsg(e)}`);
  }
});

registerCommand('purge', {
  category: 'Moderation',
  usage: `${PREFIX}purge [count]`,
  description: 'Delete recent messages in the current channel (max 100).',
}, async (ctx) => {
  const sctx = await getServerAndConfigFromContext(ctx);
  if (!sctx) return;
  const { serverId, cfg } = sctx;
  const invoker = await requireModerator(ctx, serverId, cfg);
  if (!invoker) return;

  const channelId = ctx.message?.channel;
  const requested = clampInt(ctx.args[0], 1, 100, 20);
  try {
    const msgs = await bot.fetchMessages(channelId, { limit: requested + 2 });
    const list = safeArray(msgs);
    let deleted = 0;
    for (const m of list) {
      try {
        await bot.deleteMessage(channelId, m._id);
        deleted += 1;
      } catch {}
    }
    await ctx.reply(`Purge complete. Deleted ${deleted} message(s).`);
    await sendModLog(serverId, `[Rigby] Purge by <@${invoker}> in \`${channelId}\`: deleted ${deleted}`);
  } catch (e) {
    await ctx.reply(`purge failed: ${errMsg(e)}`);
  }
});

registerCommand('automod', {
  category: 'Automod',
  usage: `${PREFIX}automod <status|on|off|invites|maxmentions|badword|antispam> ...`,
  description: 'Configure Rigby automod controls.',
}, async (ctx) => {
  const sctx = await getServerAndConfigFromContext(ctx);
  if (!sctx) return;
  const { serverId, cfg } = sctx;
  const invoker = await requireModerator(ctx, serverId, cfg);
  if (!invoker) return;

  const sub = String(ctx.args[0] || 'status').toLowerCase();

  if (sub === 'status') {
    const a = cfg.automod;
    await ctx.reply(
      `Automod: ${a.enabled ? 'on' : 'off'}\n`
      + `- invite blocking: ${a.blockInvites ? 'on' : 'off'}\n`
      + `- max mentions: ${a.maxMentions}\n`
      + `- bad words: ${a.badWords.length}\n`
      + `- anti-spam: ${a.antiSpam.enabled ? 'on' : 'off'} (${a.antiSpam.maxMessages} msgs/${a.antiSpam.windowSeconds}s, action=${a.antiSpam.action})`,
    );
    return;
  }

  if (sub === 'on' || sub === 'off') {
    cfg.automod.enabled = sub === 'on';
    saveStore();
    await ctx.reply(`Automod ${cfg.automod.enabled ? 'enabled' : 'disabled'}.`);
    await sendModLog(serverId, `[Rigby] Automod ${cfg.automod.enabled ? 'enabled' : 'disabled'} by <@${invoker}>`);
    return;
  }

  if (sub === 'invites') {
    const value = String(ctx.args[1] || '').toLowerCase();
    if (!['on', 'off'].includes(value)) {
      await ctx.reply(`Usage: \`${PREFIX}automod invites <on|off>\``);
      return;
    }
    cfg.automod.blockInvites = value === 'on';
    saveStore();
    await ctx.reply(`Invite blocking ${cfg.automod.blockInvites ? 'enabled' : 'disabled'}.`);
    return;
  }

  if (sub === 'maxmentions') {
    const n = clampInt(ctx.args[1], 0, 100, NaN);
    if (!Number.isFinite(n)) {
      await ctx.reply(`Usage: \`${PREFIX}automod maxmentions <0-100>\``);
      return;
    }
    cfg.automod.maxMentions = n;
    saveStore();
    await ctx.reply(`Max mentions set to ${n}.`);
    return;
  }

  if (sub === 'badword') {
    const action = String(ctx.args[1] || 'list').toLowerCase();
    const word = String(ctx.args.slice(2).join(' ') || '').trim().toLowerCase();
    if (action === 'list') {
      await ctx.reply(cfg.automod.badWords.length
        ? `Bad words (${cfg.automod.badWords.length}): ${cfg.automod.badWords.map((w) => `\`${w}\``).join(', ')}`
        : 'Bad word list is empty.');
      return;
    }
    if (action === 'clear') {
      cfg.automod.badWords = [];
      saveStore();
      await ctx.reply('Bad word list cleared.');
      return;
    }
    if (!word) {
      await ctx.reply(`Usage: \`${PREFIX}automod badword <add|remove|list|clear> [word]\``);
      return;
    }
    if (action === 'add') cfg.automod.badWords = uniqueStrings([...cfg.automod.badWords, word]).map((w) => w.toLowerCase());
    else if (action === 'remove') cfg.automod.badWords = cfg.automod.badWords.filter((w) => w !== word);
    else {
      await ctx.reply(`Usage: \`${PREFIX}automod badword <add|remove|list|clear> [word]\``);
      return;
    }
    saveStore();
    await ctx.reply(`Bad word list updated. Count: ${cfg.automod.badWords.length}`);
    return;
  }

  if (sub === 'antispam') {
    const action = String(ctx.args[1] || 'status').toLowerCase();
    if (action === 'status') {
      const a = cfg.automod.antiSpam;
      await ctx.reply(`Anti-spam: ${a.enabled ? 'on' : 'off'} (${a.maxMessages} msgs/${a.windowSeconds}s, action=${a.action})`);
      return;
    }
    if (action === 'on' || action === 'off') {
      cfg.automod.antiSpam.enabled = action === 'on';
      saveStore();
      await ctx.reply(`Anti-spam ${cfg.automod.antiSpam.enabled ? 'enabled' : 'disabled'}.`);
      return;
    }
    if (action === 'limit') {
      const maxMessages = clampInt(ctx.args[2], 2, 25, NaN);
      const windowSeconds = clampInt(ctx.args[3], 2, 30, NaN);
      if (!Number.isFinite(maxMessages) || !Number.isFinite(windowSeconds)) {
        await ctx.reply(`Usage: \`${PREFIX}automod antispam limit <maxMessages 2-25> <windowSeconds 2-30>\``);
        return;
      }
      cfg.automod.antiSpam.maxMessages = maxMessages;
      cfg.automod.antiSpam.windowSeconds = windowSeconds;
      saveStore();
      await ctx.reply(`Anti-spam limit set to ${maxMessages} messages per ${windowSeconds}s.`);
      return;
    }
    if (action === 'action') {
      const mode = String(ctx.args[2] || '').toLowerCase();
      if (!['warn', 'kick', 'ban'].includes(mode)) {
        await ctx.reply(`Usage: \`${PREFIX}automod antispam action <warn|kick|ban>\``);
        return;
      }
      cfg.automod.antiSpam.action = mode;
      saveStore();
      await ctx.reply(`Anti-spam action set to ${mode}.`);
      return;
    }
    await ctx.reply(`Usage: \`${PREFIX}automod antispam <status|on|off|limit|action> ...\``);
    return;
  }

  await ctx.reply(`Unknown automod subcommand. Try \`${PREFIX}automod status\`.`);
});

// ----- Live automod -----

const spamTracker = new Map(); // key: serverId:userId -> [timestamps]
const lastSpamActionAt = new Map(); // key: serverId:userId -> ts
const SPAM_ACTION_COOLDOWN_MS = 15000;

async function handleAutomodMessage(message) {
  if (!message || !message.channel) return;
  if (isBotAuthor(message)) return;

  const userId = messageAuthorId(message);
  if (!userId) return;

  const serverId = await resolveServerIdForMessage(message);
  if (!serverId) return;

  const cfg = getServerConfig(serverId);
  if (cfg.whitelistUserIds.includes(String(userId))) return;

  const content = String(message.content || '');
  if (!content) return;
  if (content.trim().startsWith(PREFIX)) return;

  if (cfg.automod.enabled) {
    const reasons = [];
    if (cfg.automod.blockInvites && hasInviteLink(content)) reasons.push('invite-link');
    const mentionCount = parseMentionCount(content);
    if (cfg.automod.maxMentions > 0 && mentionCount > cfg.automod.maxMentions) {
      reasons.push(`too-many-mentions (${mentionCount})`);
    }
    const blockedWord = hasBadWord(content, cfg.automod.badWords);
    if (blockedWord) reasons.push(`blocked-word (${blockedWord})`);

    if (reasons.length > 0) {
      try {
        await bot.deleteMessage(message.channel, message._id);
      } catch {}
      const { count, entry } = addWarning(cfg, userId, null, `Automod: ${reasons.join(', ')}`, 'automod');
      saveStore();
      await sendModLog(serverId, `[Rigby] Automod removed message from <@${userId}>. Reasons: ${reasons.join(', ')}. Warning #${entry.id}.`);
      await applyWarningEscalation(serverId, userId, count, null, `Automod: ${reasons.join(', ')}`);
    }
  }

  const antiSpam = cfg.automod.antiSpam;
  if (!antiSpam.enabled) return;

  const spamKey = `${serverId}:${userId}`;
  const now = Date.now();
  const windowMs = antiSpam.windowSeconds * 1000;
  const arr = safeArray(spamTracker.get(spamKey)).filter((t) => now - t <= windowMs);
  arr.push(now);
  spamTracker.set(spamKey, arr);

  if (arr.length <= antiSpam.maxMessages) return;

  const recentActionAt = lastSpamActionAt.get(spamKey) || 0;
  if (now - recentActionAt < SPAM_ACTION_COOLDOWN_MS) return;
  lastSpamActionAt.set(spamKey, now);

  const reason = `Anti-spam triggered (${arr.length} msgs/${antiSpam.windowSeconds}s)`;
  const action = antiSpam.action;
  try {
    await bot.deleteMessage(message.channel, message._id);
  } catch {}

  if (action === 'warn') {
    const { count, entry } = addWarning(cfg, userId, null, reason, 'antispam');
    saveStore();
    await sendModLog(serverId, `[Rigby] ${reason} for <@${userId}>. Warning #${entry.id}.`);
    await applyWarningEscalation(serverId, userId, count, null, reason);
    return;
  }

  if (action === 'kick') {
    const row = await findMemberByUserId(serverId, userId);
    if (row?._id) {
      try {
        await bot.kickMember(serverId, row._id);
        await sendModLog(serverId, `[Rigby] Anti-spam kick: <@${userId}> (${reason})`);
      } catch {
        const { count } = addWarning(cfg, userId, null, `Kick failed, fallback warning: ${reason}`, 'antispam');
        saveStore();
        await applyWarningEscalation(serverId, userId, count, null, reason);
      }
    }
    return;
  }

  if (action === 'ban') {
    try {
      await bot.banUser(serverId, userId, { reason });
      await sendModLog(serverId, `[Rigby] Anti-spam ban: <@${userId}> (${reason})`);
    } catch {
      const { count } = addWarning(cfg, userId, null, `Ban failed, fallback warning: ${reason}`, 'antispam');
      saveStore();
      await applyWarningEscalation(serverId, userId, count, null, reason);
    }
  }
}

bot.on('open', () => {
  console.log('[Rigby] connected');
});

bot.on('error', (err) => {
  console.error('[Rigby] error', err);
});

bot.on(GatewayEvents.READY, (data) => {
  const me = safeArray(data?.users)[0];
  console.log('[Rigby] ready as', me?.username || 'bot');
});

async function applyHelpPageInteraction(interaction, page) {
  const bounded = clampInt(page, 1, totalHelpPages(), 1);
  await bot.createInteractionResponse(interaction.id, interaction.token, {
    type: 7,
    data: {
      embeds: [buildHelpEmbedPage(bounded).toJSON()],
      components: buildHelpComponents(bounded),
    },
  });
}

async function handleRigbyComponentInteraction(interaction) {
  const customId = interaction?.component?.custom_id;
  if (!customId) return false;

  const pageFromButton = helpPageFromCustomId(customId);
  if (pageFromButton) {
    await applyHelpPageInteraction(interaction, pageFromButton);
    return true;
  }

  if (customId === HELP_SELECT_CUSTOM_ID) {
    const targetPage = helpPageFromSelectValues(interaction?.component?.values);
    if (!targetPage) {
      await bot.createInteractionResponse(interaction.id, interaction.token, {
        type: 4,
        data: { content: 'Invalid help page selected.', flags: 64 },
      });
      return true;
    }
    await applyHelpPageInteraction(interaction, targetPage);
    return true;
  }

  if (customId === HELP_SETUP_MODAL_OPEN) {
    await bot.createInteractionResponse(interaction.id, interaction.token, {
      type: 9,
      data: buildRigbySetupModal().toJSON(),
    });
    return true;
  }

  return false;
}

async function handleRigbySetupModalSubmit(interaction) {
  await bot.deferInteraction(interaction.id, interaction.token, { ephemeral: true });
  const serverId = await interactionServerId(interaction);
  if (!serverId) {
    await bot.editInteractionOriginal(interaction.id, interaction.token, {
      content: 'Quick Setup can only be used in server channels.',
    });
    return true;
  }

  const cfg = getServerConfig(serverId);
  const values = modalValuesMap(interaction);
  const changed = [];
  const logInput = String(values.log_channel_id || '').trim();
  const rolesInput = String(values.mod_role_ids || '').trim();

  if (logInput) {
    if (['off', 'none', 'disable'].includes(logInput.toLowerCase())) {
      cfg.logChannelId = null;
      changed.push('log channel disabled');
    } else {
      cfg.logChannelId = extractIdToken(logInput);
      changed.push(`log channel set to \`${cfg.logChannelId}\``);
    }
  }
  if (rolesInput) {
    const roleIds = parseCsvIds(rolesInput);
    cfg.modRoleIds = roleIds;
    changed.push(`moderator roles updated (${roleIds.length})`);
  }

  saveStore();
  await bot.editInteractionOriginal(interaction.id, interaction.token, {
    content: changed.length > 0
      ? `Rigby setup updated: ${changed.join(', ')}.`
      : 'No changes submitted. Tip: fill at least one field in the setup modal.',
  });
  await bot.createInteractionFollowup(interaction.id, interaction.token, {
    content: `Use \`${PREFIX}config\` to review full server settings.`,
    flags: 64,
  });

  if (changed.length > 0) {
    const actor = interaction?.user?.id ? `<@${interaction.user.id}>` : 'unknown user';
    await sendModLog(serverId, `[Rigby] Quick Setup updated by ${actor}: ${changed.join(', ')}`);
  }
  return true;
}

async function handleRigbyModalSubmit(interaction) {
  if (interaction?.modal?.custom_id === HELP_SETUP_MODAL_ID) {
    return handleRigbySetupModalSubmit(interaction);
  }
  return false;
}

async function handleRigbyContextUser(interaction) {
  const target = interaction?.command?.target_user || {};
  const targetId = String(target.id || '').trim();
  if (!targetId) {
    await bot.createInteractionResponse(interaction.id, interaction.token, {
      type: 4,
      data: { content: 'No target user found in this interaction.', flags: 64 },
    });
    return true;
  }

  await bot.deferInteraction(interaction.id, interaction.token, { ephemeral: true });
  const serverId = await interactionServerId(interaction);
  const cfg = serverId ? getServerConfig(serverId) : null;
  const warningCount = cfg ? listWarnings(cfg, targetId).length : 0;
  const display = target.display_name || target.username || targetId;

  const embed = new EmbedBuilder()
    .setTitle(`Rigby User Snapshot: ${display}`)
    .setColor('#0ea5e9')
    .addField('User ID', `\`${targetId}\``, false)
    .addField('Warnings', String(warningCount), true)
    .addField('Server', serverId ? `\`${serverId}\`` : 'N/A', true)
    .setTimestamp();

  await bot.editInteractionOriginal(interaction.id, interaction.token, {
    embeds: [embed.toJSON()],
  });
  await bot.createInteractionFollowup(interaction.id, interaction.token, {
    content: `Tip: use \`${PREFIX}warnings ${targetId}\` for details.`,
    flags: 64,
  });
  return true;
}

async function handleRigbyContextMessage(interaction) {
  const targetMessageId = String(interaction?.command?.target_message_id || '').trim();
  const targetAuthorId = String(interaction?.command?.target_author_id || '').trim();
  await bot.deferInteraction(interaction.id, interaction.token, { ephemeral: true });

  let messagePreview = 'Message content unavailable.';
  const channelId = interaction?.channel_id;
  if (channelId && targetMessageId) {
    try {
      const recent = await bot.fetchMessages(channelId, { limit: 100 });
      const found = safeArray(recent).find((m) => String(m?._id || '') === targetMessageId);
      if (found?.content) messagePreview = String(found.content).slice(0, 500);
    } catch {}
  }

  const serverId = await interactionServerId(interaction);
  const warningCount = (serverId && targetAuthorId)
    ? listWarnings(getServerConfig(serverId), targetAuthorId).length
    : 0;

  const embed = new EmbedBuilder()
    .setTitle('Rigby Message Snapshot')
    .setColor('#f59e0b')
    .addField('Message ID', targetMessageId ? `\`${targetMessageId}\`` : 'Unknown', false)
    .addField('Author', targetAuthorId ? `<@${targetAuthorId}>` : 'Unknown', true)
    .addField('Warnings', String(warningCount), true)
    .setDescription(messagePreview)
    .setTimestamp();

  await bot.editInteractionOriginal(interaction.id, interaction.token, {
    embeds: [embed.toJSON()],
  });
  return true;
}

async function handleRigbyApplicationCommand(interaction) {
  const cmdType = String(interaction?.command?.type || 'CHAT_INPUT').toUpperCase();
  if (cmdType === 'USER') return handleRigbyContextUser(interaction);
  if (cmdType === 'MESSAGE') return handleRigbyContextMessage(interaction);

  // Fallback for chat-input interactions routed to Rigby.
  await bot.createInteractionResponse(interaction.id, interaction.token, {
    type: 4,
    data: {
      content: `Rigby is online. Use \`${PREFIX}help\` for commands.`,
      flags: 64,
    },
  });
  return true;
}

async function handleRigbyInteraction(interaction) {
  if (!interaction?.id || !interaction?.token) return;
  const type = String(interaction.type || '').toLowerCase();
  if (type === 'message_component') {
    const handled = await handleRigbyComponentInteraction(interaction);
    if (handled) return;
  } else if (type === 'modal_submit') {
    const handled = await handleRigbyModalSubmit(interaction);
    if (handled) return;
  } else if (type === 'application_command') {
    const handled = await handleRigbyApplicationCommand(interaction);
    if (handled) return;
  }
}

bot.on(GatewayEvents.INTERACTION_CREATE, (interaction) => {
  handleRigbyInteraction(interaction).catch((e) => {
    console.error('[Rigby] interaction error:', errMsg(e));
  });
});

bot.on(GatewayEvents.MESSAGE_CREATE, (message) => {
  handleAutomodMessage(message).catch((e) => {
    console.error('[Rigby] automod error:', errMsg(e));
  });
});

async function main() {
  bot.startCommandRouter({ prefix: PREFIX, ignoreBotMessages: true });
  await bot.connect();
}

main().catch((e) => {
  console.error('[Rigby] fatal:', e);
  process.exit(1);
});
