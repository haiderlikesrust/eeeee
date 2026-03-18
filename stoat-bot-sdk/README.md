# Stoat Bot SDK

Official SDK for Stoat's public bot API and Gateway.

The SDK now includes:

- command router (`!ping`, `!help`, aliases)
- message helpers (`reply`, `sendEmbed`, `editMessage`, `deleteMessage`)
- reaction helpers (`addReaction`, `removeReaction`)
- event constants (`GatewayEvents`)
- embed builder (`EmbedBuilder`)

## Install

```bash
npm install
```

## Quick Start

```js
import {
  StoatBotClient,
  GatewayIntents,
  GatewayEvents,
  EmbedBuilder,
} from './src/index.js';

const bot = new StoatBotClient({
  token: process.env.BOT_TOKEN,
  baseUrl: 'http://localhost:14702',
  intents: GatewayIntents.GUILDS | GatewayIntents.GUILD_MESSAGES | GatewayIntents.MESSAGE_CONTENT,
  prefix: '!',
});

bot.on('open', () => console.log('Connected'));
bot.on(GatewayEvents.READY, () => console.log('Ready'));

bot.command('ping', async ({ reply }) => {
  await reply('pong');
}, { description: 'Connectivity test' });

bot.command('help', async ({ reply }) => {
  const embed = new EmbedBuilder()
    .setTitle('Commands')
    .setDescription('Use !ping')
    .setColor('#10b981')
    .setTimestamp();
  await reply({ embeds: [embed.toJSON()] });
}, { description: 'Show help' });

bot.startCommandRouter();

await bot.connect();
```

## Command Router

```js
bot.command('kick', async ({ args, reply }) => {
  const [userId] = args;
  if (!userId) return reply('Usage: !kick <userId>');
  // your moderation logic here
  await reply(`Would kick ${userId}`);
}, {
  aliases: ['boot'],
  description: 'Kick a user',
});

bot.startCommandRouter({
  prefix: '!',
  ignoreBotMessages: true,
});
```

Context available in command handlers:

- `message`
- `args` / `rawArgs`
- `reply(contentOrPayload)`
- `send(contentOrPayload)`
- `client`

## Advanced Economy Example

A full dank-style economy + trading bot is included:

- file: `examples/dank-trader-bot.js`
- persistent JSON database (`examples/.bot-data/dank-trader-db.json`)
- cooldown economy commands (`daily/work/beg/crime`)
- market simulation + portfolio + trade history
- leaderboards + admin money controls

Run it:

```bash
BOT_TOKEN=your_token_here node examples/dank-trader-bot.js
```

Useful commands:

- `!help`
- `!bal`, `!daily`, `!work`, `!deposit`, `!withdraw`, `!transfer`
- `!market`, `!price BTC`, `!buy BTC 0.02`, `!sell BTC all`, `!portfolio`
- `!leaderboard`, `!history`

## Embed Builder

```js
const embed = new EmbedBuilder()
  .setTitle('Server Stats')
  .setDescription('Live dashboard')
  .setColor('#5865f2')
  .addField('Online', '23', true)
  .addField('Bots', '4', true)
  .setFooter('Stoat Bot')
  .setTimestamp();

await bot.sendEmbed(channelId, embed);
```

## Public Bot API

- `GET /bot/@me` - bot + user info
- `GET /bot/gateway` - gateway url + intents
- `GET /bot/channels/:target/messages`
- `POST /bot/channels/:target/messages`
- `PATCH /bot/channels/:target/messages/:msg`
- `DELETE /bot/channels/:target/messages/:msg`
- `PUT /bot/channels/:target/messages/:msg/reactions/:emoji`
- `DELETE /bot/channels/:target/messages/:msg/reactions/:emoji`

Auth header:

```http
Authorization: Bot <BOT_TOKEN>
```

or

```http
x-bot-token: <BOT_TOKEN>
```

## Gateway

Connect to:

`ws://localhost:14702/?bot_token=<BOT_TOKEN>&intents=<BITFIELD>`

Current events:

- `Ready`
- `ServerMemberJoin` – when a user joins the server (via invite). Use for welcome bots.
- `MESSAGE_CREATE`
- `MESSAGE_UPDATE`
- `MESSAGE_DELETE`
- `MESSAGE_REACTION_ADD`
- `MESSAGE_REACTION_REMOVE`

You can use constants from `GatewayEvents` in the SDK (e.g. `GatewayEvents.SERVER_MEMBER_JOIN`).

## Welcome bot

The API supports a welcome bot: allow the bot to send messages in a channel, then when a user joins the server the bot receives `ServerMemberJoin` and can post a customizable message.

1. Add the bot to your server and give it permission to send messages in the welcome channel (or use a role that can).
2. In your bot code, listen for `ServerMemberJoin` and call `POST /bot/channels/:channelId/messages` with your welcome text. Use `<@userId>` in the content and `mentions: [userId]` so the new member is mentioned.

Example (see `examples/welcome-bot.js`): configure via commands in chat:

```bash
BOT_TOKEN=xxx node examples/welcome-bot.js
```

Then in a server channel:

- `!setchannel <channelId>` – channel where welcome messages are posted
- `!setwelcomemsg welcome $user` – welcome text; `$user` = mention of the new member
- `!welcome` – show current channel and message

Config is saved per server in `examples/.bot-data/welcome-bot.json`.
