# Stoat Frontend Design Spec (Android Port)

This document was derived from the current web frontend styles/components in `stoat-frontend/src` and is intended as a direct visual/system guide for an Android implementation (Jetpack Compose or XML).

## 1) Visual Direction

- Dark-first UI with layered surfaces.
- Neon-mint primary accent (`#10B981`) and indigo secondary accent (`#6366F1`).
- Rounded corners across all controls.
- Dense-but-readable chat layout with subtle hover/selection states.
- Typography: `Plus Jakarta Sans` for UI text, monospace for code/ids.

Primary source files:

- `src/index.css`
- `src/pages/AppLayout.css`
- `src/components/ServerBar.css`
- `src/components/ChannelSidebar.css`
- `src/components/ChatArea.css`
- `src/components/MemberSidebar.css`
- `src/pages/Auth.css`
- `src/context/ToastContext.css`

## 2) Core Tokens

### 2.1 Color Tokens

From `src/index.css`:

- `bgPrimary`: `#1A1D24`
- `bgSecondary`: `#14161B`
- `bgTertiary`: `#0F1115`
- `bgFloating`: `#1E2129`
- `bgModifierHover`: `rgba(255,255,255,0.04)`
- `bgModifierActive`: `rgba(255,255,255,0.08)`
- `bgModifierSelected`: `rgba(255,255,255,0.10)`
- `textNormal`: `#C9CDD3`
- `textMuted`: `#6B7280`
- `textLink`: `#38BDF8`
- `headerPrimary`: `#E8EAED`
- `headerSecondary`: `#9CA3AF`
- `accent`: `#10B981`
- `accentHover`: `#059669`
- `accentMuted`: `rgba(16,185,129,0.15)`
- `accentGlow`: `rgba(16,185,129,0.25)`
- `accentSecondary`: `#6366F1`
- `danger`: `#EF4444`
- `warning`: `#F59E0B`
- `statusOnline`: `#10B981`
- `statusIdle`: `#F59E0B`
- `statusDnd`: `#EF4444`
- `statusOffline`: `#6B7280`
- `inputBg`: `rgba(255,255,255,0.05)`
- `inputBorder`: `rgba(255,255,255,0.08)`

### 2.2 Shape + Motion

- Radius S: `6dp`
- Radius M: `10dp`
- Radius L: `14dp`
- Radius XL: `20dp`
- Fast transition: `150ms` (ease-in-out-ish cubic)
- Smooth transition: `250ms`
- Elevation/shadow style is soft + broad blur.

### 2.3 Typography Scale (Observed)

- Body default: `14sp`
- Header title/channel title: `15sp` / semibold-bold
- Message author: `14sp` / semibold
- Message time/meta: `10-11sp`
- Section labels (uppercase): `11sp`
- Auth title: `26sp`
- Welcome hero title: `28sp`

## 3) Layout System

## 3.1 Desktop Shell

From `AppLayout.css` and sidebar styles:

- Left Server Bar: `72dp` fixed width
- Channel Sidebar: `248dp`
- Main Chat Area: flexible
- Member Sidebar: `240dp`

Recommended Android split:

- Tablet: persistent 3-column layout.
- Phone: drawer/overlay navigation.

## 3.2 Mobile Behavior

Web breakpoint is `max-width: 768px`.

Equivalent Android behavior:

- Server/channel panels become off-canvas overlays.
- Backdrop shown while overlay is open.
- Chat remains full width under overlays.

## 3.3 Vertical Rhythm

- Top bars around `52dp` height (chat header, sidebar header).
- Message list uses compact row spacing with larger gaps between author groups.
- Composer is docked bottom with layered container styling.

## 4) Component Specs

## 4.1 Server Icon Rail

From `ServerBar.css`:

- Icon container: `48x48dp`, rounded (`14dp` default).
- Active/hover: accent-filled, white icon/text, slight lift.
- Active indicator bar on left edge.
- Unread indicator: top small green dot.

## 4.2 Channel List Item

From `ChannelSidebar.css`:

- Item padding compact; text icon + label.
- Hover: `bgModifierHover`.
- Active: `bgModifierSelected` + left accent strip.
- Unread: small dot + stronger text emphasis.

## 4.3 Member List Item

From `MemberSidebar.css`:

- Avatar ~`32dp` with status dot.
- Name muted by default, brighter on hover.
- Offline rows dimmed (opacity + grayscale avatar).
- Badge chips: bot/verified/staff use tiny pill labels.

## 4.4 Chat Message Row

From `ChatArea.css`:

- Avatar: `40dp` square-rounded.
- Header line: author + badges + time.
- Body text: `14sp`, line-height visually around `1.6`.
- Hover: subtle bg tint and left accent marker.
- Embed cards and link previews are boxed surfaces with border.

## 4.5 Inputs and Buttons

From `Auth.css`, `ServerBar.css`, `UserSettings.css`:

- Inputs: dark translucent background, border, accent focus ring.
- Primary button: accent fill + hover darken.
- Secondary button: surface fill + subtle border.
- Disabled buttons: lowered opacity.

## 4.6 Interaction 2.0 UI Elements

From `ChatArea.css`:

- Message component button styles:
  - Primary (blue)
  - Secondary (neutral)
  - Success (green)
  - Danger (red)
  - Link-style outline
- Select menus: dark surface, rounded 8dp.
- Interaction modal: centered, floating surface, close to 520dp max width.

## 4.7 Toasts

From `ToastContext.css`:

- Top-right stack, compact cards.
- Variants via border tint only (success/error/info).
- Text small (`13sp`), close icon subtle.

## 5) Suggested Android Theme Mapping

```kotlin
val StoatDark = darkColorScheme(
    primary = Color(0xFF10B981),
    onPrimary = Color.White,
    secondary = Color(0xFF6366F1),
    background = Color(0xFF0F1115),
    surface = Color(0xFF1A1D24),
    surfaceVariant = Color(0xFF14161B),
    onBackground = Color(0xFFC9CDD3),
    onSurface = Color(0xFFC9CDD3),
    error = Color(0xFFEF4444)
)
```

Shape recommendations:

- small: `RoundedCornerShape(6.dp)`
- medium: `RoundedCornerShape(10.dp)`
- large: `RoundedCornerShape(14.dp)`

## 6) Suggested Compose Structure

- App shell: `Row` with optional sidebars.
- `ServerRail` (72dp)
- `ChannelPane` (248dp)
- `ChatPane` (weight 1f)
- `MemberPane` (240dp)
- Mobile: `ModalNavigationDrawer` + modal bottom/side sheets.

Chat stack:

- `LazyColumn` for messages
- sticky or grouped author headers
- bottom composer with attachment/actions
- overlay layers for emoji picker/modals/context menu

## 7) Interaction + State Rules

- Apply visual states consistently:
  - default / hover / active / selected / disabled / unread
- Keep emphasis hierarchy:
  - headerPrimary > textNormal > textMuted
- Use accent sparingly for focus/active actions and critical affordances.
- Retain optimistic message UI (slightly faded pending rows).

## 8) Accessibility Requirements (Android)

- Minimum touch targets: `48dp`.
- Contrast:
  - body text on surfaces should remain WCAG-friendly.
  - badges and status dots need non-color fallback labels for screen readers.
- Motion:
  - reduce/disable shimmer/animations when system reduced motion is enabled.
- Content descriptions:
  - unread indicators, status dots, action icons, and context actions.

## 9) Implementation Checklist

- Recreate token set in a single Android theme file.
- Build sidebar/chat/member panes with exact widths and spacing.
- Port button/input/modal styles first (highest reuse).
- Port message item, embeds, reactions, and interaction components.
- Add mobile drawer behavior matching overlay/backdrop flow.
- Add toast/snackbar style matching border-tint variants.

## 10) Notes

- This spec intentionally mirrors the current web look, not Material defaults.
- Keep `Plus Jakarta Sans` if licensing/package constraints allow; otherwise use the closest modern sans and preserve weights/spacing.
