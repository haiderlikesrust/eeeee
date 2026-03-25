import React from "react";
import { SlashCommandMenu } from "./SlashCommandMenu";
import type { SlashItem } from "../theme";
import "./video-ui.css";

const AttachIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
    <path
      fill="currentColor"
      d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"
    />
  </svg>
);

export type MenuProps = {
  items: SlashItem[];
  selectedIndex: number;
  itemOpacities: number[];
  pickFlash: boolean;
  menuScale: number;
  listTranslateY: number;
  selectedRowScale: number;
};

type Props = {
  text: string;
  showCaret: boolean;
  showMenu: boolean;
  menuStyle?: React.CSSProperties;
  menuProps: MenuProps;
  focused: boolean;
  showBackdrop: boolean;
  backdropOpacity: number;
  wrapStyle?: React.CSSProperties;
  accentPulse: number;
};

export const ChatComposerMock: React.FC<Props> = ({
  text,
  showCaret,
  showMenu,
  menuStyle,
  menuProps,
  focused,
  showBackdrop,
  backdropOpacity,
  wrapStyle,
  accentPulse,
}) => (
  <>
    {showBackdrop ? (
      <div
        className="stoat-menu-backdrop"
        style={{ opacity: backdropOpacity }}
      />
    ) : null}
    <div className="stoat-composer-wrap stoat-remotion-root" style={wrapStyle}>
      <div
        className={`chat-input-composer${focused ? " stoat-composer--focused" : ""}`}
        style={{
          boxShadow:
            accentPulse > 0
              ? `0 0 0 3px ${"rgba(16, 185, 129, 0.15)"}, 0 0 ${24 + accentPulse * 40}px rgba(16, 185, 129, ${0.15 + accentPulse * 0.35})`
              : undefined,
        }}
      >
        {showMenu ? (
          <SlashCommandMenu {...menuProps} style={menuStyle} />
        ) : null}
        <div className="chat-input-composer-surface">
          <div className="chat-input-row">
            <div className="chat-input-leading">
              <div className="chat-attach-btn" aria-hidden>
                <AttachIcon />
              </div>
            </div>
            <div className="chat-input-field-shell">
              <div className="chat-input-mock">
                {text}
                {showCaret ? <span className="chat-input-caret" /> : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </>
);
