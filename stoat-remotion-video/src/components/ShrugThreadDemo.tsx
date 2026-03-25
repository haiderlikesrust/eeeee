import React from "react";
import "./video-ui.css";

/** Same path as stoat-frontend/public/icons.svg#bot-icon */
const BotIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden>
    <path
      fill="currentColor"
      d="M20 11v5c0 1.1-.9 2-2 2h-1v1c0 .55-.45 1-1 1s-1-.45-1-1v-1H9v1c0 .55-.45 1-1 1s-1-.45-1-1v-1H6c-1.1 0-2-.9-2-2v-5c0-1.1.9-2 2-2h1V7c0-2.21 1.79-4 4-4V2h2v1c2.21 0 4 1.79 4 4v2h1c1.1 0 2 .9 2 2m-11 2c.55 0 1-.45 1-1s-.45-1-1-1-1 .45-1 1 .45 1 1 1m6 0c.55 0 1-.45 1-1s-.45-1-1-1-1 .45-1 1 .45 1 1 1M9 9h6V7c0-1.1-.9-2-2-2h-2c-1.1 0-2 .9-2 2z"
    />
  </svg>
);

type Props = {
  userOpacity: number;
  userScale: number;
  userY: number;
  botOpacity: number;
  botScale: number;
  botY: number;
};

export const ShrugThreadDemo: React.FC<Props> = ({
  userOpacity,
  userScale,
  userY,
  botOpacity,
  botScale,
  botY,
}) => (
  <div className="stoat-shrug-thread stoat-remotion-root">
    <div
      className="stoat-msg message with-header"
      style={{
        opacity: userOpacity,
        transform: `scale(${userScale}) translateY(${userY}px)`,
        transformOrigin: "50% 0%",
      }}
    >
      <div className="msg-avatar">P</div>
      <div className="msg-content">
        <div className="msg-header">
          <span className="msg-author">papi_haider</span>
          <span className="msg-time">Today at 03:46 AM</span>
        </div>
        <div className="msg-text">/shrug</div>
      </div>
    </div>
    <div
      className="stoat-msg message with-header"
      style={{
        opacity: botOpacity,
        transform: `scale(${botScale}) translateY(${botY}px)`,
        transformOrigin: "50% 0%",
      }}
    >
      <div className="msg-avatar">C</div>
      <div className="msg-content">
        <div className="msg-header">
          <span className="msg-author">Claw</span>
          <span className="bot-badge" title="Bot">
            <BotIcon />
            BOT
          </span>
          <span className="verified-bot-badge" title="Verified bot">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              aria-hidden
              className="verified-bot-check"
            >
              <path
                fill="currentColor"
                d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
              />
            </svg>
            Verified
          </span>
          <span className="msg-time">Today at 03:46 AM</span>
        </div>
        <div className="msg-text">{"¯\\_(ツ)_/¯"}</div>
      </div>
    </div>
  </div>
);
