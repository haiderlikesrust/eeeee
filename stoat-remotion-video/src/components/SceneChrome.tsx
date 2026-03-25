import React from "react";
import "./video-ui.css";

type Props = {
  channelTitle?: string;
  parallaxX?: number;
  children?: React.ReactNode;
};

export const SceneChrome: React.FC<Props> = ({
  channelTitle = "# product",
  parallaxX = 0,
  children,
}) => (
  <div className="stoat-scene-chrome stoat-remotion-root">
    <div
      className="stoat-scene-chrome__sidebar"
      style={{ transform: `translateX(${parallaxX * 0.4}px)` }}
    >
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="stoat-scene-chrome__orb" />
      ))}
    </div>
    <div
      className="stoat-scene-chrome__main"
      style={{ transform: `translateX(${parallaxX * -0.15}px)` }}
    >
      <div className="stoat-scene-chrome__header">{channelTitle}</div>
      <div className="stoat-scene-chrome__body" />
      {children}
    </div>
  </div>
);
