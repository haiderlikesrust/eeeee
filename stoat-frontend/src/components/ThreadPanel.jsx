import { useState, useEffect, useRef } from 'react';
import { get, post, uploadFile } from '../api';
import { useAuth } from '../context/AuthContext';
import { useWS } from '../context/WebSocketContext';
import { resolveFileUrl } from '../utils/avatarUrl';
import ServerOwnerCrown from './ServerOwnerCrown';
import { showServerOwnerCrownForUser } from '../utils/serverOwnerCrownDisplay';
import './ThreadPanel.css';

function formatTimestamp(d) {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getAuthorName(author) {
  if (!author) return 'Unknown';
  if (typeof author === 'string') return author;
  return author.display_name || author.username || 'Unknown';
}

function getAuthorAvatar(author) {
  if (!author || typeof author === 'string') return null;
  return resolveFileUrl(author.avatar);
}

export default function ThreadPanel({ threadChannel, onClose, customEmojis, serverOwnerId }) {
  const { user } = useAuth();
  const { on } = useWS();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  const channelId = threadChannel?._id;
  const threadName = threadChannel?.thread_name || threadChannel?.name || 'Thread';

  // Fetch thread messages
  useEffect(() => {
    if (!channelId) return;
    setLoading(true);
    get(`/channels/${channelId}/messages?limit=100&sort=Latest`)
      .then((msgs) => { setMessages(Array.isArray(msgs) ? msgs : []); })
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [channelId]);

  // Listen for new messages in this thread
  useEffect(() => {
    if (!on || !channelId) return;
    const unsub1 = on('Message', (data) => {
      if (data?.channel === channelId) {
        setMessages((prev) => {
          if (prev.some((m) => m._id === data._id)) return prev;
          return [...prev, data];
        });
      }
    });
    const unsub2 = on('MESSAGE_CREATE', (data) => {
      if (data?.channel === channelId) {
        setMessages((prev) => {
          if (prev.some((m) => m._id === data._id)) return prev;
          return [...prev, data];
        });
      }
    });
    return () => { unsub1(); unsub2(); };
  }, [on, channelId]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input on open
  useEffect(() => {
    inputRef.current?.focus();
  }, [channelId]);

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim() && pendingFiles.length === 0) return;
    setUploading(true);
    try {
      let attachments = [];
      for (const file of pendingFiles) {
        const uploaded = await uploadFile(file);
        attachments.push(uploaded);
      }
      const body = { content: input || '' };
      if (attachments.length > 0) body.attachments = attachments;
      const msg = await post(`/channels/${channelId}/messages`, body);
      setMessages((prev) => {
        if (prev.some((m) => m._id === msg._id)) return prev;
        return [...prev, msg];
      });
      setInput('');
      setPendingFiles([]);
    } catch {}
    setUploading(false);
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    setPendingFiles((prev) => [...prev, ...files]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removePendingFile = (idx) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  if (!threadChannel) return null;

  return (
    <div className="thread-panel">
      <div className="thread-header">
        <div className="thread-header-info">
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
          <span className="thread-title">{threadName}</span>
        </div>
        <button className="thread-close-btn" onClick={onClose} aria-label="Close thread">
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>

      <div className="thread-messages">
        {loading && <div className="thread-loading">Loading thread...</div>}
        {!loading && messages.length === 0 && (
          <div className="thread-empty">
            <svg width="40" height="40" viewBox="0 0 24 24"><path fill="currentColor" d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
            <span>No messages yet. Start the conversation!</span>
          </div>
        )}
        {/* Dedupe by _id so we never render duplicate keys (e.g. if WS and POST both add same message) */}
        {messages
          .filter((msg, idx, arr) => arr.findIndex((m) => m._id === msg._id) === idx)
          .map((msg) => {
          const authorName = getAuthorName(msg.author);
          const avatarUrl = getAuthorAvatar(msg.author);
          const authorObj = typeof msg.author === 'object' ? msg.author : null;
          const authorId = authorObj?._id ?? msg.author;
          const isOwn = authorId === user?._id;
          const isServerOwnerMsg = showServerOwnerCrownForUser(authorObj, serverOwnerId, authorId);
          return (
            <div key={msg._id} className={`thread-msg ${isOwn ? 'own' : ''}`}>
              <div className="thread-msg-avatar">
                {avatarUrl
                  ? <img src={avatarUrl} alt="" />
                  : <span>{authorName[0]?.toUpperCase()}</span>
                }
                {isServerOwnerMsg && <ServerOwnerCrown size="member" />}
              </div>
              <div className="thread-msg-body">
                <div className="thread-msg-header">
                  <span className="thread-msg-author">{authorName}</span>
                  <span className="thread-msg-time">{formatTimestamp(msg.created_at)}</span>
                </div>
                {msg.content && <div className="thread-msg-content">{msg.content}</div>}
                {msg.attachments?.length > 0 && (
                  <div className="thread-msg-attachments">
                    {msg.attachments.map((att, ai) => {
                      const url = resolveFileUrl(att);
                      const isImage = att.content_type?.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)$/i.test(att.filename || '');
                      if (isImage && url) return <img key={ai} src={url} alt={att.filename} className="thread-att-img" />;
                      return (
                        <a key={ai} href={url} target="_blank" rel="noopener noreferrer" className="thread-att-file">
                          {att.filename || 'file'}
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form className="thread-input-area" onSubmit={sendMessage}>
        {pendingFiles.length > 0 && (
          <div className="thread-pending-files">
            {pendingFiles.map((f, i) => (
              <span key={i} className="thread-pending-file">
                {f.name}
                <button type="button" onClick={() => removePendingFile(i)}>×</button>
              </span>
            ))}
          </div>
        )}
        <div className="thread-input-wrap">
          <button type="button" className="thread-attach-btn" onClick={() => fileInputRef.current?.click()} title="Attach file">
            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 015 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 005 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>
          </button>
          <input type="file" ref={fileInputRef} style={{ display: 'none' }} multiple onChange={handleFileSelect} />
          <input
            ref={inputRef}
            className="thread-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={uploading ? 'Uploading...' : `Reply in thread...`}
            disabled={uploading}
          />
          <button type="submit" className="thread-send-btn" disabled={(!input.trim() && pendingFiles.length === 0) || uploading}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
      </form>
    </div>
  );
}
