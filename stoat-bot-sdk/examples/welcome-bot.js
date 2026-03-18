/**
 * Welcome bot with command-based config.
 *
 * Commands (run in any server channel the bot can read):
 *   !setchannel <channelId>   - set the channel where welcome messages are posted
 *   !setwelcomemsg <message>  - set the welcome message; use $user for the new member (e.g. "Welcome $user!")
 *   !welcome                  - show current welcome channel and message
 *
 * Placeholder: $user = mention of the user who joined
 *
 * Config is stored per server in .bot-data/welcome-bot.json
 *
 * Run: BOT_TOKEN=xxx node examples/welcome-bot.js
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import {
  StoatBotClient,
  GatewayIntents,
  GatewayEvents,
} from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '.bot-data');
const CONFIG_PATH = join(DATA_DIR, 'welcome-bot.json');

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(config) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

const token = "EIC2wX0s6gdCdV3eYraKYjVY3eO6j1SBvnoKpOicg7C97r6MHwiaIlTc72gxsw1l"

const bot = new StoatBotClient({
  token,
  baseUrl: process.env.BOT_API_BASE || 'http://localhost:14702',
  intents: GatewayIntents.GUILDS | GatewayIntents.GUILD_MEMBERS | GatewayIntents.GUILD_MESSAGES | GatewayIntents.MESSAGE_CONTENT,
  prefix: '!',
});

function formatWelcomeMessage(template, userId, username) {
  return template
    .replace(/\$user/g, `<@${userId}>`)
    .replace(/\{user\}/g, `<@${userId}>`)
    .replace(/\{username\}/g, username || 'User')
    .replace(/\{mention\}/g, username ? `@${username}` : `<@${userId}>`);
}

bot.on('open', () => console.log('Welcome bot connected'));
bot.on(GatewayEvents.READY, (d) => console.log('Ready as', d?.users?.[0]?.username || 'bot'));
bot.setStatus({ presence: 'Online', text: 'PumpKit Bundler' })
// Commands: need server id from the channel where the command was run
bot.command('setchannel', async (ctx) => {
  const channelId = ctx.args[0]?.trim();
  if (!channelId) {
    await ctx.reply('Usage: !setchannel <channelId>');
    return;
  }
  let serverId;
  try {
    const ch = await bot.getChannel(ctx.message.channel);
    serverId = ch?.server;
  } catch (e) {
    await ctx.reply('Could not resolve this channel (not a server channel?).');
    return;
  }
  if (!serverId) {
    await ctx.reply('This channel is not in a server (e.g. DM). Run the command in a server channel.');
    return;
  }
  const config = loadConfig();
  if (!config[serverId]) config[serverId] = { message: 'Welcome $user!' };
  config[serverId].channelId = channelId;
  saveConfig(config);
  await ctx.reply(`Welcome channel set to \`${channelId}\`. New members will be welcomed there.`);
}, { description: 'Set welcome channel: !setchannel <channelId>' });

bot.command('setwelcomemsg', async (ctx) => {
  const message = ctx.rawArgs.trim();
  if (!message) {
    await ctx.reply('Usage: !setwelcomemsg <message> — use $user for the new member, e.g. "Welcome $user!"');
    return;
  }
  let serverId;
  try {
    const ch = await bot.getChannel(ctx.message.channel);
    serverId = ch?.server;
  } catch (e) {
    await ctx.reply('Could not resolve this channel.');
    return;
  }
  if (!serverId) {
    await ctx.reply('Run this command in a server channel.');
    return;
  }
  const config = loadConfig();
  if (!config[serverId]) config[serverId] = { channelId: null, message: 'Welcome $user!' };
  config[serverId].message = message;
  saveConfig(config);
  const preview = message.replace(/\$user/g, '@NewMember').replace(/\{user\}/g, '@NewMember').replace(/\{username\}/g, 'NewMember');
  await ctx.reply(`Welcome message set. Example: ${preview}`);
}, { description: 'Set welcome message: !setwelcomemsg welcome $user' });

bot.command('welcome', async (ctx) => {
  let serverId;
  try {
    const ch = await bot.getChannel(ctx.message.channel);
    serverId = ch?.server;
  } catch (e) {
    await ctx.reply('Could not resolve this channel.');
    return;
  }
  if (!serverId) {
    await ctx.reply('Run this in a server channel.');
    return;
  }
  const config = loadConfig();
  const c = config[serverId];
  if (!c?.channelId) {
    await ctx.reply('Welcome channel not set. Use `!setchannel <channelId>` first.');
    return;
  }
  await ctx.reply(`Welcome channel: \`${c.channelId}\`\nMessage: ${c.message || 'Welcome $user!'}`);
}, { description: 'Show current welcome channel and message' });

bot.startCommandRouter();

bot.on(GatewayEvents.SERVER_MEMBER_JOIN, async (data) => {
  const serverId = data?.serverId;
  const member = data?.member;
  const user = member?.user;
  const userId = user?._id ?? member?.user;
  if (!userId || !serverId) return;

  const config = loadConfig();
  const c = config[serverId];
  if (!c?.channelId) return;

  const template = c.message || 'Welcome $user!';
  const username = typeof user === 'object' ? (user?.display_name || user?.username) : null;
  const content = formatWelcomeMessage(template, userId, username);

  try {
    await bot.sendMessage(c.channelId, content, { mentions: [userId] });
    console.log('Sent welcome for', username || userId);
  } catch (err) {
    console.error('Failed to send welcome:', err?.message || err);
  }
});

bot.on('error', (err) => console.error(err));

await bot.connect();
