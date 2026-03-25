/**
 * Keep in sync with stoat-frontend/src/index.css :root and ChatArea.css badges.
 */
export const theme = {
  fontSans: "'Plus Jakarta Sans', -apple-system, sans-serif",
  colors: {
    bgPrimary: "#1a1d24",
    bgSecondary: "#14161b",
    bgTertiary: "#0f1115",
    bgFloating: "#1e2129",
    bgModifierHover: "rgba(255, 255, 255, 0.04)",
    bgModifierSelected: "rgba(255, 255, 255, 0.1)",
    textNormal: "#c9cdd3",
    textMuted: "#6b7280",
    textLink: "#38bdf8",
    headerPrimary: "#e8eaed",
    headerSecondary: "#9ca3af",
    accent: "#10b981",
    accentHover: "#059669",
    accentMuted: "rgba(16, 185, 129, 0.15)",
    accentGlow: "rgba(16, 185, 129, 0.25)",
    accentSecondary: "#6366f1",
    inputBg: "rgba(255, 255, 255, 0.05)",
    inputBorder: "rgba(255, 255, 255, 0.08)",
    /** ChatArea .verified-bot-badge */
    verifiedBotBg: "rgba(88, 101, 242, 0.22)",
    verifiedBotText: "#a5b4fc",
  },
  radii: { sm: 6, md: 10, lg: 14, xl: 20 },
  shadow: {
    sm: "0 2px 8px rgba(0, 0, 0, 0.3)",
    md: "0 4px 16px rgba(0, 0, 0, 0.4)",
    popup: "0 -4px 16px rgba(0,0,0,0.3)",
  },
} as const;

export type SlashItem = {
  kind: "builtin" | "bot";
  name: string;
  description: string;
  botDisplayName?: string;
  botUsername?: string;
  botDiscriminator?: string;
};

/** Mirrors slashBuiltins + sample bot commands (see stoat-frontend). */
export const SLASH_MOCK_ITEMS: SlashItem[] = [
  { kind: "builtin", name: "help", description: "List built-in slash commands" },
  { kind: "builtin", name: "ping", description: "Check latency" },
  { kind: "builtin", name: "shrug", description: "Shrug" },
  { kind: "builtin", name: "tableflip", description: "Flip a table" },
  {
    kind: "builtin",
    name: "whiteboard",
    description: "Start a collaborative whiteboard in this channel",
  },
  {
    kind: "bot",
    name: "poll",
    description: "Create a quick poll",
    botDisplayName: "ModBot",
    botDiscriminator: "1024",
  },
];
