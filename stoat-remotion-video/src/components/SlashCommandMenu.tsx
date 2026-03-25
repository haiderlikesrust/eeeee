import React from "react";
import type { SlashItem } from "../theme";
import "./video-ui.css";

type Props = {
  items: SlashItem[];
  selectedIndex: number;
  itemOpacities: number[];
  pickFlash: boolean;
  menuScale: number;
  listTranslateY: number;
  selectedRowScale: number;
  style?: React.CSSProperties;
};

export const SlashCommandMenu: React.FC<Props> = ({
  items,
  selectedIndex,
  itemOpacities,
  pickFlash,
  menuScale,
  listTranslateY,
  selectedRowScale,
  style,
}) => (
  <div
    className="autocomplete-popup autocomplete-popup-slash"
    style={style}
    role="listbox"
    aria-label="Slash commands"
  >
    <div
      className="autocomplete-popup__inner"
      style={{
        transform: `scale(${menuScale}) translateY(${listTranslateY}px)`,
      }}
    >
      {items.map((item, i) => {
        const selected = i === selectedIndex;
        return (
          <div
            key={`${item.kind}-${item.name}-${i}`}
            role="option"
            aria-selected={selected}
            className={`ac-item ac-item-slash ${selected ? "selected" : ""} ${
              selected ? "stoat-row-selected-glow" : ""
            } ${pickFlash && selected ? "stoat-row-pick-flash" : ""}`}
            style={{
              opacity: itemOpacities[i] ?? 1,
              transform: selected ? `scale(${selectedRowScale})` : "scale(1)",
              transformOrigin: "center left",
            }}
          >
            <div className="ac-slash-row">
              <div className="ac-slash-main">
                <span className="ac-name">/{item.name}</span>
                {item.description ? (
                  <span className="ac-slash-desc">{item.description}</span>
                ) : null}
              </div>
              <div
                className={`ac-slash-source${
                  item.kind === "bot" ? " ac-slash-source--bot" : ""
                }`}
              >
                {item.kind === "bot" ? (
                  <>
                    <span className="ac-slash-source-label">Bot</span>
                    <span className="ac-slash-source-name">
                      {item.botDisplayName || item.botUsername || "Bot"}
                      {item.botDiscriminator != null &&
                      String(item.botDiscriminator).length > 0 ? (
                        <span className="ac-bot-disc">
                          #{item.botDiscriminator}
                        </span>
                      ) : null}
                    </span>
                  </>
                ) : (
                  <span className="ac-slash-source-name">Built-in</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  </div>
);
