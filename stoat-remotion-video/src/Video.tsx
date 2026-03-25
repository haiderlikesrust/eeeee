import React from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { theme, SLASH_MOCK_ITEMS } from "./theme";
import "./theme.css";
import { SceneChrome } from "./components/SceneChrome";
import { ChatComposerMock } from "./components/ChatComposerMock";
import { FakeCursor } from "./components/FakeCursor";
import { ShrugThreadDemo } from "./components/ShrugThreadDemo";
import { FeatureCallout } from "./components/FeatureCallout";

const SHRUG_INDEX = SLASH_MOCK_ITEMS.findIndex((x) => x.name === "shrug");

/** Slower overall pacing — intro and menu breathe more. */
const MENU_START = 92;
const CLICK_FRAME = 152;
const MENU_END = 158;
const INPUT_TYPE_START = 156;
const SHRUG_SUFFIX = ["", "s", "sh", "shr", "shru", "shrug", "shrug "];
const USER_MSG_START = 178;
const BOT_MSG_START = 198;
const OUTRO_START = 448;
const END_BLACK = 520;

function selectionForMenuLocal(t: number): number {
  if (t < 20) return 0;
  if (t < 40) return 1;
  return SHRUG_INDEX;
}

function itemOpacitiesForFrame(menuLocal: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) =>
    interpolate(menuLocal, [6 + i * 10, 24 + i * 10], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  );
}

export const SlashCommandsVideo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const blackIntro = interpolate(frame, [14, 44], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const endBlack = interpolate(frame, [END_BLACK, durationInFrames - 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const introLogo = spring({
    frame: Math.max(0, frame - 8),
    fps,
    config: { damping: 18, stiffness: 95 },
  });
  const introGlow = interpolate(introLogo, [0, 1], [0.35, 1]);
  const introTitleOpacity = interpolate(frame, [58, 84], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const sceneEnter = spring({
    frame: Math.max(0, frame - 36),
    fps,
    config: { damping: 16, stiffness: 110 },
  });
  const sceneOpacity = interpolate(sceneEnter, [0, 1], [0, 1]);

  const composerEnter = spring({
    frame: Math.max(0, frame - 42),
    fps,
    config: { damping: 15, stiffness: 100 },
  });
  const composerY = interpolate(composerEnter, [0, 1], [72, 0]);
  const composerFade = interpolate(composerEnter, [0, 1], [0, 1]);

  const typeLocal = Math.max(0, frame - 62);
  const slashVisible = typeLocal >= 12 ? "/" : "";
  const menuLocal = Math.max(0, frame - MENU_START);

  const menuSpring = spring({
    frame: menuLocal,
    fps,
    config: { damping: 17, stiffness: 165 },
  });
  const menuExitFade =
    frame < MENU_END
      ? 1
      : interpolate(frame, [MENU_END, MENU_END + 18], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
  const menuCombinedOpacity = menuSpring * menuExitFade;
  const menuTranslateY = interpolate(menuSpring, [0, 1], [40, 0]);
  const menuScale = interpolate(menuSpring, [0, 1], [0.94, 1]);

  const showMenu = frame >= MENU_START && frame < MENU_END + 16;
  const selectedIndex = showMenu ? selectionForMenuLocal(menuLocal) : SHRUG_INDEX;
  const pickFlash = frame >= CLICK_FRAME && frame < CLICK_FRAME + 16;
  const itemOpacities = itemOpacitiesForFrame(menuLocal, SLASH_MOCK_ITEMS.length);

  const typeShrugLocal = Math.max(0, frame - INPUT_TYPE_START);
  const shrugCharIdx = Math.min(
    SHRUG_SUFFIX.length - 1,
    Math.floor(typeShrugLocal / 5)
  );
  const afterClick = frame >= CLICK_FRAME;
  const inputText =
    frame >= INPUT_TYPE_START
      ? `/${SHRUG_SUFFIX[shrugCharIdx]}`
      : afterClick
        ? "/"
        : slashVisible;

  const backdropOpacity =
    showMenu && frame < MENU_END + 6
      ? interpolate(menuSpring, [0, 0.4, 1], [0, 0.88, 1]) * menuExitFade
      : 0;

  const userMsgLocal = Math.max(0, frame - USER_MSG_START);
  const userMsgSpring = spring({
    frame: userMsgLocal,
    fps,
    config: { damping: 15, stiffness: 200 },
  });
  const userOpacity = interpolate(userMsgSpring, [0, 1], [0, 1]);
  const userScale = interpolate(userMsgSpring, [0, 1], [0.94, 1]);
  const userY = interpolate(userMsgSpring, [0, 1], [20, 0]);

  const botMsgLocal = Math.max(0, frame - BOT_MSG_START);
  const botMsgSpring = spring({
    frame: botMsgLocal,
    fps,
    config: { damping: 14, stiffness: 210 },
  });
  const botOpacity = interpolate(botMsgSpring, [0, 1], [0, 1]);
  const botScale = interpolate(botMsgSpring, [0, 1], [0.94, 1]);
  const botY = interpolate(botMsgSpring, [0, 1], [18, 0]);

  const cursorVisible = frame >= 118 && frame <= CLICK_FRAME + 10;
  const cursorTravel = spring({
    frame: Math.max(0, frame - 122),
    fps,
    config: { damping: 19, stiffness: 78 },
  });
  const cursorX = interpolate(cursorTravel, [0, 1], [56, 47]);
  const cursorY = interpolate(cursorTravel, [0, 1], [84, 57]);
  const clickPulse = spring({
    frame: Math.max(0, frame - CLICK_FRAME),
    fps,
    config: { damping: 8, stiffness: 260 },
  });

  const accentPulse = interpolate(
    frame,
    [CLICK_FRAME - 2, CLICK_FRAME + 8, CLICK_FRAME + 22],
    [0, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const globalZoom = interpolate(frame, [0, durationInFrames - 1], [1, 1.026], {
    extrapolateRight: "clamp",
  });
  const panX = interpolate(Math.sin(frame / 58), [-1, 1], [-6, 6]);
  const focusBump = interpolate(
    frame,
    [CLICK_FRAME - 4, CLICK_FRAME + 10, CLICK_FRAME + 26],
    [0, 0.038, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  /** 3D "dolly around" the composer while /shrug types — zoom in + view from the side */
  const tiltT = Math.max(0, frame - INPUT_TYPE_START);
  const heroRotateY = interpolate(
    tiltT,
    [0, 10, 26, 48, 62],
    [0, -8, -32, -22, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const heroRotateX = interpolate(
    tiltT,
    [0, 12, 32, 52, 62],
    [0, 2, 8, 4, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const heroTranslateZ = interpolate(
    tiltT,
    [0, 14, 32, 52, 62],
    [0, 40, 220, 120, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const heroScaleBoost = interpolate(
    tiltT,
    [0, 16, 36, 54, 62],
    [0, 0.06, 0.28, 0.12, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const outroPull = spring({
    frame: Math.max(0, frame - OUTRO_START),
    fps,
    config: { damping: 20, stiffness: 80 },
  });
  const outroUiScale = interpolate(outroPull, [0, 1], [1, 0.86]);
  const outroTextOpacity = interpolate(frame, [464, 486], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const outroLineOpacity = interpolate(
    frame,
    [durationInFrames - 28, durationInFrames - 12],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const cameraScale =
    (globalZoom + focusBump + heroScaleBoost) *
    (frame >= OUTRO_START ? outroUiScale : 1);

  const showCaret =
    frame >= 58 &&
    frame < OUTRO_START &&
    frame < INPUT_TYPE_START + 34;

  const composerFocused =
    frame >= 54 &&
    frame < OUTRO_START + 24 &&
    (Boolean(slashVisible) || showMenu || afterClick);

  const label1 = interpolate(frame, [96, 110, 188, 204], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const label2 = interpolate(frame, [108, 122, 204, 220], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const label3 = interpolate(frame, [118, 132, 220, 236], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const selectedRowScale =
    selectedIndex === SHRUG_INDEX && menuLocal > 28 ? 1.038 : 1.028;
  const listTranslateY = -Math.min(selectedIndex, SHRUG_INDEX) * 34;

  return (
    <AbsoluteFill
      className="stoat-remotion-root"
      style={{
        fontFamily: theme.fontSans,
        backgroundColor: "#000",
        overflow: "hidden",
      }}
    >
      <Sequence from={34} durationInFrames={14}>
        <Audio src={staticFile("sounds/whoosh.mp3")} volume={0.2} />
      </Sequence>
      <Sequence from={MENU_START} durationInFrames={12}>
        <Audio src={staticFile("sounds/whoosh.mp3")} volume={0.12} />
      </Sequence>
      <Sequence from={118} durationInFrames={8}>
        <Audio src={staticFile("sounds/click.mp3")} volume={0.1} />
      </Sequence>
      <Sequence from={138} durationInFrames={8}>
        <Audio src={staticFile("sounds/click.mp3")} volume={0.1} />
      </Sequence>
      <Sequence from={CLICK_FRAME} durationInFrames={10}>
        <Audio src={staticFile("sounds/click.mp3")} volume={0.34} />
      </Sequence>
      <Sequence from={USER_MSG_START} durationInFrames={8}>
        <Audio src={staticFile("sounds/click.mp3")} volume={0.14} />
      </Sequence>
      <Sequence from={BOT_MSG_START} durationInFrames={8}>
        <Audio src={staticFile("sounds/click.mp3")} volume={0.12} />
      </Sequence>
      <Sequence from={OUTRO_START} durationInFrames={16}>
        <Audio src={staticFile("sounds/whoosh.mp3")} volume={0.14} />
      </Sequence>

      <AbsoluteFill
        style={{
          backgroundColor: theme.colors.bgTertiary,
          opacity: sceneOpacity * outroLineOpacity,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            perspective: "1100px",
            perspectiveOrigin: "52% 82%",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              transformStyle: "preserve-3d",
              transformOrigin: "52% 82%",
              transform: `translateX(${panX}px) translateZ(${heroTranslateZ}px) rotateY(${heroRotateY}deg) rotateX(${heroRotateX}deg) scale(${cameraScale})`,
            }}
          >
          <AbsoluteFill>
            <SceneChrome parallaxX={panX * -0.85}>
              <FeatureCallout
                text="Instant commands"
                left="10%"
                top="22%"
                opacity={label1}
              />
              <FeatureCallout
                text="Built-in tools"
                left="12%"
                top="30%"
                opacity={label2}
              />
              <FeatureCallout
                text="Slash powered workflow"
                left="8%"
                top="38%"
                opacity={label3}
              />
              <ShrugThreadDemo
                userOpacity={userOpacity}
                userScale={userScale}
                userY={userY}
                botOpacity={botOpacity}
                botScale={botScale}
                botY={botY}
              />
              <FakeCursor
                xPercent={cursorX}
                yPercent={cursorY}
                visible={cursorVisible}
                clickPulse={clickPulse}
              />
              <ChatComposerMock
                text={inputText}
                showCaret={showCaret}
                showMenu={showMenu}
                showBackdrop={showMenu && backdropOpacity > 0.02}
                backdropOpacity={backdropOpacity}
                focused={composerFocused}
                accentPulse={accentPulse}
                wrapStyle={{
                  opacity: composerFade,
                  transform: `translateX(-50%) translateY(${composerY}px)`,
                }}
                menuStyle={{
                  opacity: menuCombinedOpacity,
                  transform: `translateY(${menuTranslateY}px)`,
                }}
                menuProps={{
                  items: SLASH_MOCK_ITEMS,
                  selectedIndex,
                  itemOpacities,
                  pickFlash,
                  menuScale,
                  listTranslateY,
                  selectedRowScale,
                }}
              />
            </SceneChrome>
          </AbsoluteFill>
          </div>
        </div>
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 20,
          pointerEvents: "none",
          zIndex: 180,
          opacity: introGlow * introTitleOpacity,
          transform: `scale(${interpolate(introLogo, [0, 1], [0.88, 1])})`,
        }}
      >
        <div
          style={{
            fontSize: 88,
            fontWeight: 800,
            letterSpacing: "-0.04em",
            color: theme.colors.headerPrimary,
            textShadow: `0 0 60px ${theme.colors.accentGlow}, 0 0 120px rgba(99, 102, 241, 0.35)`,
          }}
        >
          Stoat
        </div>
        <div
          style={{
            fontSize: 32,
            fontWeight: 600,
            color: theme.colors.textNormal,
            letterSpacing: "-0.03em",
            textAlign: "center",
            maxWidth: 720,
            lineHeight: 1.25,
          }}
        >
          The fastest way to run commands
        </div>
        <div
          style={{
            marginTop: 12,
            width: 160,
            height: 5,
            borderRadius: 3,
            background: `linear-gradient(90deg, ${theme.colors.accent}, ${theme.colors.accentSecondary})`,
            boxShadow: `0 0 24px ${theme.colors.accentGlow}`,
          }}
        />
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          pointerEvents: "none",
          zIndex: 170,
          opacity: outroTextOpacity * outroLineOpacity,
        }}
      >
        <div
          style={{
            fontSize: 64,
            fontWeight: 800,
            letterSpacing: "-0.04em",
            color: theme.colors.headerPrimary,
            textShadow: `0 0 48px ${theme.colors.accentGlow}`,
          }}
        >
          Built for speed.
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 500,
            color: theme.colors.textMuted,
          }}
        >
          Slash commands, zero friction.
        </div>
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          zIndex: 150,
          backgroundColor: "#000",
          opacity: blackIntro,
          pointerEvents: "none",
        }}
      />
      <AbsoluteFill
        style={{
          zIndex: 220,
          backgroundColor: "#000",
          opacity: endBlack,
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};
