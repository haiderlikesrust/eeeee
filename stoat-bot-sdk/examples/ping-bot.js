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

const bot = new StoatBotClient({
  token,
  baseUrl: process.env.BOT_API_BASE || 'http://localhost:14702',
  intents: GatewayIntents.GUILDS | GatewayIntents.GUILD_MESSAGES | GatewayIntents.MESSAGE_CONTENT,
  prefix: '!',
});

bot.on('open', () => console.log('Connected'));
bot.on(GatewayEvents.READY, (d) => console.log('Ready as', d?.users?.[0]?.username || 'bot'));

bot.command('ping', async ({ reply }) => {
  await reply('pong');
}, { description: 'Simple connectivity test' });

bot.command('help', async ({ reply }) => {
  const commands = bot.getCommands();
  const embed = new EmbedBuilder()
    .setTitle('Bot Commands')
    .setColor('#10b981')
    .setDescription('Available prefix commands')
    .setTimestamp();
  for (const c of commands) {
    embed.addField(`!${c.name}`, c.description || 'No description', false);
  }
  await reply({ embeds: [embed.toJSON()] });
}, { description: 'Show command list' });

bot.startCommandRouter();
bot.on('error', (err) => console.error(err));

await bot.connect();
