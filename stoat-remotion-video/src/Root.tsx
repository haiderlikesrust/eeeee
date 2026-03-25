import React from "react";
import { Composition, registerRoot } from "remotion";
import { SlashCommandsVideo } from "./Video";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="SlashCommands"
      component={SlashCommandsVideo}
      durationInFrames={540}
      fps={30}
      width={1920}
      height={1080}
    />
  </>
);

registerRoot(RemotionRoot);
