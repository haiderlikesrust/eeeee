import React from "react";
import { theme } from "../theme";

type Props = {
  text: string;
  left: string;
  top: string;
  opacity: number;
};

export const FeatureCallout: React.FC<Props> = ({ text, left, top, opacity }) => (
  <div
    style={{
      position: "absolute",
      left,
      top,
      opacity,
      pointerEvents: "none",
      zIndex: 8,
      padding: "10px 16px",
      borderRadius: 10,
      background: `linear-gradient(135deg, ${theme.colors.accentMuted}, rgba(99, 102, 241, 0.12))`,
      border: `1px solid ${theme.colors.accent}44`,
      boxShadow: `0 0 24px ${theme.colors.accentGlow}`,
      color: theme.colors.headerPrimary,
      fontSize: 15,
      fontWeight: 600,
      letterSpacing: "-0.02em",
      maxWidth: 280,
    }}
  >
    {text}
  </div>
);
