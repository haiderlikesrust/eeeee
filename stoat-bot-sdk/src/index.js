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
  INTERACTION_CREATE: 'INTERACTION_CREATE',
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

  getUser(userId) {
    return this.api('GET', `/users/${encodeURIComponent(userId)}`);
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

  getServer(serverId) {
    return this.api('GET', `/servers/${encodeURIComponent(serverId)}`);
  }

  getServerChannels(serverId) {
    return this.api('GET', `/servers/${encodeURIComponent(serverId)}/channels`);
  }

  getServerRoles(serverId) {
    return this.api('GET', `/servers/${encodeURIComponent(serverId)}/roles`);
  }

  getServerPermissions(serverId) {
    return this.api('GET', `/servers/${encodeURIComponent(serverId)}/permissions`);
  }

  /** List members in a server (bot must be in the server). */
  getServerMembers(serverId) {
    return this.api('GET', `/servers/${serverId}/members`);
  }

  getServerMember(serverId, memberId) {
    return this.api('GET', `/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(memberId)}`);
  }

  /**
   * Edit member nickname and/or roles.
   * Body: { nickname?: string|null, roles?: string[] }
   */
  editServerMember(serverId, memberId, body = {}, opts = {}) {
    const payload = { ...body };
    if (opts.invokerUserId != null && opts.invokerUserId !== '') {
      payload.invoker_user_id = String(opts.invokerUserId);
    }
    return this.api('PATCH', `/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(memberId)}`, payload, opts);
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

  listServerBans(serverId, opts = {}) {
    return this.api('GET', `/servers/${encodeURIComponent(serverId)}/bans`, undefined, opts);
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

  /**
   * Send an interaction callback for INTERACTION_CREATE payloads.
   * Body shape: { type: 4|5|6|7|9, data?: { ... } }
   */
  createInteractionResponse(interactionId, interactionToken, body = {}) {
    return this.api(
      'POST',
      `/interactions/${encodeURIComponent(interactionId)}/${encodeURIComponent(interactionToken)}/callback`,
      body,
    );
  }

  /**
   * Convenience helper for deferred replies.
   * Set { ephemeral: true } to defer as ephemeral.
   */
  deferInteraction(interactionId, interactionToken, { ephemeral = false } = {}) {
    return this.createInteractionResponse(interactionId, interactionToken, {
      type: 5,
      data: ephemeral ? { flags: 64 } : {},
    });
  }

  /**
   * Send additional follow-up messages for an interaction.
   * Body can be { content, embeds, components, flags }.
   */
  createInteractionFollowup(interactionId, interactionToken, body = {}) {
    return this.api(
      'POST',
      `/interactions/${encodeURIComponent(interactionId)}/${encodeURIComponent(interactionToken)}/followups`,
      body,
    );
  }

  /**
   * Edit the original interaction response.
   * If the interaction was deferred and no original exists yet, this creates it.
   */
  editInteractionOriginal(interactionId, interactionToken, body = {}) {
    return this.api(
      'PATCH',
      `/interactions/${encodeURIComponent(interactionId)}/${encodeURIComponent(interactionToken)}/original`,
      body,
    );
  }

  onEvent(eventName, handler) {
    this.on(eventName, handler);
    return () => this.off(eventName, handler);
  }

  onMessage(handler) {
    return this.onEvent(GatewayEvents.MESSAGE_CREATE, handler);
  }

  onInteraction(handler) {
    return this.onEvent(GatewayEvents.INTERACTION_CREATE, handler);
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

export const ButtonStyle = {
  PRIMARY: 'primary',
  SECONDARY: 'secondary',
  SUCCESS: 'success',
  DANGER: 'danger',
  LINK: 'link',
};

export class ButtonBuilder {
  constructor(initial = {}) {
    this.button = { type: 'button', ...initial };
  }

  setCustomId(customId) {
    this.button.custom_id = customId == null ? undefined : String(customId).slice(0, 100);
    return this;
  }

  setLabel(label) {
    this.button.label = label == null ? undefined : String(label).slice(0, 80);
    return this;
  }

  setStyle(style) {
    this.button.style = style == null ? undefined : String(style).toLowerCase();
    return this;
  }

  setUrl(url) {
    this.button.url = url == null ? undefined : String(url).slice(0, 512);
    return this;
  }

  setDisabled(disabled = true) {
    this.button.disabled = !!disabled;
    return this;
  }

  toJSON() {
    return { ...this.button };
  }
}

export class SelectMenuBuilder {
  constructor(initial = {}) {
    this.menu = { type: 'select', options: [], ...initial };
    if (!Array.isArray(this.menu.options)) this.menu.options = [];
  }

  setCustomId(customId) {
    this.menu.custom_id = customId == null ? undefined : String(customId).slice(0, 100);
    return this;
  }

  setPlaceholder(placeholder) {
    this.menu.placeholder = placeholder == null ? undefined : String(placeholder).slice(0, 100);
    return this;
  }

  setMinValues(minValues) {
    this.menu.min_values = Math.max(0, Number(minValues) || 0);
    return this;
  }

  setMaxValues(maxValues) {
    this.menu.max_values = Math.max(1, Number(maxValues) || 1);
    return this;
  }

  setDisabled(disabled = true) {
    this.menu.disabled = !!disabled;
    return this;
  }

  addOptions(...options) {
    const flat = options.flat();
    for (const opt of flat) {
      if (!opt) continue;
      const o = opt?.toJSON ? opt.toJSON() : opt;
      this.menu.options.push({
        label: String(o.label || '').slice(0, 100),
        value: String(o.value || '').slice(0, 100),
        description: o.description == null ? undefined : String(o.description).slice(0, 100),
        default: !!o.default,
      });
    }
    return this;
  }

  toJSON() {
    return {
      ...this.menu,
      options: Array.isArray(this.menu.options) ? [...this.menu.options] : [],
    };
  }
}

export const TextInputStyle = {
  SHORT: 'short',
  PARAGRAPH: 'paragraph',
};

export class TextInputBuilder {
  constructor(initial = {}) {
    this.input = { type: 'text_input', style: TextInputStyle.SHORT, ...initial };
  }

  setCustomId(customId) {
    this.input.custom_id = customId == null ? undefined : String(customId).slice(0, 100);
    return this;
  }

  setLabel(label) {
    this.input.label = label == null ? undefined : String(label).slice(0, 45);
    return this;
  }

  setStyle(style) {
    const s = String(style || '').toLowerCase();
    this.input.style = s === TextInputStyle.PARAGRAPH ? TextInputStyle.PARAGRAPH : TextInputStyle.SHORT;
    return this;
  }

  setPlaceholder(placeholder) {
    this.input.placeholder = placeholder == null ? undefined : String(placeholder).slice(0, 100);
    return this;
  }

  setMinLength(minLength) {
    this.input.min_length = Math.max(0, Number(minLength) || 0);
    return this;
  }

  setMaxLength(maxLength) {
    this.input.max_length = Math.max(1, Number(maxLength) || 1);
    return this;
  }

  setRequired(required = true) {
    this.input.required = !!required;
    return this;
  }

  setValue(value) {
    this.input.value = value == null ? undefined : String(value).slice(0, 4000);
    return this;
  }

  toJSON() {
    return { ...this.input };
  }
}

export class ModalBuilder {
  constructor(initial = {}) {
    this.modal = {
      custom_id: initial.custom_id || initial.customId || undefined,
      title: initial.title || undefined,
      components: Array.isArray(initial.components) ? [...initial.components] : [],
    };
  }

  setCustomId(customId) {
    this.modal.custom_id = customId == null ? undefined : String(customId).slice(0, 100);
    return this;
  }

  setTitle(title) {
    this.modal.title = title == null ? undefined : String(title).slice(0, 45);
    return this;
  }

  addComponents(...rows) {
    const flat = rows.flat();
    for (const r of flat) {
      if (!r) continue;
      this.modal.components.push(r?.toJSON ? r.toJSON() : r);
    }
    return this;
  }

  toJSON() {
    return {
      custom_id: this.modal.custom_id,
      title: this.modal.title,
      components: Array.isArray(this.modal.components) ? [...this.modal.components] : [],
    };
  }
}

export class ActionRowBuilder {
  constructor(initial = {}) {
    this.row = {
      type: 'action_row',
      components: Array.isArray(initial.components) ? [...initial.components] : [],
    };
  }

  addComponents(...components) {
    const flat = components.flat();
    for (const c of flat) {
      if (!c) continue;
      this.row.components.push(c?.toJSON ? c.toJSON() : c);
    }
    return this;
  }

  toJSON() {
    return {
      type: 'action_row',
      components: Array.isArray(this.row.components) ? [...this.row.components] : [],
    };
  }
}

export default StoatBotClient;
