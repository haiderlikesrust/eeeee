import React from "react";
import "./video-ui.css";

type Props = {
  xPercent: number;
  yPercent: number;
  visible: boolean;
  clickPulse: number;
};

export const FakeCursor: React.FC<Props> = ({
  xPercent,
  yPercent,
  visible,
  clickPulse,
}) => (
  <div
    className="stoat-fake-cursor"
    style={{
      left: `${xPercent}%`,
      top: `${yPercent}%`,
      opacity: visible ? 1 : 0,
      transform: `translate(-2px, -2px) scale(${1 + clickPulse * 0.25})`,
    }}
    aria-hidden
  >
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
      <path
        d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 01.35-.15H19.5a.5.5 0 00.35-.85L6.35 2.86a.5.5 0 00-.85.35z"
        fill="white"
        stroke="rgba(0,0,0,0.35)"
        strokeWidth="1.2"
      />
    </svg>
  </div>
);
