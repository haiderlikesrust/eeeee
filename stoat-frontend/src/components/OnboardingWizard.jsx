import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useOnboarding } from '../context/OnboardingContext';
import { useMobile } from '../context/MobileContext';
import { post } from '../api';
import './OnboardingWizard.css';

const STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to Opic!',
    body: "Let's take a quick tour so you feel right at home. It only takes a minute.",
    route: '/channels/@me',
    anchor: null,
  },
  {
    id: 'home_discover',
    title: 'Home & Discover',
    body: 'This is your home page. Browse public servers, see activity, and find communities to join.',
    route: '/channels/@me',
    anchor: 'onboarding-home-discover',
    position: 'right',
  },
  {
    id: 'sidebar_nav',
    title: 'Navigation Sidebar',
    body: 'Switch between your servers, direct messages, and friends list using the sidebar.',
    route: '/channels/@me',
    anchor: 'onboarding-sidebar-nav',
    position: 'right',
  },
  {
    id: 'create_first_server',
    title: 'Create Your First Server',
    body: "Every community starts with a server. Give yours a name and we'll set it up for you instantly.",
    route: '/channels/@me',
    anchor: null,
    interactive: 'create_server',
  },
  {
    id: 'chat_basics',
    title: 'Chat Basics',
    body: 'Type messages, reply to others, react with emoji, and pin important messages right from the composer.',
    route: null,
    anchor: 'onboarding-chat-composer',
    position: 'top',
    optional: true,
  },
  {
    id: 'profile_settings',
    title: 'Profile & Settings',
    body: 'Click your avatar or the gear icon to customise your profile, change your status, and adjust app settings.',
    route: '/channels/@me',
    anchor: 'onboarding-user-panel',
    position: 'top',
  },
  {
    id: 'friends_dm',
    title: 'Friends & Direct Messages',
    body: 'Add friends by username and start private conversations. Click "Add Friend" to get started.',
    route: '/channels/@me/friends',
    anchor: 'onboarding-friends-action',
    position: 'bottom',
  },
  {
    id: 'complete',
    title: "You're All Set!",
    body: "You know the basics now. Explore, connect, and have fun! You can restart this tour anytime from User Settings.",
    route: null,
    anchor: null,
  },
];

function getAnchorRect(anchorId) {
  if (!anchorId) return null;
  const el = document.querySelector(`[data-onboarding-id="${anchorId}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return r;
}

function tooltipStyle(rect, position, isMobile) {
  if (!rect) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  const pad = 14;
  const style = { position: 'fixed' };
  if (isMobile) {
    style.left = '16px';
    style.right = '16px';
    style.bottom = '80px';
    style.maxWidth = 'calc(100vw - 32px)';
    return style;
  }
  const clampTop = (v) => Math.max(8, Math.min(v, window.innerHeight - 260));
  const clampLeft = (v) => Math.max(8, Math.min(v, window.innerWidth - 356));
  switch (position) {
    case 'right':
      style.top = `${clampTop(rect.top)}px`;
      style.left = `${rect.right + pad}px`;
      if (parseInt(style.left) > window.innerWidth - 360) {
        style.left = `${Math.max(8, rect.left - pad - 340)}px`;
      }
      break;
    case 'left':
      style.top = `${clampTop(rect.top)}px`;
      style.right = `${window.innerWidth - rect.left + pad}px`;
      break;
    case 'top':
      style.bottom = `${window.innerHeight - rect.top + pad}px`;
      style.left = `${clampLeft(rect.left)}px`;
      break;
    case 'bottom':
    default:
      style.top = `${rect.bottom + pad}px`;
      style.left = `${clampLeft(rect.left)}px`;
      break;
  }
  return style;
}

export default function OnboardingWizard({ onServerAdded }) {
  const ob = useOnboarding();
  const navigate = useNavigate();
  const location = useLocation();
  const { isMobile, openChannelSidebar, closeMobileOverlay } = useMobile();
  const [anchorRect, setAnchorRect] = useState(null);
  const [serverName, setServerName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createdServerId, setCreatedServerId] = useState(null);
  const stepIndex = ob?.currentStep ?? 0;
  const retryRef = useRef(null);

  const step = STEPS[stepIndex] || STEPS[STEPS.length - 1];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;

  const measureAnchor = useCallback(() => {
    if (!step.anchor) {
      setAnchorRect(null);
      return;
    }
    const r = getAnchorRect(step.anchor);
    setAnchorRect(r);
    if (!r && step.anchor) {
      clearTimeout(retryRef.current);
      retryRef.current = setTimeout(() => {
        const r2 = getAnchorRect(step.anchor);
        setAnchorRect(r2);
      }, 400);
    }
  }, [step.anchor]);

  // For chat_basics after server creation: poll until the composer appears
  useEffect(() => {
    if (!ob?.active || step.id !== 'chat_basics' || !createdServerId) return;
    let attempts = 0;
    const maxAttempts = 15;
    const poll = () => {
      const r = getAnchorRect('onboarding-chat-composer');
      if (r) {
        setAnchorRect(r);
        return;
      }
      attempts++;
      if (attempts < maxAttempts) {
        retryRef.current = setTimeout(poll, 350);
      }
    };
    retryRef.current = setTimeout(poll, 300);
    return () => clearTimeout(retryRef.current);
  }, [ob?.active, step.id, createdServerId]);

  useEffect(() => {
    if (!ob?.active) return;
    // For chat_basics with a created server, navigate into that server
    if (step.id === 'chat_basics' && createdServerId) {
      if (!location.pathname.startsWith(`/channels/${createdServerId}`)) {
        navigate(`/channels/${createdServerId}`, { replace: true });
      }
    } else if (step.route && !location.pathname.startsWith(step.route)) {
      navigate(step.route, { replace: true });
    }
    if (isMobile && step.anchor === 'onboarding-sidebar-nav') {
      openChannelSidebar?.();
    } else if (isMobile) {
      closeMobileOverlay?.();
    }
  }, [ob?.active, stepIndex, step.id, step.route, step.anchor, createdServerId, location.pathname, navigate, isMobile, openChannelSidebar, closeMobileOverlay]);

  useEffect(() => {
    if (!ob?.active) return;
    // Skip the initial measure for chat_basics after server creation — the poll handles it
    if (step.id === 'chat_basics' && createdServerId) return;
    const t = setTimeout(measureAnchor, 150);
    return () => clearTimeout(t);
  }, [ob?.active, stepIndex, step.id, createdServerId, measureAnchor, location.pathname]);

  useEffect(() => {
    if (!ob?.active) return;
    window.addEventListener('resize', measureAnchor);
    window.addEventListener('scroll', measureAnchor, true);
    return () => {
      window.removeEventListener('resize', measureAnchor);
      window.removeEventListener('scroll', measureAnchor, true);
    };
  }, [ob?.active, measureAnchor]);

  if (!ob?.active) return null;

  const handleCreateServer = async () => {
    if (!serverName.trim() || creating) return;
    setCreating(true);
    setCreateError('');
    try {
      const res = await post('/servers/create', { name: serverName.trim() });
      const server = res?.server || res;
      if (server?._id) {
        onServerAdded?.(server);
        setCreatedServerId(server._id);
        setServerName('');
        // Navigate into the new server — AutoRedirect will pick the first channel
        navigate(`/channels/${server._id}`, { replace: true });
        // Advance to chat_basics after a short delay so the route starts loading
        setTimeout(() => ob.setStep(stepIndex + 1), 600);
      }
    } catch (err) {
      setCreateError(err?.error || 'Failed to create server');
    } finally {
      setCreating(false);
    }
  };

  const handleNext = () => {
    if (isLast) {
      ob.complete();
      return;
    }
    let nextIdx = stepIndex + 1;
    const nextStep = STEPS[nextIdx];
    if (nextStep?.optional && nextStep?.anchor && !getAnchorRect(nextStep.anchor)) {
      // If a server was created, chat_basics will load — don't skip it
      if (!(nextStep.id === 'chat_basics' && createdServerId)) {
        nextIdx = Math.min(nextIdx + 1, STEPS.length - 1);
      }
    }
    ob.setStep(nextIdx);
  };

  const handlePrev = () => {
    if (stepIndex > 0) {
      let prevIdx = stepIndex - 1;
      const prevStep = STEPS[prevIdx];
      if (prevStep?.optional && prevStep?.anchor && !getAnchorRect(prevStep.anchor)) {
        prevIdx = Math.max(prevIdx - 1, 0);
      }
      ob.setStep(prevIdx);
    }
  };

  const handleSkip = () => {
    ob.skip();
  };

  const spotlightPad = 8;
  const showSpotlight = !!anchorRect;

  return (
    <div className="onboarding-overlay">
      {showSpotlight && (
        <svg className="onboarding-spotlight-svg" width="100%" height="100%">
          <defs>
            <mask id="onboarding-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              <rect
                x={anchorRect.left - spotlightPad}
                y={anchorRect.top - spotlightPad}
                width={anchorRect.width + spotlightPad * 2}
                height={anchorRect.height + spotlightPad * 2}
                rx="8"
                ry="8"
                fill="black"
              />
            </mask>
          </defs>
          <rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask="url(#onboarding-mask)" />
        </svg>
      )}
      {!showSpotlight && <div className="onboarding-backdrop" />}

      <div
        className={`onboarding-tooltip ${!anchorRect && step.anchor ? 'onboarding-tooltip--center' : ''}`}
        style={anchorRect ? tooltipStyle(anchorRect, step.position, isMobile) : undefined}
      >
        <div className="onboarding-step-indicator">
          {STEPS.map((_, i) => (
            <span key={i} className={`onboarding-dot ${i === stepIndex ? 'active' : ''} ${i < stepIndex ? 'done' : ''}`} />
          ))}
        </div>
        <h3 className="onboarding-title">{step.title}</h3>
        <p className="onboarding-body">{step.body}</p>

        {step.interactive === 'create_server' && (
          <div className="onboarding-create-server">
            <input
              className="onboarding-server-input"
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
              placeholder="My Awesome Server"
              onKeyDown={(e) => e.key === 'Enter' && handleCreateServer()}
              autoFocus
              disabled={creating}
            />
            {createError && <div className="onboarding-create-error">{createError}</div>}
            <button
              className="onboarding-create-btn"
              onClick={handleCreateServer}
              disabled={!serverName.trim() || creating}
            >
              {creating ? 'Creating...' : 'Create Server'}
            </button>
          </div>
        )}

        <div className="onboarding-actions">
          <button className="onboarding-skip-btn" onClick={handleSkip}>
            {isLast ? 'Close' : 'Skip tour'}
          </button>
          <div className="onboarding-nav-btns">
            {!isFirst && (
              <button className="onboarding-back-btn" onClick={handlePrev}>Back</button>
            )}
            <button className="onboarding-next-btn" onClick={handleNext}>
              {isLast ? 'Finish' : step.interactive === 'create_server' ? 'Skip this' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
