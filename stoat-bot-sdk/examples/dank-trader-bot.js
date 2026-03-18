import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  StoatBotClient,
  GatewayIntents,
  GatewayEvents,
  EmbedBuilder,
} from '../src/index.js';

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('Set BOT_TOKEN first');
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '.bot-data');
const DATA_FILE = path.join(DATA_DIR, 'dank-trader-db.json');

const CONFIG = {
  prefix: process.env.BOT_PREFIX || '!',
  startingCash: 750,
  dailyReward: [350, 900],
  workReward: [140, 400],
  begReward: [25, 150],
  crimeReward: [220, 900],
  crimeFine: [100, 500],
  depositCap: 2_000_000_000,
  tradeFeeRate: 0.015,
  transferFeeRate: 0.01,
  dailyCooldownMs: 24 * 60 * 60 * 1000,
  workCooldownMs: 15 * 60 * 1000,
  begCooldownMs: 90 * 1000,
  crimeCooldownMs: 8 * 60 * 1000,
  tradeCooldownMs: 2_500,
  adminIds: new Set(
    String(process.env.BOT_ADMIN_IDS || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  ),
  market: {
    BTC: { base: 52_000, vol: 0.075, drift: 0.004 },
    ETH: { base: 2_900, vol: 0.085, drift: 0.005 },
    SOL: { base: 125, vol: 0.12, drift: 0.006 },
    DOGE: { base: 0.22, vol: 0.16, drift: 0.008 },
    GOLD: { base: 72, vol: 0.04, drift: 0.002 },
    OIL: { base: 88, vol: 0.055, drift: 0.0025 },
  },
};

const bot = new StoatBotClient({
  token,
  baseUrl: process.env.BOT_API_BASE || 'http://localhost:14702',
  intents: GatewayIntents.GUILDS | GatewayIntents.GUILD_MESSAGES | GatewayIntents.MESSAGE_CONTENT,
  prefix: CONFIG.prefix,
});

const STATE = {
  users: {},
  market: {},
  history: [],
  updatedAt: Date.now(),
};

const RUNTIME = {
  saveTimer: null,
  userCache: new Map(),
};

function toMoney(n, digits = 2) {
  return `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: digits })}`;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function randInt(min, max) {
  const a = Math.ceil(min);
  const b = Math.floor(max);
  return Math.floor(Math.random() * (b - a + 1)) + a;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function now() {
  return Date.now();
}

function parseUserId(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const mention = s.match(/^<@([a-zA-Z0-9]+)>$/);
  if (mention) return mention[1];
  const simple = s.match(/^[a-zA-Z0-9]+$/);
  return simple ? simple[0] : null;
}

function parseAmount(input, available = null) {
  if (input == null) return null;
  const text = String(input).trim().toLowerCase();
  if (!text) return null;
  if (['all', 'max'].includes(text)) return available != null ? Number(available) : null;
  if (text === 'half' && available != null) return Number(available) / 2;
  const normalized = text.replace(/,/g, '').replace(/k$/i, '000').replace(/m$/i, '000000').replace(/b$/i, '000000000');
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return n;
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function loadState() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    STATE.users = parsed.users && typeof parsed.users === 'object' ? parsed.users : {};
    STATE.market = parsed.market && typeof parsed.market === 'object' ? parsed.market : {};
    STATE.history = Array.isArray(parsed.history) ? parsed.history.slice(-300) : [];
    STATE.updatedAt = toNum(parsed.updatedAt) || now();
  } catch {
    STATE.users = {};
    STATE.market = {};
    STATE.history = [];
    STATE.updatedAt = now();
  }
  initMarketIfNeeded();
}

function scheduleSave() {
  if (RUNTIME.saveTimer) return;
  RUNTIME.saveTimer = setTimeout(async () => {
    RUNTIME.saveTimer = null;
    try {
      await ensureDataDir();
      await fs.writeFile(
        DATA_FILE,
        JSON.stringify(
          {
            users: STATE.users,
            market: STATE.market,
            history: STATE.history.slice(-300),
            updatedAt: STATE.updatedAt,
          },
          null,
          2
        )
      );
    } catch (err) {
      console.error('Failed saving db:', err?.message || err);
    }
  }, 500);
}

function initMarketIfNeeded() {
  for (const [sym, cfg] of Object.entries(CONFIG.market)) {
    if (!STATE.market[sym]) {
      STATE.market[sym] = {
        price: cfg.base,
        high: cfg.base,
        low: cfg.base,
        lastChangePct: 0,
      };
    }
  }
}

function updateMarket() {
  initMarketIfNeeded();
  const elapsedMs = now() - (STATE.updatedAt || now());
  const minutes = Math.max(1, elapsedMs / 60_000);
  const factor = Math.min(6, Math.max(0.5, minutes / 2.5));
  for (const [sym, cfg] of Object.entries(CONFIG.market)) {
    const m = STATE.market[sym];
    const drift = cfg.drift * (Math.random() - 0.45) * factor;
    const shock = cfg.vol * (Math.random() - 0.5) * factor;
    const pct = clamp(drift + shock, -0.33, 0.33);
    const next = Math.max(cfg.base * 0.12, m.price * (1 + pct));
    m.lastChangePct = pct;
    m.price = next;
    m.high = Math.max(m.high || next, next);
    m.low = Math.min(m.low || next, next);
  }
  STATE.updatedAt = now();
  scheduleSave();
}

function getUser(userId) {
  if (!STATE.users[userId]) {
    STATE.users[userId] = {
      cash: CONFIG.startingCash,
      bank: 0,
      holdings: {},
      stats: {
        earned: CONFIG.startingCash,
        spent: 0,
        tradedVolume: 0,
        wins: 0,
        losses: 0,
      },
      cooldowns: {},
      createdAt: now(),
      updatedAt: now(),
    };
    scheduleSave();
  }
  return STATE.users[userId];
}

function netWorth(userData) {
  let total = toNum(userData.cash) + toNum(userData.bank);
  for (const [sym, qty] of Object.entries(userData.holdings || {})) {
    total += toNum(qty) * toNum(STATE.market[sym]?.price || 0);
  }
  return total;
}

function hasCooldown(userData, key, ms) {
  const until = toNum(userData.cooldowns?.[key]);
  const left = until - now();
  return left > 0 ? left : 0;
}

function setCooldown(userData, key, ms) {
  userData.cooldowns = userData.cooldowns || {};
  userData.cooldowns[key] = now() + ms;
}

function formatDuration(ms) {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

async function resolveDisplayName(userId) {
  if (RUNTIME.userCache.has(userId)) return RUNTIME.userCache.get(userId);
  try {
    const data = await bot.api('GET', `/users/${userId}`);
    const n = data?.display_name || data?.username || userId.slice(0, 8);
    RUNTIME.userCache.set(userId, n);
    return n;
  } catch {
    const fallback = userId.slice(0, 8);
    RUNTIME.userCache.set(userId, fallback);
    return fallback;
  }
}

function logTrade(entry) {
  STATE.history.push({ ...entry, ts: now() });
  if (STATE.history.length > 300) {
    STATE.history = STATE.history.slice(-300);
  }
  scheduleSave();
}

function buildMarketEmbed() {
  updateMarket();
  const embed = new EmbedBuilder()
    .setTitle('Live Market Board')
    .setDescription('Prices fluctuate in real time. Use `!buy <symbol> <amount>` and `!sell <symbol> <amount>`.')
    .setColor('#f59e0b')
    .setFooter('Stoat Exchange')
    .setTimestamp();
  for (const sym of Object.keys(CONFIG.market)) {
    const m = STATE.market[sym];
    const arrow = m.lastChangePct >= 0 ? '▲' : '▼';
    const pct = `${(m.lastChangePct * 100).toFixed(2)}%`;
    embed.addField(
      sym,
      `${toMoney(m.price, m.price < 1 ? 5 : 2)}\n${arrow} ${pct}\nH:${toMoney(m.high)} L:${toMoney(m.low)}`,
      true
    );
  }
  return embed;
}

async function maybeReplyCooldown(ctx, userData, key, ms, label) {
  const left = hasCooldown(userData, key, ms);
  if (left <= 0) return false;
  await ctx.reply(`⏳ ${label} is on cooldown for ${formatDuration(left)}.`);
  return true;
}

bot.on('open', () => console.log('Trader bot connected'));
bot.on(GatewayEvents.READY, () => console.log('Trader bot ready'));

bot.command('help', async ({ reply }) => {
  const embed = new EmbedBuilder()
    .setTitle('Dank Trader Commands')
    .setColor('#10b981')
    .setDescription(
      [
        '`!bal [userId]` `!daily` `!work` `!beg` `!crime`',
        '`!deposit <amt>` `!withdraw <amt>` `!transfer <userId> <amt>`',
        '`!market` `!price <symbol>` `!buy <symbol> <amt>` `!sell <symbol> <amt>`',
        '`!portfolio` `!leaderboard [net|cash|bank]` `!history [count]`',
        '`!setmoney <userId> <amt>` (admin)',
      ].join('\n')
    )
    .setFooter('Use k/m/b suffixes: 10k, 2m')
    .setTimestamp();
  await reply({ embeds: [embed.toJSON()] });
}, { description: 'Show command list' });

bot.command('market', async ({ reply }) => {
  const embed = buildMarketEmbed();
  await reply({ embeds: [embed.toJSON()] });
}, { description: 'Show live market prices' });

bot.command('price', async ({ args, reply }) => {
  updateMarket();
  const sym = String(args[0] || '').toUpperCase();
  const m = STATE.market[sym];
  if (!m) {
    await reply(`Unknown symbol. Try one of: ${Object.keys(CONFIG.market).join(', ')}`);
    return;
  }
  await reply(`${sym}: ${toMoney(m.price, m.price < 1 ? 5 : 2)} (${(m.lastChangePct * 100).toFixed(2)}%)`);
}, { description: 'Check single asset price' });

bot.command('bal', async ({ args, message, reply }) => {
  const me = message?.author?._id;
  const target = parseUserId(args[0]) || me;
  if (!target) return;
  updateMarket();
  const u = getUser(target);
  const name = await resolveDisplayName(target);
  const holdValue = Object.entries(u.holdings || {}).reduce(
    (sum, [sym, qty]) => sum + toNum(qty) * toNum(STATE.market[sym]?.price || 0),
    0
  );
  const embed = new EmbedBuilder()
    .setTitle(`${name}'s Balance`)
    .setColor('#3b82f6')
    .addField('Cash', toMoney(u.cash), true)
    .addField('Bank', toMoney(u.bank), true)
    .addField('Portfolio', toMoney(holdValue), true)
    .addField('Net Worth', toMoney(netWorth(u)), false)
    .setTimestamp();
  await reply({ embeds: [embed.toJSON()] });
}, { description: 'Show wallet + net worth' });

bot.command('daily', async ({ message, reply }) => {
  const userId = message?.author?._id;
  if (!userId) return;
  const u = getUser(userId);
  if (await maybeReplyCooldown({ reply }, u, 'daily', CONFIG.dailyCooldownMs, 'Daily')) return;
  const reward = randInt(CONFIG.dailyReward[0], CONFIG.dailyReward[1]);
  u.cash += reward;
  u.stats.earned += reward;
  setCooldown(u, 'daily', CONFIG.dailyCooldownMs);
  u.updatedAt = now();
  scheduleSave();
  await reply(`✅ Daily claimed: +${toMoney(reward)} (cash: ${toMoney(u.cash)})`);
}, { description: 'Claim daily reward' });

bot.command('work', async ({ message, reply }) => {
  const userId = message?.author?._id;
  if (!userId) return;
  const u = getUser(userId);
  if (await maybeReplyCooldown({ reply }, u, 'work', CONFIG.workCooldownMs, 'Work')) return;
  const reward = randInt(CONFIG.workReward[0], CONFIG.workReward[1]);
  u.cash += reward;
  u.stats.earned += reward;
  setCooldown(u, 'work', CONFIG.workCooldownMs);
  u.updatedAt = now();
  scheduleSave();
  await reply(`🛠️ You worked a shift and earned ${toMoney(reward)}.`);
}, { description: 'Work for money' });

bot.command('beg', async ({ message, reply }) => {
  const userId = message?.author?._id;
  if (!userId) return;
  const u = getUser(userId);
  if (await maybeReplyCooldown({ reply }, u, 'beg', CONFIG.begCooldownMs, 'Beg')) return;
  const reward = randInt(CONFIG.begReward[0], CONFIG.begReward[1]);
  u.cash += reward;
  u.stats.earned += reward;
  setCooldown(u, 'beg', CONFIG.begCooldownMs);
  u.updatedAt = now();
  scheduleSave();
  await reply(`🙏 Someone dropped you ${toMoney(reward)}.`);
}, { description: 'Small cooldown income' });

bot.command('crime', async ({ message, reply }) => {
  const userId = message?.author?._id;
  if (!userId) return;
  const u = getUser(userId);
  if (await maybeReplyCooldown({ reply }, u, 'crime', CONFIG.crimeCooldownMs, 'Crime')) return;
  const success = Math.random() > 0.43;
  if (success) {
    const reward = randInt(CONFIG.crimeReward[0], CONFIG.crimeReward[1]);
    u.cash += reward;
    u.stats.earned += reward;
    await reply(`🕵️ Heist succeeded. You gained ${toMoney(reward)}.`);
  } else {
    const fine = randInt(CONFIG.crimeFine[0], CONFIG.crimeFine[1]);
    const paid = Math.min(u.cash, fine);
    u.cash -= paid;
    u.stats.spent += paid;
    await reply(`🚨 You got caught and paid ${toMoney(paid)} in fines.`);
  }
  setCooldown(u, 'crime', CONFIG.crimeCooldownMs);
  u.updatedAt = now();
  scheduleSave();
}, { description: 'Risk/reward gamble' });

bot.command('deposit', async ({ args, message, reply }) => {
  const userId = message?.author?._id;
  if (!userId) return;
  const u = getUser(userId);
  const raw = parseAmount(args[0], u.cash);
  const amt = Math.floor(raw || 0);
  if (amt <= 0) {
    await reply('Usage: !deposit <amount|all>');
    return;
  }
  if (amt > u.cash) {
    await reply('Not enough cash.');
    return;
  }
  const allowed = Math.max(0, CONFIG.depositCap - u.bank);
  const moved = Math.min(amt, allowed);
  if (moved <= 0) {
    await reply('Bank is at max capacity.');
    return;
  }
  u.cash -= moved;
  u.bank += moved;
  u.updatedAt = now();
  scheduleSave();
  await reply(`🏦 Deposited ${toMoney(moved)}.`);
}, { description: 'Move cash to bank' });

bot.command('withdraw', async ({ args, message, reply }) => {
  const userId = message?.author?._id;
  if (!userId) return;
  const u = getUser(userId);
  const raw = parseAmount(args[0], u.bank);
  const amt = Math.floor(raw || 0);
  if (amt <= 0) {
    await reply('Usage: !withdraw <amount|all>');
    return;
  }
  if (amt > u.bank) {
    await reply('Not enough bank balance.');
    return;
  }
  u.bank -= amt;
  u.cash += amt;
  u.updatedAt = now();
  scheduleSave();
  await reply(`💵 Withdrew ${toMoney(amt)}.`);
}, { description: 'Move bank to cash', aliases: ['wd'] });

bot.command('transfer', async ({ args, message, reply }) => {
  const senderId = message?.author?._id;
  const targetId = parseUserId(args[0]);
  if (!senderId || !targetId || senderId === targetId) {
    await reply('Usage: !transfer <userId> <amount>');
    return;
  }
  const sender = getUser(senderId);
  const receiver = getUser(targetId);
  const raw = parseAmount(args[1], sender.cash);
  const amount = Math.floor(raw || 0);
  if (amount <= 0) {
    await reply('Amount must be positive.');
    return;
  }
  const fee = Math.max(1, Math.floor(amount * CONFIG.transferFeeRate));
  const total = amount + fee;
  if (total > sender.cash) {
    await reply(`You need ${toMoney(total)} (including fee ${toMoney(fee)}).`);
    return;
  }
  sender.cash -= total;
  sender.stats.spent += total;
  receiver.cash += amount;
  receiver.stats.earned += amount;
  sender.updatedAt = now();
  receiver.updatedAt = now();
  scheduleSave();
  const name = await resolveDisplayName(targetId);
  await reply(`✅ Sent ${toMoney(amount)} to **${name}**. Fee: ${toMoney(fee)}.`);
}, { description: 'Send money to another user' });

bot.command('buy', async ({ args, message, reply }) => {
  const userId = message?.author?._id;
  if (!userId) return;
  updateMarket();
  const sym = String(args[0] || '').toUpperCase();
  if (!STATE.market[sym]) {
    await reply(`Unknown symbol. Try: ${Object.keys(CONFIG.market).join(', ')}`);
    return;
  }
  const u = getUser(userId);
  if (await maybeReplyCooldown({ reply }, u, 'trade', CONFIG.tradeCooldownMs, 'Trading')) return;
  const price = STATE.market[sym].price;
  const maxQty = u.cash / (price * (1 + CONFIG.tradeFeeRate));
  const rawQty = parseAmount(args[1], maxQty);
  const qty = Math.floor((rawQty || 0) * 10_000) / 10_000;
  if (qty <= 0) {
    await reply('Usage: !buy <symbol> <quantity|all>');
    return;
  }
  const gross = qty * price;
  const fee = gross * CONFIG.tradeFeeRate;
  const total = gross + fee;
  if (total > u.cash) {
    await reply(`Insufficient cash. Need ${toMoney(total)}.`);
    return;
  }
  u.cash -= total;
  u.holdings[sym] = toNum(u.holdings[sym]) + qty;
  u.stats.spent += total;
  u.stats.tradedVolume += gross;
  setCooldown(u, 'trade', CONFIG.tradeCooldownMs);
  u.updatedAt = now();
  logTrade({ userId, side: 'BUY', sym, qty, price, fee });
  await reply(`📈 Bought **${qty.toFixed(4)} ${sym}** @ ${toMoney(price)} (fee ${toMoney(fee)}).`);
}, { description: 'Buy market asset' });

bot.command('sell', async ({ args, message, reply }) => {
  const userId = message?.author?._id;
  if (!userId) return;
  updateMarket();
  const sym = String(args[0] || '').toUpperCase();
  if (!STATE.market[sym]) {
    await reply(`Unknown symbol. Try: ${Object.keys(CONFIG.market).join(', ')}`);
    return;
  }
  const u = getUser(userId);
  if (await maybeReplyCooldown({ reply }, u, 'trade', CONFIG.tradeCooldownMs, 'Trading')) return;
  const owned = toNum(u.holdings[sym]);
  const rawQty = parseAmount(args[1], owned);
  const qty = Math.floor((rawQty || 0) * 10_000) / 10_000;
  if (qty <= 0) {
    await reply('Usage: !sell <symbol> <quantity|all>');
    return;
  }
  if (qty > owned) {
    await reply(`You only own ${owned.toFixed(4)} ${sym}.`);
    return;
  }
  const price = STATE.market[sym].price;
  const gross = qty * price;
  const fee = gross * CONFIG.tradeFeeRate;
  const net = gross - fee;
  u.holdings[sym] = owned - qty;
  if (u.holdings[sym] <= 0.0000001) delete u.holdings[sym];
  u.cash += net;
  u.stats.earned += net;
  u.stats.tradedVolume += gross;
  setCooldown(u, 'trade', CONFIG.tradeCooldownMs);
  u.updatedAt = now();
  logTrade({ userId, side: 'SELL', sym, qty, price, fee });
  await reply(`📉 Sold **${qty.toFixed(4)} ${sym}** @ ${toMoney(price)} (fee ${toMoney(fee)}).`);
}, { description: 'Sell market asset' });

bot.command('portfolio', async ({ message, reply }) => {
  const userId = message?.author?._id;
  if (!userId) return;
  updateMarket();
  const u = getUser(userId);
  const entries = Object.entries(u.holdings || {});
  if (entries.length === 0) {
    await reply('Your portfolio is empty. Use `!buy` to open positions.');
    return;
  }
  const embed = new EmbedBuilder()
    .setTitle('Your Portfolio')
    .setColor('#8b5cf6')
    .setTimestamp();
  let total = 0;
  for (const [sym, qty] of entries) {
    const price = toNum(STATE.market[sym]?.price);
    const value = price * toNum(qty);
    total += value;
    embed.addField(sym, `${qty.toFixed(4)} units\nValue: ${toMoney(value)}`, true);
  }
  embed.addField('Total Portfolio Value', toMoney(total), false);
  await reply({ embeds: [embed.toJSON()] });
}, { description: 'Show holdings and valuation' });

bot.command('leaderboard', async ({ args, reply }) => {
  updateMarket();
  const mode = String(args[0] || 'net').toLowerCase();
  const rows = Object.entries(STATE.users);
  let scorer = (u) => netWorth(u);
  if (mode === 'cash') scorer = (u) => toNum(u.cash);
  if (mode === 'bank') scorer = (u) => toNum(u.bank);
  const top = rows
    .map(([id, data]) => ({ id, value: scorer(data) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
  if (top.length === 0) {
    await reply('No economy data yet.');
    return;
  }
  const lines = [];
  for (let i = 0; i < top.length; i++) {
    const row = top[i];
    const name = await resolveDisplayName(row.id);
    lines.push(`**${i + 1}.** ${name} — ${toMoney(row.value)}`);
  }
  const title = mode === 'cash' ? 'Cash Leaderboard' : mode === 'bank' ? 'Bank Leaderboard' : 'Net Worth Leaderboard';
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(lines.join('\n'))
    .setColor('#f59e0b')
    .setTimestamp();
  await reply({ embeds: [embed.toJSON()] });
}, { description: 'Top economy players' });

bot.command('history', async ({ args, message, reply }) => {
  const userId = message?.author?._id;
  if (!userId) return;
  const count = clamp(Math.floor(toNum(args[0]) || 8), 1, 20);
  const items = STATE.history.filter((x) => x.userId === userId).slice(-count).reverse();
  if (items.length === 0) {
    await reply('No trades yet.');
    return;
  }
  const embed = new EmbedBuilder()
    .setTitle('Recent Trades')
    .setColor('#ef4444')
    .setTimestamp();
  for (const t of items) {
    const at = new Date(t.ts).toLocaleString();
    embed.addField(
      `${t.side} ${t.sym}`,
      `${t.qty.toFixed(4)} @ ${toMoney(t.price)}\nFee: ${toMoney(t.fee)}\n${at}`,
      false
    );
  }
  await reply({ embeds: [embed.toJSON()] });
}, { description: 'Show your latest trades' });

bot.command('setmoney', async ({ args, message, reply }) => {
  const caller = message?.author?._id;
  if (!caller) return;
  if (!CONFIG.adminIds.has(caller)) {
    await reply('⛔ Admin only.');
    return;
  }
  const targetId = parseUserId(args[0]);
  const amount = Math.floor(toNum(args[1]));
  if (!targetId || !Number.isFinite(amount) || amount < 0) {
    await reply('Usage: !setmoney <userId> <amount>');
    return;
  }
  const u = getUser(targetId);
  u.cash = amount;
  u.updatedAt = now();
  scheduleSave();
  await reply(`Set ${targetId}'s cash to ${toMoney(amount)}.`);
}, { description: 'Admin economy override' });

bot.command('ping', async ({ reply }) => {
  await reply('pong');
}, { description: 'Connectivity test' });

bot.command('syncmarket', async ({ message, reply }) => {
  const caller = message?.author?._id;
  if (!caller || !CONFIG.adminIds.has(caller)) {
    await reply('⛔ Admin only.');
    return;
  }
  updateMarket();
  await reply('Market updated.');
}, { description: 'Force a market update (admin)' });

bot.startCommandRouter();
bot.on('commandError', (err) => console.error('commandError:', err));
bot.on('error', (err) => console.error(err));

await loadState();
await bot.connect();

