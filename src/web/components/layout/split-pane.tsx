import React from "react";

export interface SplitPaneProps {
  rail: React.ReactNode;
  main: React.ReactNode;
  aside: React.ReactNode;
}

export function SplitPane({ rail, main, aside }: SplitPaneProps): React.JSX.Element {
  return (
    <div className="workspace-home-grid">
      <div className="workspace-home-rail">{rail}</div>
      <div className="workspace-home-main">{main}</div>
      <div className="workspace-home-aside">{aside}</div>
    </div>
  );
}
