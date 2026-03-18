import { useState, useEffect, useRef, useMemo } from 'react';
import EMOJI_DATA, { searchEmojis } from '../utils/emojiData';
import { get } from '../api';
import { resolveFileUrl } from '../utils/avatarUrl';
import './EmojiPicker.css';

const CATEGORY_ICONS = {
  Smileys: '😀', Gestures: '👋', Hearts: '❤️', Nature: '🐶',
  Food: '🍕', Activities: '🎮', Objects: '💻', Symbols: '✨', Flags: '🏁',
};

export default function EmojiPicker({ onSelect, onClose, serverId }) {
  const [search, setSearch] = useState('');
  const [activeSection, setActiveSection] = useState(serverId ? '_current' : 'Smileys');
  const [serverEmojis, setServerEmojis] = useState({});
  const [servers, setServers] = useState([]);
  const [currentServer, setCurrentServer] = useState(null);
  const scrollRef = useRef(null);
  const sectionRefs = useRef({});

  useEffect(() => {
    get('/users/servers').then(srvs => {
      const list = srvs || [];
      setServers(list);
      if (serverId) {
        setCurrentServer(list.find(s => s._id === serverId) || null);
      }
      list.forEach(s => {
        get(`/servers/${s._id}/emojis`).then(emojis => {
          if (emojis?.length > 0) {
            setServerEmojis(prev => ({ ...prev, [s._id]: emojis }));
          }
        }).catch(() => {});
      });
    }).catch(() => {});
  }, [serverId]);

  const currentEmojis = serverEmojis[serverId] || [];
  const otherServersWithEmojis = useMemo(() =>
    servers.filter(s => s._id !== serverId && serverEmojis[s._id]?.length > 0),
    [servers, serverId, serverEmojis]
  );

  const handleSectionClick = (section) => {
    setActiveSection(section);
    setSearch('');
    const el = sectionRefs.current[section];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const filtered = search ? searchEmojis(search, 80) : null;
  const filteredCustom = search
    ? Object.entries(serverEmojis).flatMap(([sId, emojis]) =>
        emojis.filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
          .map(e => ({ ...e, _serverId: sId, _serverName: servers.find(s => s._id === sId)?.name || '' }))
      )
    : [];

  const handleSelect = (emoji) => onSelect(emoji);

  const getServerIcon = (s) => {
    const url = resolveFileUrl(s?.icon);
    if (url) return <img src={url} alt={s.name} className="epf-sidebar-icon-img" />;
    return <span>{(s?.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()}</span>;
  };

  return (
    <div className="emoji-picker-full" onClick={e => e.stopPropagation()}>
      <div className="epf-layout">
        {/* Left sidebar with server icons and category icons */}
        <div className="epf-sidebar">
          {serverId && currentEmojis.length > 0 && (
            <>
              <button
                className={`epf-sidebar-icon ${activeSection === '_current' ? 'active' : ''}`}
                onClick={() => handleSectionClick('_current')}
                title={currentServer?.name || 'This Server'}
              >
                {currentServer ? getServerIcon(currentServer) : <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>}
              </button>
            </>
          )}
          {otherServersWithEmojis.map(s => (
            <button
              key={s._id}
              className={`epf-sidebar-icon ${activeSection === `_server_${s._id}` ? 'active' : ''}`}
              onClick={() => handleSectionClick(`_server_${s._id}`)}
              title={s.name}
            >
              {getServerIcon(s)}
            </button>
          ))}
          {(currentEmojis.length > 0 || otherServersWithEmojis.length > 0) && (
            <div className="epf-sidebar-divider" />
          )}
          {EMOJI_DATA.map(c => (
            <button
              key={c.cat}
              className={`epf-sidebar-icon emoji-cat ${activeSection === c.cat ? 'active' : ''}`}
              onClick={() => handleSectionClick(c.cat)}
              title={c.cat}
            >
              {CATEGORY_ICONS[c.cat] || c.cat[0]}
            </button>
          ))}
        </div>

        {/* Right content area */}
        <div className="epf-main">
          <div className="epf-search">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search emojis..."
              autoFocus
            />
          </div>

          <div className="epf-grid" ref={scrollRef}>
            {search ? (
              <>
                {filteredCustom.length > 0 && (
                  <>
                    <div className="epf-cat-label">Custom Emojis</div>
                    <div className="epf-emoji-row">
                      {filteredCustom.map(em => (
                        <button key={em._id} className="epf-emoji custom" title={`:${em.name}: (${em._serverName})`} onClick={() => handleSelect({ type: 'custom', id: em._id, name: em.name, url: em.url })}>
                          <img src={em.url} alt={em.name} />
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <div className="epf-cat-label">Emoji Results</div>
                <div className="epf-emoji-row">
                  {(filtered || []).map((em, i) => (
                    <button key={i} className="epf-emoji" title={`:${em.n}:`} onClick={() => handleSelect({ type: 'unicode', emoji: em.e, name: em.n })}>
                      {em.e}
                    </button>
                  ))}
                </div>
                {(filtered || []).length === 0 && filteredCustom.length === 0 && (
                  <div className="epf-empty">No emojis found</div>
                )}
              </>
            ) : (
              <>
                {serverId && currentEmojis.length > 0 && (
                  <div ref={el => sectionRefs.current['_current'] = el}>
                    <div className="epf-cat-label">{currentServer?.name || 'This Server'}</div>
                    <div className="epf-emoji-row">
                      {currentEmojis.map(em => (
                        <button key={em._id} className="epf-emoji custom" title={`:${em.name}:`} onClick={() => handleSelect({ type: 'custom', id: em._id, name: em.name, url: em.url })}>
                          <img src={em.url} alt={em.name} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {otherServersWithEmojis.map(s => (
                  <div key={s._id} ref={el => sectionRefs.current[`_server_${s._id}`] = el}>
                    <div className="epf-cat-label">{s.name}</div>
                    <div className="epf-emoji-row">
                      {serverEmojis[s._id].map(em => (
                        <button key={em._id} className="epf-emoji custom" title={`:${em.name}:`} onClick={() => handleSelect({ type: 'custom', id: em._id, name: em.name, url: em.url })}>
                          <img src={em.url} alt={em.name} />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {EMOJI_DATA.map(c => (
                  <div key={c.cat} ref={el => sectionRefs.current[c.cat] = el}>
                    <div className="epf-cat-label">{c.cat}</div>
                    <div className="epf-emoji-row">
                      {c.emojis.map((em, i) => (
                        <button key={i} className="epf-emoji" title={`:${em.n}:`} onClick={() => handleSelect({ type: 'unicode', emoji: em.e, name: em.n })}>
                          {em.e}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
