import { EventEmitter } from 'events';
import WebSocket from 'ws';

export const GatewayIntents = {
  GUILDS: 1 << 0,
  GUILD_MEMBERS: 1 << 1,
  GUILD_MESSAGES: 1 << 9,
  MESSAGE_CONTENT: 1 << 15,
};

export const GatewayEvents = {
  READY: 'Ready',
  MESSAGE_CREATE: 'MESSAGE_CREATE',
  MESSAGE_UPDATE: 'MESSAGE_UPDATE',
  MESSAGE_DELETE: 'MESSAGE_DELETE',
  MESSAGE_REACTION_ADD: 'MESSAGE_REACTION_ADD',
  MESSAGE_REACTION_REMOVE: 'MESSAGE_REACTION_REMOVE',
  VOICE_READY: 'VoiceReady',
  VOICE_STATE_UPDATE: 'VoiceStateUpdate',
  /** Fired when a user joins a server (via invite). data: { serverId, member: { user, roles, ... } } */
  SERVER_MEMBER_JOIN: 'ServerMemberJoin',
};

function joinUrl(base, path) {
  return `${String(base).replace(/\/+$/, '')}${path}`;
}

function toWsBase(httpBase) {
  const b = String(httpBase).replace(/\/+$/, '');
  if (b.startsWith('https://')) return `wss://${b.slice('https://'.length)}`;
  if (b.startsWith('http://')) return `ws://${b.slice('http://'.length)}`;
  if (b.startsWith('wss://') || b.startsWith('ws://')) return b;
  return `ws://${b}`;
}

function normalizeMessagePayload(content, extra = {}) {
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    return { ...content };
  }
  return {
    ...extra,
    content: content == null ? '' : String(content),
  };
}

function normalizeCommandName(name, caseInsensitive = true) {
  const raw = String(name || '').trim();
  return caseInsensitive ? raw.toLowerCase() : raw;
}

export class StoatBotClient extends EventEmitter {
  constructor({
    token,
    baseUrl = 'http://localhost:14702',
    intents = GatewayIntents.GUILDS | GatewayIntents.GUILD_MESSAGES | GatewayIntents.MESSAGE_CONTENT,
    heartbeatMs = 10000,
    prefix = '!',
    caseInsensitiveCommands = true,
    ignoreBotMessages = true,
  } = {}) {
    super();
    if (!token) throw new Error('token is required');
    this.token = token;
    this.baseUrl = baseUrl;
    this.intents = intents;
    this.heartbeatMs = heartbeatMs;
    this.prefix = String(prefix || '!');
    this.caseInsensitiveCommands = !!caseInsensitiveCommands;
    this.ignoreBotMessages = !!ignoreBotMessages;
    this.ws = null;
    this._hb = null;
    this._commands = new Map();
    this._commandAliases = new Map();
    this._commandUnsub = null;
  }

  async api(method, path, body, opts = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'x-bot-token': this.token,
    };
    if (opts.invokerUserId != null && opts.invokerUserId !== '') {
      headers['x-invoker-user-id'] = String(opts.invokerUserId);
    }
    const res = await fetch(joinUrl(this.baseUrl, `/bot${path}`), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return null;
    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { response: data, status: res.status });
    return data;
  }

  getMe() {
    return this.api('GET', '/@me');
  }

  /**
   * Set bot presence and/or custom status text. Shown in the member list.
   * @param {Object} opts
   * @param {string} [opts.presence] - 'Online' | 'Idle' | 'Busy' | 'Invisible'
   * @param {string} [opts.text] - Custom status line (e.g. "PumpKit Bundler"); empty string clears
   * @returns {Promise<{ status: { presence, text } }>}
   */
  setStatus(opts = {}) {
    const body = {};
    if (opts.presence != null) body.presence = opts.presence;
    if (opts.text != null) body.text = opts.text;
    return this.api('PATCH', '/@me/status', Object.keys(body).length ? body : undefined);
  }

  /**
   * Update bot profile (avatar and/or banner). Pass attachment objects from your upload flow.
   * @param {Object} opts
   * @param {Object} [opts.avatar] - Attachment object (e.g. { _id, url, ... }) to set as avatar
   * @param {Object|null} [opts.banner] - Attachment object for banner, or null to remove
   * @returns {Promise<Object>} Updated public user
   */
  setProfile(opts = {}) {
    const body = {};
    if (opts.avatar !== undefined) body.avatar = opts.avatar;
    if (opts.banner !== undefined) body.profile = { banner: opts.banner };
    return this.api('PATCH', '/@me', Object.keys(body).length ? body : undefined);
  }

  getGateway() {
    return this.api('GET', '/gateway');
  }

  getChannel(channelId) {
    return this.api('GET', `/channels/${channelId}`);
  }

  /** List members in a server (bot must be in the server). */
  getServerMembers(serverId) {
    return this.api('GET', `/servers/${serverId}/members`);
  }

  /**
   * Remove a member by member document id (same as web UI kick).
   * Requires Kick Members (or Administrator) on the bot, unless `invokerUserId` is the server owner.
   */
  kickMember(serverId, memberId, opts = {}) {
    const payload = {};
    if (opts.invokerUserId != null && opts.invokerUserId !== '') {
      payload.invoker_user_id = String(opts.invokerUserId);
    }
    return this.api(
      'DELETE',
      `/servers/${serverId}/members/${encodeURIComponent(memberId)}`,
      Object.keys(payload).length ? payload : undefined,
      opts,
    );
  }

  /**
   * Ban a user id from the server.
   * Pass `invokerUserId` in body options when the command author is the server owner (same as kick).
   */
  banUser(serverId, userId, body = {}) {
    const { invokerUserId, ...rest } = body;
    const payload = { ...rest };
    if (invokerUserId != null && invokerUserId !== '') {
      payload.invoker_user_id = String(invokerUserId);
    }
    const opts = invokerUserId != null && invokerUserId !== '' ? { invokerUserId } : {};
    return this.api(
      'PUT',
      `/servers/${serverId}/bans/${encodeURIComponent(userId)}`,
      Object.keys(payload).length ? payload : undefined,
      opts,
    );
  }

  /** Unban a user id. `invokerUserId` is sent as a header when the body is empty. */
  unbanUser(serverId, userId, opts = {}) {
    return this.api('DELETE', `/servers/${serverId}/bans/${encodeURIComponent(userId)}`, undefined, opts);
  }

  fetchMessages(channelId, { limit = 50 } = {}) {
    return this.api('GET', `/channels/${channelId}/messages?limit=${Math.max(1, Math.min(100, Number(limit) || 50))}`);
  }

  sendMessage(channelId, content, extra = {}) {
    const payload = normalizeMessagePayload(content, extra);
    return this.api('POST', `/channels/${channelId}/messages`, payload);
  }

  sendEmbed(channelId, embed, extra = {}) {
    const payload = normalizeMessagePayload(extra?.content ?? '', extra);
    const existing = Array.isArray(payload.embeds) ? payload.embeds : [];
    payload.embeds = [...existing, embed?.toJSON ? embed.toJSON() : embed];
    return this.sendMessage(channelId, payload);
  }

  reply(message, content, extra = {}) {
    const targetId = typeof message === 'string' ? message : message?._id;
    const channelId = typeof message === 'object' ? message?.channel : extra?.channel;
    if (!targetId) throw new Error('reply target message id is required');
    if (!channelId) throw new Error('reply channel id is required');
    const payload = normalizeMessagePayload(content, extra);
    const replies = Array.isArray(payload.replies) ? payload.replies : [];
    payload.replies = [...new Set([...replies, targetId])];
    return this.sendMessage(channelId, payload);
  }

  editMessage(channelId, messageId, body) {
    const payload = normalizeMessagePayload(body && typeof body === 'object' ? body : { content: body });
    return this.api('PATCH', `/channels/${channelId}/messages/${messageId}`, payload);
  }

  deleteMessage(channelId, messageId) {
    return this.api('DELETE', `/channels/${channelId}/messages/${messageId}`);
  }

  addReaction(channelId, messageId, emoji) {
    return this.api('PUT', `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`);
  }

  removeReaction(channelId, messageId, emoji) {
    return this.api('DELETE', `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`);
  }

  onEvent(eventName, handler) {
    this.on(eventName, handler);
    return () => this.off(eventName, handler);
  }

  onMessage(handler) {
    return this.onEvent(GatewayEvents.MESSAGE_CREATE, handler);
  }

  command(name, handler, options = {}) {
    const primary = normalizeCommandName(name, this.caseInsensitiveCommands);
    if (!primary) throw new Error('command name is required');
    const entry = {
      name: primary,
      originalName: String(name),
      description: options.description || '',
      usage: options.usage || '',
      aliases: Array.isArray(options.aliases) ? options.aliases : [],
      handler,
    };
    this._commands.set(primary, entry);
    for (const alias of entry.aliases) {
      const key = normalizeCommandName(alias, this.caseInsensitiveCommands);
      if (!key) continue;
      this._commandAliases.set(key, primary);
    }
    return this;
  }

  getCommands() {
    return [...this._commands.values()].map((c) => ({
      name: c.originalName,
      description: c.description,
      usage: c.usage,
      aliases: c.aliases,
    }));
  }

  startCommandRouter({ prefix, ignoreBotMessages, caseInsensitiveCommands } = {}) {
    if (typeof prefix === 'string') this.prefix = prefix;
    if (typeof ignoreBotMessages === 'boolean') this.ignoreBotMessages = ignoreBotMessages;
    if (typeof caseInsensitiveCommands === 'boolean') this.caseInsensitiveCommands = caseInsensitiveCommands;
    if (this._commandUnsub) return this._commandUnsub;

    const listener = async (message) => {
      try {
        if (!message || typeof message.content !== 'string' || !message.channel) return;
        if (this.ignoreBotMessages && message?.author?.bot) return;
        if (!this.prefix || !message.content.startsWith(this.prefix)) return;

        const body = message.content.slice(this.prefix.length).trim();
        if (!body) return;
        const [rawName, ...args] = body.split(/\s+/);
        const nameKey = normalizeCommandName(rawName, this.caseInsensitiveCommands);
        const commandKey = this._commands.has(nameKey) ? nameKey : this._commandAliases.get(nameKey);
        if (!commandKey) return;
        const cmd = this._commands.get(commandKey);
        if (!cmd || typeof cmd.handler !== 'function') return;

        const ctx = {
          client: this,
          message,
          args,
          rawArgs: body.slice(rawName.length).trim(),
          command: cmd.originalName,
          reply: (content, extra = {}) => this.reply(message, content, extra),
          send: (content, extra = {}) => this.sendMessage(message.channel, content, extra),
        };
        await cmd.handler(ctx);
      } catch (err) {
        this.emit('commandError', err);
      }
    };

    this.on(GatewayEvents.MESSAGE_CREATE, listener);
    this._commandUnsub = () => {
      this.off(GatewayEvents.MESSAGE_CREATE, listener);
      this._commandUnsub = null;
    };
    return this._commandUnsub;
  }

  stopCommandRouter() {
    if (this._commandUnsub) this._commandUnsub();
  }

  async connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    const wsBase = toWsBase(this.baseUrl);
    const url = `${joinUrl(wsBase, '/')}?bot_token=${encodeURIComponent(this.token)}&intents=${this.intents}`;
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.emit('open');
      this._hb = setInterval(() => {
        if (!this.ws || this.ws.readyState !== 1) return;
        this.ws.send(JSON.stringify({ type: 'Ping', data: Date.now() }));
      }, this.heartbeatMs);
    });

    this.ws.on('close', (code, reason) => {
      if (this._hb) clearInterval(this._hb);
      this._hb = null;
      this.emit('close', { code, reason: reason?.toString?.() || '' });
    });

    this.ws.on('error', (err) => this.emit('error', err));

    this.ws.on('message', (raw) => {
      let msg = null;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      this.emit('raw', msg);

      // Support both event shapes:
      // - { type, data } and { type, d }
      // - { t, d } (discord-like)
      const eventName = msg.type ?? msg.t;
      const eventData = msg.data ?? msg.d;
      if (eventName && eventData !== undefined) {
        this.emit(eventName, eventData);
      }
    });
  }

  disconnect() {
    this.stopCommandRouter();
    if (this._hb) clearInterval(this._hb);
    this._hb = null;
    if (this.ws) this.ws.close();
  }
}

export class EmbedBuilder {
  constructor(initial = {}) {
    this.embed = { ...initial };
    if (Array.isArray(initial.fields)) {
      this.embed.fields = [...initial.fields];
    }
  }

  setTitle(title) {
    this.embed.title = title == null ? undefined : String(title);
    return this;
  }

  setDescription(description) {
    this.embed.description = description == null ? undefined : String(description);
    return this;
  }

  setColor(color) {
    if (typeof color === 'string' && /^#?[0-9a-fA-F]{6}$/.test(color)) {
      const hex = color.startsWith('#') ? color.slice(1) : color;
      this.embed.color = parseInt(hex, 16);
    } else if (Number.isFinite(Number(color))) {
      this.embed.color = Number(color);
    }
    return this;
  }

  addField(name, value, inline = false) {
    if (!Array.isArray(this.embed.fields)) this.embed.fields = [];
    this.embed.fields.push({
      name: String(name ?? ''),
      value: String(value ?? ''),
      inline: !!inline,
    });
    return this;
  }

  setThumbnail(url) {
    this.embed.thumbnail = { url: String(url || '') };
    return this;
  }

  setImage(url) {
    this.embed.image = { url: String(url || '') };
    return this;
  }

  setFooter(text) {
    this.embed.footer = { text: String(text || '') };
    return this;
  }

  setTimestamp(ts = new Date()) {
    const d = ts instanceof Date ? ts : new Date(ts);
    if (!Number.isNaN(d.getTime())) this.embed.timestamp = d.toISOString();
    return this;
  }

  toJSON() {
    return { ...this.embed };
  }
}

export default StoatBotClient;
