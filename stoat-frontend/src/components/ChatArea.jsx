import { useState, useEffect, useRef, useCallback } from 'react';
import { get, post, patch, del, put, uploadFile } from '../api';
import { useAuth } from '../context/AuthContext';
import { useWS } from '../context/WebSocketContext';
import { useMobile } from '../context/MobileContext';
import { useUnread } from '../context/UnreadContext';
import { useNotifications } from '../context/NotificationContext';
import { useOfeed } from '../context/OfeedContext';
import { resolveFileUrl } from '../utils/avatarUrl';
import { Permissions, hasPermission, ALL_PERMISSIONS } from '../utils/permissions';
import { searchEmojis, ALL_EMOJIS } from '../utils/emojiData';
import EmojiPicker from './EmojiPicker';
import GiphyPicker from './GiphyPicker';
import ProfileCard from './ProfileCard';
import Lightbox from './Lightbox';
import FormattingToolbar from './FormattingToolbar';
import ThreadPanel from './ThreadPanel';
import ServerOwnerCrown from './ServerOwnerCrown';
import { showServerOwnerCrownForUser } from '../utils/serverOwnerCrownDisplay';
import OfeedShareLinkCard from './OfeedShareLinkCard';
import { parseOfeedShareUrl, shouldHideOfeedUrlInMessage } from '../utils/ofeedShareUrl';
import { isBotUser, isVerifiedBotUser } from '../utils/botDisplay';
import { userHasOpicStaff } from '../utils/opicStaff';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import VoiceRecordingBar from './VoiceRecordingBar';
import VoiceMessageAttachment from './VoiceMessageAttachment';
import { isVoiceAttachment, withVoiceMetadata, extensionForVoiceMime } from '../utils/voiceMessage';
import './VoiceMessages.css';
import './ChatArea.css';

/** Same tokenization as renderMessageContent (URLs, mentions, emoji). */
const MESSAGE_PART_SPLIT = /(<:[a-zA-Z0-9_]+:[a-zA-Z0-9]+>|:[a-zA-Z0-9_]+:|<@&[a-zA-Z0-9]+>|<@[a-zA-Z0-9]+>|@everyone|@[a-zA-Z0-9_. -]+(?=[^a-zA-Z0-9_. -]|$)|https?:\/\/\S+)/g;

/** Sort key for message ordering (oldest → newest in list). */
function messageSortTime(m) {
  if (m?.created_at) {
    const t = new Date(m.created_at).getTime();
    if (!Number.isNaN(t)) return t;
  }
  const id = String(m?._id || '');
  if (id.startsWith('__opt__')) return Date.now();
  if (id.length >= 8) {
    const t = parseInt(id.slice(0, 8), 16) * 1000;
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

/**
 * Merge full server message list from fetch/poll with any optimistic rows not yet on the server.
 * Use only when `serverMessages` is the complete list (e.g. GET /messages), not a single new event.
 */
function mergeMessagesWithPendingOptimistic(prev, serverMessages) {
  const server = Array.isArray(serverMessages) ? serverMessages : [];
  const serverIds = new Set(server.map((m) => m._id));
  const pending = (prev || []).filter((m) => m._optimistic && !serverIds.has(m._id));
  if (pending.length === 0) return server;
  const combined = [...server, ...pending];
  combined.sort((a, b) => messageSortTime(a) - messageSortTime(b));
  return combined;
}

function isEmojiOnly(content) {
  if (!content) return false;
  const unicodeEmojiRegex = /(?:\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*)/gu;
  const stripped = content
    .replace(/<:[a-zA-Z0-9_]+:[a-zA-Z0-9]+>/g, '\u200b')
    .replace(/:[a-zA-Z0-9_]+:/g, '\u200b')
    .replace(unicodeEmojiRegex, '\u200b')
    .replace(/[\s\u200b]/g, '');
  if (stripped.length > 0) return false;
  const emojiCount = (content.match(/<:[a-zA-Z0-9_]+:[a-zA-Z0-9]+>/g) || []).length
    + (content.match(/:[a-zA-Z0-9_]+:/g) || []).length
    + (content.match(unicodeEmojiRegex) || []).length;
  return emojiCount > 0 && emojiCount <= 27;
}

function renderMessageEmbeds(embeds) {
  if (!Array.isArray(embeds) || embeds.length === 0) return null;
  return (
    <div className="msg-embeds">
      {embeds.map((embed, i) => {
        if (!embed || typeof embed !== 'object') return null;
        const color = Number.isFinite(embed.color)
          ? `#${Math.max(0, Math.min(0xffffff, Number(embed.color))).toString(16).padStart(6, '0')}`
          : null;
        const fields = Array.isArray(embed.fields) ? embed.fields : [];
        const thumb = embed.thumbnail?.url;
        const image = embed.image?.url;
        const footerText = embed.footer?.text;
        const ts = embed.timestamp ? new Date(embed.timestamp) : null;
        const tsText = ts && !Number.isNaN(ts.getTime()) ? ts.toLocaleString() : '';
        return (
          <div key={i} className="msg-embed" style={color ? { borderLeftColor: color } : {}}>
            {embed.title && <div className="msg-embed-title">{renderMarkdownInline(String(embed.title))}</div>}
            {embed.description && <div className="msg-embed-description">{renderMarkdownInline(String(embed.description))}</div>}
            {fields.length > 0 && (
              <div className="msg-embed-fields">
                {fields.map((f, fi) => (
                  <div key={fi} className={`msg-embed-field ${f?.inline ? 'inline' : ''}`}>
                    {f?.name && <div className="msg-embed-field-name">{renderMarkdownInline(String(f.name))}</div>}
                    {f?.value && <div className="msg-embed-field-value">{renderMarkdownInline(String(f.value))}</div>}
                  </div>
                ))}
              </div>
            )}
            {thumb && <img src={thumb} alt="" className="msg-embed-thumb" />}
            {image && <img src={image} alt="" className="msg-embed-image" />}
            {(footerText || tsText) && (
              <div className="msg-embed-footer">
                {footerText && <span>{String(footerText)}</span>}
                {footerText && tsText && <span>•</span>}
                {tsText && <span>{tsText}</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function isDirectMediaUrl(url) {
  if (!url) return false;
  return /\.(gif|png|jpg|jpeg|webp)(\?.*)?$/i.test(url)
    || /(?:media\d*|i)\.giphy\.com/i.test(url)
    || /media\.tenor\.com/i.test(url);
}

function hasVisibleMessageText(content, linkPreviews) {
  if (!content) return false;
  const parts = content.split(MESSAGE_PART_SPLIT);
  for (const part of parts) {
    if (!part) continue;
    if (/^https?:\/\/\S+$/i.test(part)) {
      if (isDirectMediaUrl(part)) return true;
      if (!shouldHideOfeedUrlInMessage(part, linkPreviews)) return true;
      continue;
    }
    if (part.trim()) return true;
  }
  return false;
}

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function renderLinkPreviews(linkPreviews) {
  if (!Array.isArray(linkPreviews) || linkPreviews.length === 0) return null;
  const visiblePreviews = linkPreviews.filter((preview) => preview?.url && !isDirectMediaUrl(preview.url));
  if (visiblePreviews.length === 0) return null;
  return (
    <div className="msg-link-previews">
      {visiblePreviews.map((preview, i) => {
        if (!preview?.url) return null;
        if (parseOfeedShareUrl(preview.url)) {
          return <OfeedShareLinkCard key={`ofeed-${preview.url}-${i}`} url={preview.url} />;
        }
        const { url, title, description, image, site_name } = preview;
        return (
          <a
            key={i}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="msg-link-preview"
          >
            {image && <img src={image} alt="" className="msg-link-preview-image" />}
            <div className="msg-link-preview-body">
              {site_name && <span className="msg-link-preview-site">{decodeHtml(site_name)}</span>}
              {title && <span className="msg-link-preview-title">{decodeHtml(title)}</span>}
              {description && <span className="msg-link-preview-desc">{decodeHtml(description)}</span>}
            </div>
          </a>
        );
      })}
    </div>
  );
}

function renderMarkdownInline(text) {
  const raw = String(text ?? '');
  const parts = raw.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\*[^*\n]+\*)/g);
  return parts.map((part, i) => {
    const code = part.match(/^`([^`\n]+)`$/);
    if (code) return <code key={i} className="msg-inline-code">{code[1]}</code>;

    const bold = part.match(/^\*\*([^*\n]+)\*\*$/);
    if (bold) return <strong key={i}>{bold[1]}</strong>;

    const strike = part.match(/^~~([^~\n]+)~~$/);
    if (strike) return <s key={i}>{strike[1]}</s>;

    const italic = part.match(/^\*([^*\n]+)\*$/);
    if (italic) return <em key={i}>{italic[1]}</em>;

    return <span key={i}>{part}</span>;
  });
}


function renderMessageContent(content, customEmojiMap, user, mentionDirectory, onMentionClick, roleDirectory, setLightboxSrc, linkPreviews) {
  if (!content) return null;
  const jumbo = isEmojiOnly(content);
  const cls = jumbo ? 'emoji-jumbo' : '';
  const parts = content.split(MESSAGE_PART_SPLIT);
  const elements = parts.map((part, i) => {
    const customMatch = part.match(/^<:([a-zA-Z0-9_]+):([a-zA-Z0-9]+)>$/);
    if (customMatch) {
      const [, name, id] = customMatch;
      const url = customEmojiMap?.[id]?.url || `/attachments/${id}`;
      return <img key={i} src={url} alt={`:${name}:`} title={`:${name}:`} className={`inline-emoji custom-inline-emoji ${cls}`} />;
    }
    const shortcodeMatch = part.match(/^:([a-zA-Z0-9_]+):$/);
    if (shortcodeMatch) {
      const emojiDef = ALL_EMOJIS.find(e => e.n === shortcodeMatch[1]);
      if (emojiDef) return <span key={i} className={`inline-emoji ${cls}`} title={`:${emojiDef.n}:`}>{emojiDef.e}</span>;
      const custom = Object.values(customEmojiMap || {}).find(e => e.name === shortcodeMatch[1]);
      if (custom) return <img key={i} src={custom.url} alt={`:${custom.name}:`} title={`:${custom.name}:`} className={`inline-emoji custom-inline-emoji ${cls}`} />;
    }
    if (/^https?:\/\/\S+$/i.test(part)) {
      if (isDirectMediaUrl(part)) {
        return <img key={i} src={part} alt="gif" className="inline-gif" onClick={() => setLightboxSrc?.(part)} />;
      }
      if (shouldHideOfeedUrlInMessage(part, linkPreviews)) {
        return null;
      }
      return (
        <a key={i} href={part} target="_blank" rel="noreferrer" className="msg-external-link">
          {part}
        </a>
      );
    }
    if (part === '@everyone') {
      return <span key={i} className="msg-mention role-mention everyone">@everyone</span>;
    }
    const roleIdMention = part.match(/^<@&([a-zA-Z0-9]+)>$/);
    if (roleIdMention) {
      const role = roleDirectory?.byId?.[roleIdMention[1]];
      if (!role) return <span key={i}>{part}</span>;
      const style = role.colour ? { color: role.colour, backgroundColor: `${role.colour}20` } : {};
      return <span key={i} className="msg-mention role-mention" style={style}>@{role.name}</span>;
    }
    const idMention = part.match(/^<@([a-zA-Z0-9]+)>$/);
    if (idMention) {
      const mentionMember = mentionDirectory?.byId?.[idMention[1]];
      if (!mentionMember) return <span key={i}>{part}</span>;
      const mentionName = mentionMember?.nickname || mentionMember?.user?.display_name || mentionMember?.user?.username || idMention[1];
      const meNames = [user?._id].filter(Boolean);
      const isMe = meNames.includes(idMention[1]);
      return (
        <button
          key={i}
          type="button"
          className={`msg-mention ${isMe ? 'self' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            onMentionClick?.(mentionMember, rect);
          }}
        >
          @{mentionName}
        </button>
      );
    }
    const mentionMatch = part.match(/^@([a-zA-Z0-9_. -]+)$/);
    if (mentionMatch) {
      const mentionName = mentionMatch[1].trim();
      const key = mentionName.toLowerCase();
      const mentionRole = roleDirectory?.byName?.[key];
      if (mentionRole) {
        const style = mentionRole.colour ? { color: mentionRole.colour, backgroundColor: `${mentionRole.colour}20` } : {};
        return <span key={i} className="msg-mention role-mention" style={style}>@{mentionRole.name}</span>;
      }
      const mentionMember = mentionDirectory?.byName?.[key];
      if (!mentionMember) return <span key={i}>{part}</span>;
      const meNames = [user?.username, user?.display_name].filter(Boolean).map((n) => String(n).toLowerCase());
      const isMe = meNames.includes(key);
      return (
        <button
          key={i}
          type="button"
          className={`msg-mention ${isMe ? 'self' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            onMentionClick?.(mentionMember, rect);
          }}
        >
          @{mentionName}
        </button>
      );
    }
    return <span key={i}>{renderMarkdownInline(part)}</span>;
  });
  return elements;
}

const TYPING_SEND_INTERVAL_MS = 2000;
const TYPING_STOP_DELAY_MS = 3000;

export default function ChatArea({ channelId, serverRoles, serverOwnerId, onChannelAccessLost }) {
  const { user } = useAuth();
  const { send, on } = useWS();
  const { isMobile, openChannelSidebar, openMemberSidebar } = useMobile();
  const { ackChannel } = useUnread();
  const { setActiveChannel } = useNotifications();
  const ofeed = useOfeed();

  useEffect(() => {
    setActiveChannel?.(channelId);
    return () => setActiveChannel?.(null);
  }, [channelId, setActiveChannel]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [channel, setChannel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editingMsg, setEditingMsg] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showPinned, setShowPinned] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(null);
  const [showInputEmoji, setShowInputEmoji] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  /** Loaded from GET /channels/:id/permissions; 0 until then (avoid assuming full access). DMs use ALL_PERMISSIONS after fetch. */
  const [perms, setPerms] = useState(0);
  const [customEmojis, setCustomEmojis] = useState({});
  const [mentionDirectory, setMentionDirectory] = useState({ byName: {}, byId: {} });
  const [roleDirectory, setRoleDirectory] = useState({ byName: {}, byId: {} });
  const [mentionCard, setMentionCard] = useState(null);
  const [autocomplete, setAutocomplete] = useState(null);
  const [acSelected, setAcSelected] = useState(0);
  const [typingUserIds, setTypingUserIds] = useState(new Set());
  const [replyingTo, setReplyingTo] = useState(null);
  const [slowmodeCooldown, setSlowmodeCooldown] = useState(0);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [openThread, setOpenThread] = useState(null);
  const bottomRef = useRef(null);
  const pollRef = useRef(null);
  /** Ignore HTTP results if user switched channel before the request finished. */
  const channelIdRef = useRef(channelId);
  channelIdRef.current = channelId;
  const onChannelAccessLostRef = useRef(onChannelAccessLost);
  onChannelAccessLostRef.current = onChannelAccessLost;
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const typingSendRef = useRef(null);
  const focusInputAfterSendRef = useRef(false);

  const voice = useVoiceRecorder();

  const canSend = hasPermission(perms, Permissions.SEND_MESSAGES);
  const canManageMessages = hasPermission(perms, Permissions.MANAGE_MESSAGES);
  const canAttach = hasPermission(perms, Permissions.ATTACH_FILES);
  const canReact = hasPermission(perms, Permissions.ADD_REACTIONS);
  const canSubmitMessage = (input.trim().length > 0 || pendingFiles.length > 0) && !uploading && slowmodeCooldown <= 0;

  useEffect(() => {
    const byName = {};
    const byId = {};
    if (serverRoles && typeof serverRoles === 'object') {
      for (const [id, role] of Object.entries(serverRoles)) {
        if (!role?.name) continue;
        byId[id] = { ...role, _id: id };
        byName[role.name.toLowerCase()] = { ...role, _id: id };
      }
    }
    setRoleDirectory({ byName, byId });
  }, [serverRoles]);

  const fetchMessages = useCallback(async (opts = {}) => {
    const skipPerms = opts.skipPerms === true;
    if (!channelId) return;
    const cid = channelId;
    let ch;
    let msgs;
    try {
      const results = await Promise.all([
        get(`/channels/${cid}`),
        get(`/channels/${cid}/messages?limit=50`).catch(() => []),
      ]);
      ch = results[0];
      msgs = results[1];
    } catch (err) {
      if (channelIdRef.current !== cid) return;
      if (err?.type === 'Forbidden') {
        setChannel(null);
        setPerms(0);
        setMessages([]);
        onChannelAccessLostRef.current?.();
      }
      setLoading(false);
      return;
    }
    if (channelIdRef.current !== cid) return;
    try {
      setChannel(ch);
      setMessages((prev) => mergeMessagesWithPendingOptimistic(prev, msgs));
      /** Until perms load, `perms === 0` reads as “no send” — only end loading after we know permissions (initial load). */
      if (!skipPerms) {
        if (ch.server) {
          try {
            const [p, emojis, members] = await Promise.all([
              get(`/channels/${cid}/permissions`).catch(() => ({})),
              get(`/servers/${ch.server}/emojis`).catch(() => []),
              get(`/servers/${ch.server}/members`).catch(() => []),
            ]);
            if (channelIdRef.current !== cid) return;
            setPerms(typeof p?.permissions === 'number' ? p.permissions : 0);
            const map = {};
            for (const e of (emojis || [])) map[e._id] = e;
            setCustomEmojis(map);
            const byName = {};
            const byId = {};
            for (const m of (members || [])) {
              const u = typeof m.user === 'object' ? m.user : null;
              if (!u) continue;
              byId[u._id] = m;
              const keys = [
                u.username,
                u.display_name,
                m.nickname,
              ].filter(Boolean).map((k) => String(k).toLowerCase());
              for (const k of keys) byName[k] = m;
            }
            setMentionDirectory({ byName, byId });
          } catch {
            if (channelIdRef.current !== cid) return;
            setPerms(0);
            setMentionDirectory({ byName: {}, byId: {} });
          }
        } else {
          if (channelIdRef.current !== cid) return;
          setPerms(ALL_PERMISSIONS);
          setMentionDirectory({ byName: {}, byId: {} });
        }
        if (channelIdRef.current !== cid) return;
        setLoading(false);
      }
    } catch {
      if (channelIdRef.current === cid) setLoading(false);
    }
  }, [channelId]);

  const fetchMessagesRef = useRef(fetchMessages);
  fetchMessagesRef.current = fetchMessages;

  useEffect(() => {
    if (!channelId) return;
    setLoading(true);
    setPerms(0);
    setMessages([]);
    setShowSearch(false);
    setShowPinned(false);
    setAutocomplete(null);
    setMentionCard(null);
    fetchMessagesRef.current();
    const pollIntervalMs = 10000;
    pollRef.current = setInterval(() => fetchMessagesRef.current({ skipPerms: true }), pollIntervalMs);
    return () => clearInterval(pollRef.current);
  }, [channelId]);

  useEffect(() => {
    if (channelId && !loading && ackChannel) ackChannel(channelId);
  }, [channelId, loading, ackChannel]);

  useEffect(() => {
    if (!channelId || !on) return;
    const unsubStart = on('TypingStart', (d) => {
      if (d?.channel_id === channelId && d?.user_id && d.user_id !== user?._id) {
        setTypingUserIds((prev) => new Set(prev).add(d.user_id));
      }
    });
    const unsubStop = on('TypingStop', (d) => {
      if (d?.channel_id === channelId && d?.user_id) {
        setTypingUserIds((prev) => {
          const next = new Set(prev);
          next.delete(d.user_id);
          return next;
        });
      }
    });
    return () => { unsubStart(); unsubStop(); };
  }, [channelId, user ? user._id : null, on]);

  useEffect(() => {
    if (!channelId || !on) return;
    const sameChan = (ch) => ch != null && String(ch) === String(channelId);

    const unsubCreate = on('MESSAGE_CREATE', (d) => {
      if (!d || !sameChan(d.channel)) return;
      setMessages((prev) => {
        if (prev.some((m) => m._id === d._id)) return prev;
        const authorId = typeof d.author === 'object' ? d.author?._id : d.author;
        const me = user?._id;
        let base = prev;
        if (authorId != null && me != null && String(authorId) === String(me)) {
          base = prev.filter((m) => !(m._optimistic && m.author && String(m.author._id) === String(me)));
        }
        // Do not use mergeMessagesWithPendingOptimistic here — that helper expects a *full* server
        // list; with a single message and no other pending rows it would replace the whole chat.
        const next = [...base, d];
        next.sort((a, b) => messageSortTime(a) - messageSortTime(b));
        return next;
      });
    });

    const unsubUpdate = on('MESSAGE_UPDATE', (d) => {
      if (!d || !sameChan(d.channel)) return;
      setMessages((prev) => prev.map((m) => (m._id === d._id ? { ...m, ...d } : m)));
    });

    const unsubDelete = on('MESSAGE_DELETE', (payload) => {
      const id = payload?._id ?? payload?.id;
      const ch = payload?.channel;
      if (!id || !sameChan(ch)) return;
      setMessages((prev) => prev.filter((m) => m._id !== id));
    });

    return () => {
      unsubCreate();
      unsubUpdate();
      unsubDelete();
    };
  }, [channelId, on, user?._id]);

  useEffect(() => {
    return () => { setTypingUserIds(new Set()); };
  }, [channelId]);

  useEffect(() => {
    return () => { if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current); if (typingSendRef.current) clearInterval(typingSendRef.current); };
  }, [channelId]);

  const sendTypingStop = useCallback(() => {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = null;
    if (typingSendRef.current) clearInterval(typingSendRef.current);
    typingSendRef.current = null;
    if (channelId && send) send({ type: 'TypingStop', channelId });
  }, [channelId, send]);

  const scheduleTyping = useCallback(() => {
    if (!channelId || !send) return;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(sendTypingStop, TYPING_STOP_DELAY_MS);
    if (!typingSendRef.current) {
      send({ type: 'TypingStart', channelId });
      typingSendRef.current = setInterval(() => send({ type: 'TypingStart', channelId }), TYPING_SEND_INTERVAL_MS);
    }
  }, [channelId, send, sendTypingStop]);

  useEffect(() => {
    if (!editingMsg && !showSearch && !showPinned) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, editingMsg, showSearch, showPinned]);

  // Slowmode cooldown countdown
  useEffect(() => {
    if (slowmodeCooldown <= 0) return;
    const timer = setInterval(() => {
      setSlowmodeCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [slowmodeCooldown > 0]);

  // Refocus message input after send (delayed so it runs after re-render, scroll, and layout)
  useEffect(() => {
    if (!uploading && focusInputAfterSendRef.current) {
      focusInputAfterSendRef.current = false;
      const id = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(id);
    }
  }, [uploading]);

  // Autocomplete logic (emoji :query and @mention)
  useEffect(() => {
    // Check for @mention autocomplete (query runs until whitespace; match display name / username / nickname by prefix)
    const atIdx = input.lastIndexOf('@');
    if (atIdx >= 0) {
      const beforeAt = input[atIdx - 1];
      if (atIdx === 0 || beforeAt === ' ' || beforeAt === undefined) {
        const tail = input.slice(atIdx + 1);
        const spaceIdx = tail.search(/[\s\n]/);
        const rawQuery = spaceIdx === -1 ? tail : tail.slice(0, spaceIdx);
        if (!/\n/.test(rawQuery)) {
          const query = rawQuery.toLowerCase();
          const replaceEnd = atIdx + 1 + rawQuery.length;
          const items = [];
          if (query.length === 0 || 'everyone'.startsWith(query)) {
            items.push({ type: 'everyone', name: 'everyone', label: '@everyone — Notify all members' });
          }
          const roleMatches = [];
          for (const [id, role] of Object.entries(roleDirectory?.byId || {})) {
            if (!role?.name) continue;
            const rn = role.name.toLowerCase();
            if (query.length === 0 || rn.startsWith(query)) {
              roleMatches.push({ type: 'role', id, name: role.name, colour: role.colour || null, sortKey: rn });
            }
          }
          roleMatches.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
          items.push(...roleMatches.map(({ sortKey: _sk, ...r }) => r));

          const userItems = [];
          for (const m of Object.values(mentionDirectory?.byId || {})) {
            const u = typeof m.user === 'object' ? m.user : null;
            if (!u) continue;
            const nick = (m.nickname || '').toLowerCase();
            const displayName = (u.display_name || '').toLowerCase();
            const username = (u.username || '').toLowerCase();
            const label = m.nickname || u.display_name || u.username || '';
            const sortKey = (label || u.username || '').toLowerCase();
            const matches =
              query.length === 0
              || nick.startsWith(query)
              || displayName.startsWith(query)
              || username.startsWith(query);
            if (!matches) continue;
            if (!userItems.find((it) => it.id === u._id)) {
              userItems.push({
                type: 'user',
                id: u._id,
                name: label || '?',
                username: u.username || '',
                avatar: u.avatar,
                sortKey,
              });
            }
          }
          userItems.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

          if (channel?.channel_type === 'DirectMessage' && channel?.other_user) {
            const ou = channel.other_user;
            const un = (ou.username || '').toLowerCase();
            const dn = (ou.display_name || ou.username || '').toLowerCase();
            const matches = query.length === 0 || dn.startsWith(query) || un.startsWith(query);
            if (matches && !userItems.find((it) => it.id === ou._id)) {
              userItems.push({
                type: 'user',
                id: ou._id,
                name: ou.display_name || ou.username || '?',
                username: ou.username || '',
                avatar: ou.avatar,
                sortKey: (ou.display_name || ou.username || '').toLowerCase(),
              });
              userItems.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
            }
          }

          items.push(...userItems.map(({ sortKey: _sk, ...u }) => u));

          const MENTION_LIST_CAP = 50;
          const limited = items.slice(0, MENTION_LIST_CAP);
          if (limited.length > 0) {
            setAutocomplete({
              items: limited,
              colonIdx: atIdx,
              mode: 'mention',
              replaceEnd,
            });
            setAcSelected(0);
            return;
          }
        }
      }
    }
    // Check for :emoji autocomplete
    const colonIdx = input.lastIndexOf(':');
    if (colonIdx >= 0 && colonIdx < input.length - 1) {
      const beforeColon = input[colonIdx - 1];
      if (colonIdx === 0 || beforeColon === ' ' || beforeColon === undefined) {
        const query = input.slice(colonIdx + 1);
        if (query.length >= 1 && !/\s/.test(query)) {
          const unicodeResults = searchEmojis(query, 8);
          const customResults = Object.values(customEmojis)
            .filter(e => e.name.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 5);
          const combined = [
            ...unicodeResults.map(e => ({ type: 'unicode', ...e })),
            ...customResults.map(e => ({ type: 'custom', id: e._id, name: e.name, url: e.url })),
          ];
          if (combined.length > 0) {
            setAutocomplete({ items: combined, colonIdx, mode: 'emoji' });
            setAcSelected(0);
            return;
          }
        }
      }
    }
    setAutocomplete(null);
  }, [input, customEmojis, mentionDirectory, roleDirectory, channel]);

  const applyAutocomplete = (item) => {
    if (!autocomplete) return;
    const before = input.slice(0, autocomplete.colonIdx);
    let insert;
    if (item.type === 'unicode') {
      insert = item.e;
    } else if (item.type === 'custom') {
      insert = `<:${item.name}:${item.id}>`;
    } else if (item.type === 'role') {
      insert = `<@&${item.id}>`;
    } else if (item.type === 'user') {
      insert = `<@${item.id}>`;
    } else if (item.type === 'everyone') {
      insert = '@everyone';
    } else {
      insert = item.name || '';
    }
    if (autocomplete.mode === 'mention' && autocomplete.replaceEnd != null) {
      const after = input.slice(autocomplete.replaceEnd);
      const gap = after.length > 0 && !/^\s/.test(after) ? ' ' : '';
      setInput(before + insert + gap + after);
    } else {
      setInput(before + insert + ' ');
    }
    setAutocomplete(null);
    inputRef.current?.focus();
  };

  const startReply = (msg) => {
    const authorName = typeof msg.author === 'object' ? (msg.author.display_name || msg.author.username) : 'Unknown';
    setReplyingTo({ _id: msg._id, author: authorName, content: msg.content });
    setContextMenu(null);
    inputRef.current?.focus();
  };
  const cancelReply = () => setReplyingTo(null);

  const sendVoiceMessage = async () => {
    const blob = await voice.stop();
    if (!blob || blob.size < 32) return;
    sendTypingStop();
    const mime = blob.type || 'audio/webm';
    const ext = extensionForVoiceMime(mime);
    const file = new File([blob], `voice-message.${ext}`, { type: mime || `audio/${ext}` });
    const replySnap = replyingTo ? { ...replyingTo } : null;
    let optimisticId = null;
    setUploading(true);
    try {
      const att = withVoiceMetadata(await uploadFile(file), file);
      const body = { content: '', attachments: [att] };
      if (replySnap) body.replies = [replySnap._id];
      optimisticId = `__opt__${crypto.randomUUID()}`;
      const optimisticMsg = {
        _id: optimisticId,
        channel: channelId,
        author: user,
        content: '',
        attachments: [att],
        created_at: new Date().toISOString(),
        replies: replySnap ? [replySnap._id] : [],
        reply_context: replySnap
          ? [{
            _id: replySnap._id,
            author: { display_name: replySnap.author, username: replySnap.author },
            content: replySnap.content,
          }]
          : [],
        _optimistic: true,
      };
      setMessages((prev) => [...prev, optimisticMsg]);
      setReplyingTo(null);
      setUploading(false);
      const msg = await post(`/channels/${channelId}/messages`, body);
      setMessages((prev) => {
        if (prev.some((m) => m._id === msg._id)) {
          return prev.filter((m) => m._id !== optimisticId);
        }
        if (prev.some((m) => m._id === optimisticId)) {
          return prev.map((m) => (m._id === optimisticId ? msg : m));
        }
        return [...prev, msg];
      });
      if (channel?.slowmode > 0) setSlowmodeCooldown(channel.slowmode);
    } catch (err) {
      if (optimisticId) {
        setMessages((prev) => prev.filter((m) => m._id !== optimisticId));
      }
      if (err?.retry_after) setSlowmodeCooldown(err.retry_after);
      if (replySnap) setReplyingTo(replySnap);
    }
    focusInputAfterSendRef.current = true;
    setUploading(false);
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim() && pendingFiles.length === 0) return;
    sendTypingStop();
    const contentSnapshot = input || '';
    const filesSnapshot = [...pendingFiles];
    const replySnap = replyingTo ? { ...replyingTo } : null;
    let optimisticId = null;

    setUploading(true);
    try {
      const attachments = [];
      for (const file of filesSnapshot) {
        attachments.push(withVoiceMetadata(await uploadFile(file), file));
      }
      const body = { content: contentSnapshot };
      if (attachments.length > 0) body.attachments = attachments;
      if (replySnap) body.replies = [replySnap._id];

      optimisticId = `__opt__${crypto.randomUUID()}`;
      const optimisticMsg = {
        _id: optimisticId,
        channel: channelId,
        author: user,
        content: contentSnapshot,
        attachments,
        created_at: new Date().toISOString(),
        replies: replySnap ? [replySnap._id] : [],
        reply_context: replySnap
          ? [{
            _id: replySnap._id,
            author: { display_name: replySnap.author, username: replySnap.author },
            content: replySnap.content,
          }]
          : [],
        _optimistic: true,
      };
      setMessages((prev) => [...prev, optimisticMsg]);
      setInput('');
      setPendingFiles([]);
      setReplyingTo(null);
      setUploading(false);

      const msg = await post(`/channels/${channelId}/messages`, body);
      setMessages((prev) => {
        if (prev.some((m) => m._id === msg._id)) {
          return prev.filter((m) => m._id !== optimisticId);
        }
        if (prev.some((m) => m._id === optimisticId)) {
          return prev.map((m) => (m._id === optimisticId ? msg : m));
        }
        return [...prev, msg];
      });
      if (channel?.slowmode > 0) setSlowmodeCooldown(channel.slowmode);
    } catch (err) {
      if (optimisticId) {
        setMessages((prev) => prev.filter((m) => m._id !== optimisticId));
      }
      if (err?.retry_after) setSlowmodeCooldown(err.retry_after);
      setInput(contentSnapshot);
      if (filesSnapshot.length > 0) setPendingFiles(filesSnapshot);
      if (replySnap) setReplyingTo(replySnap);
    }
    focusInputAfterSendRef.current = true;
    setUploading(false);
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) setPendingFiles((prev) => [...prev, ...files]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      setPendingFiles((prev) => [...prev, ...files]);
    }
  };

  const deleteMessage = async (msgId) => {
    try { await del(`/channels/${channelId}/messages/${msgId}`); setMessages((prev) => prev.filter((m) => m._id !== msgId)); } catch {}
    setContextMenu(null);
  };

  const startEdit = (msg) => { setEditingMsg(msg._id); setEditContent(msg.content); setContextMenu(null); };
  const saveEdit = async () => {
    if (!editingMsg || !editContent.trim()) return;
    try {
      const updated = await patch(`/channels/${channelId}/messages/${editingMsg}`, { content: editContent });
      setMessages((prev) => prev.map((m) => m._id === editingMsg ? { ...m, ...updated } : m));
    } catch {}
    setEditingMsg(null); setEditContent('');
  };
  const cancelEdit = () => { setEditingMsg(null); setEditContent(''); };

  const pinMessage = async (msgId) => {
    try {
      await post(`/channels/${channelId}/messages/${msgId}/pin`);
      await fetchMessages();
      if (showPinned) await loadPinned();
    } catch {}
    setContextMenu(null);
  };
  const unpinMessage = async (msgId) => {
    try {
      await del(`/channels/${channelId}/messages/${msgId}/pin`);
      await fetchMessages();
      if (showPinned) await loadPinned();
    } catch {}
    setContextMenu(null);
  };

  const addReaction = async (msgId, emoji) => {
    try { await put(`/channels/${channelId}/messages/${msgId}/reactions/${encodeURIComponent(emoji)}`); fetchMessages(); } catch {}
    setShowEmojiPicker(null); setContextMenu(null);
  };
  const removeReaction = async (msgId, emoji) => {
    try { await del(`/channels/${channelId}/messages/${msgId}/reactions/${encodeURIComponent(emoji)}`); fetchMessages(); } catch {}
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try { const res = await post(`/channels/${channelId}/search`, { query: searchQuery }); setSearchResults(res?.messages || res || []); } catch {}
    setSearching(false);
  };

  const loadPinned = async () => { try { const msgs = await get(`/channels/${channelId}/messages?pinned=true`); setPinnedMessages(msgs || []); } catch { setPinnedMessages([]); } };

  const handleContextMenu = (e, msg) => {
    e.preventDefault();
    if (msg._optimistic) return;
    const authorId = typeof msg.author === 'object' ? msg.author?._id : msg.author;
    setContextMenu({ x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 250), msg, isOwn: authorId === user?._id });
  };

  const formatTime = (msg) => {
    const date = msg.created_at ? new Date(msg.created_at) : new Date(parseInt(msg._id.substring(0, 8), 16) * 1000);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return isToday ? `Today at ${time}` : `${date.toLocaleDateString()} ${time}`;
  };

  const getAuthorName = (msg) => {
    if (typeof msg.author === 'object' && msg.author) return msg.author.display_name || msg.author.username || 'Unknown';
    if (msg.author === user?._id) return user.display_name || user.username;
    return 'Unknown';
  };
  const getAuthorInitial = (msg) => (getAuthorName(msg)[0]?.toUpperCase() || '?');
  const getAuthorAvatarUrl = (msg) => {
    if (typeof msg.author === 'object' && msg.author?.avatar) return resolveFileUrl(msg.author.avatar);
    if (msg.author === user?._id && user?.avatar) return resolveFileUrl(user.avatar);
    return null;
  };
  const isMessageAuthorBot = (msg) => {
    if (typeof msg.author === 'object' && msg.author) return isBotUser(msg.author);
    return false;
  };
  const messageAuthorVerifiedBot = (msg) => {
    if (typeof msg.author === 'object' && msg.author) return isVerifiedBotUser(msg.author);
    return false;
  };
  const messageAuthorStaff = (msg) => {
    if (typeof msg.author === 'object' && msg.author) return userHasOpicStaff(msg.author);
    return false;
  };

  const getMessageAuthorId = (msg) => {
    if (typeof msg.author === 'object' && msg.author) return msg.author._id;
    return msg.author;
  };

  const shouldShowHeader = (msg, idx) => {
    if (idx === 0) return true;
    if (msg.reply_context && msg.reply_context.length > 0) return true;
    const prev = messages[idx - 1];
    const prevAuthor = typeof prev.author === 'object' ? prev.author?._id : prev.author;
    const curAuthor = typeof msg.author === 'object' ? msg.author?._id : msg.author;
    if (prevAuthor !== curAuthor) return true;
    const prevTime = prev.created_at ? new Date(prev.created_at) : null;
    const curTime = msg.created_at ? new Date(msg.created_at) : null;
    if (prevTime && curTime && (curTime - prevTime) > 5 * 60 * 1000) return true;
    return false;
  };

  const renderReplyContext = (msg) => {
    if (!msg.reply_context || msg.reply_context.length === 0) return null;
    return msg.reply_context.map((rc, i) => {
      const rcAuthor = typeof rc.author === 'object' ? (rc.author.display_name || rc.author.username) : 'Unknown';
      const rcAvatarUrl = typeof rc.author === 'object' && rc.author?.avatar ? resolveFileUrl(rc.author.avatar) : null;
      return (
        <div key={i} className="msg-reply-context" onClick={() => {
          const el = document.getElementById(`msg-${rc._id}`);
          if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('msg-highlight'); setTimeout(() => el.classList.remove('msg-highlight'), 1500); }
        }}>
          <svg className="msg-reply-spine" width="33" height="16" viewBox="0 0 33 16"><path d="M0 16 C0 8, 8 0, 16 0 L33 0" fill="none" stroke="var(--text-muted)" strokeWidth="2"/></svg>
          <span className="msg-reply-avatar">
            {rcAvatarUrl ? <img src={rcAvatarUrl} alt="" /> : <span className="msg-reply-avatar-fallback">{rcAuthor[0]?.toUpperCase()}</span>}
          </span>
          <span className="msg-reply-author">{rcAuthor}</span>
          <span className="msg-reply-text">{rc.content || (rc.attachments?.length > 0 ? 'Click to see attachment' : '...')}</span>
        </div>
      );
    });
  };

  const renderReactionEmoji = (reactionId) => {
    // Check if it's a unicode emoji name
    const unicodeDef = ALL_EMOJIS.find(e => e.n === reactionId);
    if (unicodeDef) return <span className="reaction-emoji">{unicodeDef.e}</span>;
    // Check if it's a custom emoji ID
    const custom = customEmojis[reactionId];
    if (custom) return <img src={custom.url} alt={`:${custom.name}:`} className="reaction-emoji-img" />;
    // It could be a raw unicode emoji
    if (/[\u{1F000}-\u{1FFFF}]/u.test(reactionId) || /[\u2600-\u27BF]/.test(reactionId)) {
      return <span className="reaction-emoji">{reactionId}</span>;
    }
    return <span className="reaction-emoji">{reactionId}</span>;
  };

  const handleEmojiSelect = (emoji) => {
    if (emoji.type === 'unicode') {
      setInput(prev => prev + emoji.emoji);
    } else {
      setInput(prev => prev + `<:${emoji.name}:${emoji.id}>`);
    }
    setShowInputEmoji(false);
    inputRef.current?.focus();
  };

  const handleGifSelect = async (gif) => {
    if (!gif?.url) return;
    if (input.trim() || pendingFiles.length > 0) {
      setInput((prev) => (prev ? `${prev} ${gif.url}` : gif.url));
      setShowGifPicker(false);
      inputRef.current?.focus();
      return;
    }
    const optimisticId = `__opt__${crypto.randomUUID()}`;
    setShowGifPicker(false);
    try {
      setMessages((prev) => [...prev, {
        _id: optimisticId,
        channel: channelId,
        author: user,
        content: gif.url,
        created_at: new Date().toISOString(),
        _optimistic: true,
      }]);
      const msg = await post(`/channels/${channelId}/messages`, { content: gif.url });
      setMessages((prev) => {
        if (prev.some((m) => m._id === msg._id)) {
          return prev.filter((m) => m._id !== optimisticId);
        }
        if (prev.some((m) => m._id === optimisticId)) {
          return prev.map((m) => (m._id === optimisticId ? msg : m));
        }
        return [...prev, msg];
      });
    } catch {
      setMessages((prev) => prev.filter((m) => m._id !== optimisticId));
    }
    inputRef.current?.focus();
  };

  const openMentionCard = (member, rect) => {
    if (!member || !rect) return;
    const popupWidth = 320;
    const popupHeight = 240;
    let left = rect.left;
    let top = rect.bottom + 8;
    if (left + popupWidth > window.innerWidth - 12) left = window.innerWidth - popupWidth - 12;
    if (top + popupHeight > window.innerHeight - 12) top = rect.top - popupHeight - 8;
    if (top < 8) top = 8;
    if (left < 8) left = 8;
    setMentionCard({ member, style: { top: `${top}px`, left: `${left}px` } });
  };

  const openUserCard = (userObj, rect) => {
    if (!userObj || !rect) return;
    const maybeMember = mentionDirectory?.byId?.[userObj._id];
    openMentionCard(maybeMember || { user: userObj }, rect);
  };

  const handleReactionEmojiSelect = (msgId) => (emoji) => {
    const reactionKey = emoji.type === 'unicode' ? emoji.emoji : emoji.id;
    addReaction(msgId, reactionKey);
    setShowEmojiPicker(null);
  };

  const handleInputKeyDown = (e) => {
    if (autocomplete) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAcSelected(s => Math.min(s + 1, autocomplete.items.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAcSelected(s => Math.max(s - 1, 0)); return; }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        applyAutocomplete(autocomplete.items[acSelected]);
        return;
      }
      if (e.key === 'Escape') { setAutocomplete(null); return; }
    }
  };

  const channelDisplayName = channel?.channel_type === 'DirectMessage' && channel?.other_user
    ? (channel.other_user.display_name || channel.other_user.username || 'Direct Message')
    : (channel?.name || 'Channel');

  /** Keep full composer (and perms-based UI) hidden until `loading` is false — messages often arrive before `/permissions`, and perms default to 0 (looks like “no send”). */
  if (loading) {
    return (
      <div className="chat-area chat-area--initial-load">
        <div className="chat-header">
          {isMobile && <button className="mobile-drawer-btn" onClick={openChannelSidebar} aria-label="Open channels"><svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg></button>}
          <span className="hash-big">#</span>
          <span className="chat-header-name">{channel ? channelDisplayName : '…'}</span>
        </div>
        <div className="messages-list chat-messages-skel" aria-busy="true" aria-label="Loading messages">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className={`chat-message-skel ${i % 2 === 0 ? 'chat-message-skel--alt' : ''}`}>
              <div className="chat-message-skel-avatar" />
              <div className="chat-message-skel-body">
                <div className="chat-message-skel-line name" />
                <div className="chat-message-skel-line" />
                {i % 3 === 0 && <div className="chat-message-skel-line short" />}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const startThread = async (msg) => {
    setContextMenu(null);
    if (msg.thread_id) {
      // Thread already exists, open it
      try {
        const thread = await get(`/channels/${msg.thread_id}`);
        setOpenThread(thread);
      } catch {}
      return;
    }
    try {
      const thread = await post(`/channels/${channelId}/threads`, { message_id: msg._id });
      // Update message in local state with thread_id
      setMessages((prev) => prev.map((m) => m._id === msg._id ? { ...m, thread_id: thread._id } : m));
      setOpenThread(thread);
    } catch {}
  };

  const openThreadFromMsg = async (msg) => {
    if (!msg.thread_id) return;
    try {
      const thread = await get(`/channels/${msg.thread_id}`);
      setOpenThread(thread);
    } catch {}
  };

  return (
    <>
    <div className="chat-area" onClick={() => { setContextMenu(null); setShowEmojiPicker(null); setShowInputEmoji(false); setShowGifPicker(false); setMentionCard(null); }}>
      <div className="chat-header">
        {isMobile && (
          <button className="mobile-drawer-btn" onClick={openChannelSidebar} aria-label="Open channels">
            <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
          </button>
        )}
        <span className="hash-big">#</span>
        <span className="chat-header-name">{channelDisplayName}</span>
        {!isMobile && channel?.description && <span className="chat-header-desc">{channel.description}</span>}
        {typingUserIds.size > 0 && (
          <span className="chat-header-typing">
            {[...typingUserIds].map((uid) => {
              const m = mentionDirectory?.byId?.[uid];
              return m?.nickname || m?.user?.display_name || m?.user?.username || 'Someone';
            }).join(', ')}
            {typingUserIds.size === 1 ? ' is typing...' : ' are typing...'}
          </span>
        )}
        <div className="chat-header-actions">
          <button className="chat-header-btn" onClick={() => { setShowPinned(!showPinned); setShowSearch(false); if (!showPinned) loadPinned(); }} title="Pinned Messages">
            <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
          </button>
          <button className="chat-header-btn" onClick={() => { setShowSearch(!showSearch); setShowPinned(false); }} title="Search">
            <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
          </button>
          <button
            type="button"
            className={`chat-header-btn ${ofeed?.open ? 'chat-header-btn--ofeed-active' : ''}`}
            onClick={() => ofeed?.toggle?.()}
            title="Ofeed — mini feed"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
              <path fill="currentColor" d="M4 4h16v2H4V4zm0 5h10v2H4V9zm0 5h16v2H4v-2zm0 5h10v2H4v-2z"/>
            </svg>
          </button>
          {isMobile && channel?.server && (
            <button className="mobile-drawer-btn" onClick={openMemberSidebar} aria-label="Open members">
              <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
            </button>
          )}
        </div>
      </div>

      {showSearch && (
        <div className="search-panel">
          <div className="search-input-row">
            <input className="search-input" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search messages..." autoFocus onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
            <button className="modal-btn primary" onClick={handleSearch} disabled={searching}>{searching ? '...' : 'Search'}</button>
          </div>
          {searchResults.length > 0 && (
            <div className="search-results">
              {searchResults.map((msg) => (
                <div key={msg._id} className="search-result-item">
                  <span className="search-result-author">{getAuthorName(msg)}</span>
                  <span className="search-result-time">{formatTime(msg)}</span>
                  <div className="search-result-text">{msg.content}</div>
                </div>
              ))}
            </div>
          )}
          {searchResults.length === 0 && searchQuery && !searching && <div className="search-empty">No results found</div>}
        </div>
      )}

      {showPinned && (
        <div className="pinned-panel">
          <div className="pinned-header">Pinned Messages</div>
          {pinnedMessages.length === 0 && <div className="search-empty">No pinned messages</div>}
          {pinnedMessages.map((msg) => (
            <div key={msg._id} className="search-result-item">
              <span className="search-result-author">{getAuthorName(msg)}</span>
              <span className="search-result-time">{formatTime(msg)}</span>
              <div className="search-result-text">{msg.content}</div>
            </div>
          ))}
        </div>
      )}

      <div className="messages-list">
        {messages.length === 0 && (
          <div className="welcome-msg">
            <h2>Welcome to #{channelDisplayName}!</h2>
            <p>This is the start of the {channel?.channel_type === 'DirectMessage' ? 'conversation' : 'channel'}.</p>
          </div>
        )}
        {messages.map((msg, idx) => {
          const showHeader = shouldShowHeader(msg, idx);
          const isEditing = editingMsg === msg._id;
          const authorId = getMessageAuthorId(msg);
          const authorObj = typeof msg.author === 'object' ? msg.author : null;
          const isServerOwnerMessage = showServerOwnerCrownForUser(authorObj, serverOwnerId, authorId);
          return (
            <div key={msg._id} id={`msg-${msg._id}`} className={`message ${showHeader ? 'with-header' : 'compact'} ${isEditing ? 'editing' : ''} ${msg.pinned ? 'pinned' : ''} ${msg.reply_context && msg.replies?.length ? 'has-reply' : ''} ${msg._optimistic ? 'msg-optimistic' : ''}`} onContextMenu={(e) => handleContextMenu(e, msg)}>
              {renderReplyContext(msg)}
              {showHeader && (
                <div
                  className="msg-avatar"
                  onClick={(e) => {
                    if (!authorObj) return;
                    openUserCard(authorObj, e.currentTarget.getBoundingClientRect());
                  }}
                >
                  {getAuthorAvatarUrl(msg) ? <img src={getAuthorAvatarUrl(msg)} alt="" className="msg-avatar-img" /> : getAuthorInitial(msg)}
                  {isServerOwnerMessage && <ServerOwnerCrown size="message" />}
                </div>
              )}
              <div className={`msg-content ${showHeader ? '' : 'no-avatar'}`}>
                {showHeader && (
                  <div className="msg-header">
                    <span
                      className="msg-author"
                      onClick={(e) => {
                        const authorObj = typeof msg.author === 'object' ? msg.author : null;
                        if (!authorObj) return;
                        openUserCard(authorObj, e.currentTarget.getBoundingClientRect());
                      }}
                    >
                      {getAuthorName(msg)}
                    </span>
                    {isMessageAuthorBot(msg) && (
                      <span className="bot-badge" title="Bot">
                        <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
                          <use href="/icons.svg#bot-icon" />
                        </svg>
                        BOT
                      </span>
                    )}
                    {messageAuthorVerifiedBot(msg) && (
                      <span className="verified-bot-badge" title="Verified bot">
                        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" className="verified-bot-check">
                          <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                        </svg>
                        Verified
                      </span>
                    )}
                    {messageAuthorStaff(msg) && (
                      <span className="opic-staff-badge" title="Opic Staff">Staff</span>
                    )}
                    <span className="msg-time">{formatTime(msg)}</span>
                    {msg.edited && <span className="msg-edited">(edited)</span>}
                  </div>
                )}
                {isEditing ? (
                  <div className="msg-edit-area">
                    <input className="msg-edit-input" value={editContent} onChange={(e) => setEditContent(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }} autoFocus />
                    <div className="msg-edit-hint">Enter to <span className="msg-edit-link" onClick={saveEdit}>save</span> · Escape to <span className="msg-edit-link" onClick={cancelEdit}>cancel</span></div>
                  </div>
                ) : (
                  <>
                    {msg.content && hasVisibleMessageText(msg.content, msg.link_previews) && (
                      <div className={`msg-text ${isEmojiOnly(msg.content) ? 'emoji-jumbo-text' : ''}`}>
                        {renderMessageContent(msg.content, customEmojis, user, mentionDirectory, openMentionCard, roleDirectory, setLightboxSrc, msg.link_previews)}
                      </div>
                    )}
                    {renderMessageEmbeds(msg.embeds)}
                    {renderLinkPreviews(msg.link_previews)}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="msg-attachments">
                        {msg.attachments.map((att, ai) => {
                          const url = resolveFileUrl(att);
                          if (isVoiceAttachment(att) && url) {
                            return <VoiceMessageAttachment key={ai} attachment={att} />;
                          }
                          const isImage = att.content_type?.startsWith('image/') || att.metadata?.type === 'Image' || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(att.filename || '');
                          const isVideo = att.content_type?.startsWith('video/') || att.metadata?.type === 'Video';
                          if (isImage && url) return <img key={ai} src={url} alt={att.filename || 'image'} className="msg-attachment-img" onClick={() => setLightboxSrc(url)} />;
                          if (isVideo && url) return <video key={ai} src={url} controls className="msg-attachment-video" />;
                          return (
                            <a key={ai} href={url} target="_blank" rel="noopener noreferrer" className="msg-attachment-file">
                              <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>
                              <span>{att.filename || 'file'}</span>
                              {att.size && <span className="msg-attachment-size">{(att.size / 1024).toFixed(1)} KB</span>}
                            </a>
                          );
                        })}
                      </div>
                    )}
                    {msg.thread_id && (
                      <button className="thread-indicator" onClick={() => openThreadFromMsg(msg)}>
                        <svg width="14" height="14" viewBox="0 0 24 24"><path fill="currentColor" d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
                        View Thread
                      </button>
                    )}
                  </>
                )}
                {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                  <div className="msg-reactions">
                    {Object.entries(msg.reactions).map(([reactionId, data]) => {
                      const count = Array.isArray(data) ? data.length : (data?.count || 0);
                      const reacted = Array.isArray(data) ? data.includes(user?._id) : false;
                      return (
                        <button key={reactionId} className={`reaction-btn ${reacted ? 'reacted' : ''}`} onClick={(e) => { e.stopPropagation(); reacted ? removeReaction(msg._id, reactionId) : addReaction(msg._id, reactionId); }}>
                          {renderReactionEmoji(reactionId)}
                          <span className="reaction-count">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              {!isEditing && !msg._optimistic && (
                <div className="msg-action-bar" onClick={(e) => e.stopPropagation()}>
                  {canReact && (
                    <button className="msg-action-btn" title="Add Reaction" onClick={() => setShowEmojiPicker(showEmojiPicker === msg._id ? null : msg._id)}>
                      <svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/></svg>
                    </button>
                  )}
                  <button className="msg-action-btn" title="Reply" onClick={() => startReply(msg)}>
                    <svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>
                  </button>
                  {(typeof msg.author === 'object' ? msg.author?._id : msg.author) === user?._id && (
                    <button className="msg-action-btn" title="Edit" onClick={() => startEdit(msg)}>
                      <svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                    </button>
                  )}
                  <button className="msg-action-btn" title="Thread" onClick={() => startThread(msg)}>
                    <svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
                  </button>
                  <button className="msg-action-btn" title="Pin" onClick={() => msg.pinned ? unpinMessage(msg._id) : pinMessage(msg._id)}>
                    <svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
                  </button>
                </div>
              )}
              {showEmojiPicker === msg._id && (
                <div className="reaction-picker-wrap" onClick={(e) => e.stopPropagation()}>
                  <EmojiPicker onSelect={handleReactionEmojiSelect(msg._id)} onClose={() => setShowEmojiPicker(null)} serverId={channel?.server} />
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {contextMenu && (
        <>
          <div className="ctx-backdrop" onClick={() => setContextMenu(null)} />
          <div className="ctx-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
            <div className="ctx-item" onClick={() => startReply(contextMenu.msg)}>
              <svg width="14" height="14" viewBox="0 0 24 24" style={{marginRight:6,verticalAlign:'middle'}}><path fill="currentColor" d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>
              Reply
            </div>
            {canReact && (
              <div className="ctx-item" onClick={() => addReaction(contextMenu.msg._id, '👍')}>
                <span className="ctx-quick-emoji">👍</span> React
              </div>
            )}
            {canReact && (
              <div className="ctx-item" onClick={() => { setShowEmojiPicker(contextMenu.msg._id); setContextMenu(null); }}>Add Reaction</div>
            )}
            <div className="ctx-item" onClick={() => startThread(contextMenu.msg)}>
              <svg width="14" height="14" viewBox="0 0 24 24" style={{marginRight:6,verticalAlign:'middle'}}><path fill="currentColor" d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
              {contextMenu.msg.thread_id ? 'Open Thread' : 'Start Thread'}
            </div>
            <div className="ctx-item" onClick={() => { contextMenu.msg.pinned ? unpinMessage(contextMenu.msg._id) : pinMessage(contextMenu.msg._id); }}>
              {contextMenu.msg.pinned ? 'Unpin Message' : 'Pin Message'}
            </div>
            {contextMenu.isOwn && (
              <>
                <div className="ctx-separator" />
                <div className="ctx-item" onClick={() => startEdit(contextMenu.msg)}>Edit Message</div>
                <div className="ctx-item danger" onClick={() => deleteMessage(contextMenu.msg._id)}>Delete Message</div>
              </>
            )}
            {!contextMenu.isOwn && canManageMessages && (
              <>
                <div className="ctx-separator" />
                <div className="ctx-item danger" onClick={() => deleteMessage(contextMenu.msg._id)}>Delete Message</div>
              </>
            )}
          </div>
        </>
      )}

      {mentionCard && (
        <>
          <div className="mention-card-backdrop" onClick={() => setMentionCard(null)} />
          <ProfileCard
            user={typeof mentionCard.member?.user === 'object' ? mentionCard.member.user : mentionCard.member}
            member={mentionCard.member}
            style={mentionCard.style}
            className="mention-profile-card"
            onClose={() => setMentionCard(null)}
          />
        </>
      )}

      {canSend ? (
        <form className={`chat-input-area${mentionCard ? ' chat-input-area-above-backdrop' : ''}`} onSubmit={sendMessage}>
          {replyingTo && (
            <div className="reply-bar">
              <svg width="16" height="16" viewBox="0 0 24 24" className="reply-bar-icon"><path fill="currentColor" d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>
              <span className="reply-bar-label">Replying to</span>
              <span className="reply-bar-author">{replyingTo.author}</span>
              <span className="reply-bar-preview">{replyingTo.content?.slice(0, 80) || '...'}</span>
              <button type="button" className="reply-bar-close" onClick={cancelReply} aria-label="Cancel reply">×</button>
            </div>
          )}
          {voice.error && (
            <div className="voice-rec-error" role="alert">
              {voice.error}
            </div>
          )}
          {voice.phase === 'recording' && (
            <VoiceRecordingBar
              seconds={voice.seconds}
              onCancel={voice.cancel}
              onSend={sendVoiceMessage}
            />
          )}
          {pendingFiles.length > 0 && (
            <div className="pending-files">
              {pendingFiles.map((f, i) => (
                <div key={i} className="pending-file">
                  {f.type?.startsWith('image/') ? <img src={URL.createObjectURL(f)} alt={f.name} className="pending-file-thumb" /> : f.type?.startsWith('audio/') ? (
                    <div className="pending-file-icon pending-file-icon--audio" aria-hidden>
                      <svg width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/></svg>
                    </div>
                  ) : (
                    <div className="pending-file-icon"><svg width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zM13 9V3.5L18.5 9H13z"/></svg></div>
                  )}
                  <span className="pending-file-name">{f.name}</span>
                  <button type="button" className="pending-file-remove" onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
            </div>
          )}
          <div className="chat-input-composer">
            {autocomplete && (
              <div
                className={`autocomplete-popup${autocomplete.mode === 'mention' ? ' autocomplete-popup-mention' : ''}`}
                role="listbox"
                aria-label={autocomplete.mode === 'mention' ? 'Mention users and roles' : 'Emoji suggestions'}
              >
                {autocomplete.items.map((item, i) => (
                  <div
                    key={item.type === 'user' ? `u-${item.id}` : item.type === 'role' ? `r-${item.id}` : `${item.type}-${i}`}
                    role="option"
                    aria-selected={i === acSelected}
                    className={`ac-item ${i === acSelected ? 'selected' : ''}`}
                    onMouseDown={(e) => { e.preventDefault(); applyAutocomplete(item); }}
                  >
                  {item.type === 'unicode' ? (
                    <><span className="ac-emoji">{item.e}</span><span className="ac-name">:{item.n || item.name}:</span></>
                  ) : item.type === 'custom' ? (
                    <><img src={item.url} alt="" className="ac-emoji-img" /><span className="ac-name">:{item.name}:</span></>
                  ) : item.type === 'role' ? (
                    <><span className="ac-role-dot" style={{ background: item.colour || 'var(--text-muted)' }} /><span className="ac-name">@{item.name}</span><span className="ac-tag">Role</span></>
                  ) : item.type === 'everyone' ? (
                    <><span className="ac-role-dot everyone-dot" /><span className="ac-name">@everyone</span><span className="ac-tag">Notify all</span></>
                  ) : item.type === 'user' ? (
                    <>
                      {item.avatar ? <img src={resolveFileUrl(item.avatar)} alt="" className="ac-user-avatar" /> : <span className="ac-user-initial">{(item.name || '?')[0]?.toUpperCase()}</span>}
                      <span className="ac-name">@{item.name}</span>{item.username && item.username !== item.name && <span className="ac-tag">{item.username}</span>}
                    </>
                  ) : (
                    <span className="ac-name">{item.name}</span>
                  )}
                  </div>
                ))}
              </div>
            )}
            <FormattingToolbar inputRef={inputRef} value={input} onChange={setInput} />
            <div className="chat-input-wrap">
            <div className="chat-input-leading">
            <button
              type="button"
              className={`chat-voice-btn${voice.phase === 'recording' ? ' recording' : ''}`}
              onClick={() => {
                voice.clearError();
                void voice.start();
              }}
              disabled={uploading || slowmodeCooldown > 0 || voice.phase === 'recording'}
              title="Record voice message"
              aria-label="Record voice message"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden focusable="false">
                <path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
              </svg>
            </button>
            {canAttach && (
              <button type="button" className="chat-attach-btn" onClick={() => fileInputRef.current?.click()} title="Attach file">
                <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg>
              </button>
            )}
            </div>
            <input type="file" ref={fileInputRef} style={{ display: 'none' }} multiple onChange={handleFileSelect} />
            <input
              ref={inputRef}
              className="chat-input"
              value={input}
              onChange={(e) => { setInput(e.target.value); scheduleTyping(); }}
              onFocus={() => mentionCard && setMentionCard(null)}
              onBlur={sendTypingStop}
              onPaste={canAttach ? handlePaste : undefined}
              onKeyDown={handleInputKeyDown}
              placeholder={slowmodeCooldown > 0 ? `Slowmode: ${slowmodeCooldown}s remaining...` : uploading ? 'Uploading...' : `Message ${channel?.channel_type === 'DirectMessage' ? '@' : '#'}${channelDisplayName}`}
              disabled={uploading || slowmodeCooldown > 0}
            />
            <button type="button" className="chat-emoji-btn" onClick={(e) => { e.stopPropagation(); setShowInputEmoji(!showInputEmoji); }} title="Emojis">
              <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/></svg>
            </button>
            <button type="button" className="chat-gif-btn" onClick={(e) => { e.stopPropagation(); setShowGifPicker((v) => !v); }} title="GIFs">
              GIF
            </button>
            {isMobile && (
              <button
                type="submit"
                className="chat-send-btn"
                disabled={!canSubmitMessage}
                aria-label="Send message"
                title="Send"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="currentColor" d="M3.4 20.4 22 12 3.4 3.6l.1 6.5L16 12 3.5 13.9z" />
                </svg>
              </button>
            )}
          </div>
          </div>
          {showInputEmoji && (
            <div className="input-emoji-wrap" onClick={(e) => e.stopPropagation()}>
              <EmojiPicker onSelect={handleEmojiSelect} onClose={() => setShowInputEmoji(false)} serverId={channel?.server} />
            </div>
          )}
          {showGifPicker && (
            <div className="input-gif-wrap" onClick={(e) => e.stopPropagation()}>
              <GiphyPicker onSelect={handleGifSelect} />
            </div>
          )}
        </form>
      ) : (
        <div className="chat-input-area chat-no-send chat-input-locked">
          <div className="chat-no-send-text">You don&apos;t have permission to send messages here.</div>
        </div>
      )}
      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
    {openThread && (
      <ThreadPanel threadChannel={openThread} onClose={() => setOpenThread(null)} customEmojis={customEmojis} serverOwnerId={serverOwnerId} />
    )}
    </>
  );
}
