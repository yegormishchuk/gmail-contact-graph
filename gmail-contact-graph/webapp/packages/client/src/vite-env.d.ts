/// <reference types="vite/client" />

// Graph.tsx exposes these D3-simulation controls on `window` so Controls.tsx
// and RankingPanel.tsx can drive the graph without prop-drilling through
// unrelated components. Typed here instead of `window as any` at each call site.
export {};
declare global {
  interface Window {
    resetGraphZoom?: () => void;
    focusGraphNode?: (
      email: string,
      onFound: (screenPos: { x: number; y: number }) => void,
      onNotFound?: () => void,
    ) => void;
    focusGroup?: (
      label: string,
      onFound: (screenPos: { x: number; y: number }) => void,
      onNotFound?: () => void,
    ) => void;
  }
}
