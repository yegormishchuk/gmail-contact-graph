export interface Circle {
  x: number;
  y: number;
  r: number;
}

/**
 * The zoom (translate x, y then scale k) that fits every circle in a
 * width × height view, leaving `margin` px around them. k is clamped to
 * [minScale, maxScale], so a graph too big to fit stays centred, cut off.
 */
export function fitTransform(
  circles: Circle[],
  width: number,
  height: number,
  minScale: number,
  maxScale: number,
  margin = 24,
): { x: number; y: number; k: number } {
  if (circles.length === 0) return { x: 0, y: 0, k: 1 };
  const x0 = Math.min(...circles.map(c => c.x - c.r));
  const x1 = Math.max(...circles.map(c => c.x + c.r));
  const y0 = Math.min(...circles.map(c => c.y - c.r));
  const y1 = Math.max(...circles.map(c => c.y + c.r));
  const fit = Math.min(
    (width - 2 * margin) / Math.max(x1 - x0, 1),
    (height - 2 * margin) / Math.max(y1 - y0, 1),
  );
  const k = Math.max(minScale, Math.min(maxScale, fit));
  return {
    x: width / 2 - k * (x0 + x1) / 2,
    y: height / 2 - k * (y0 + y1) / 2,
    k,
  };
}
