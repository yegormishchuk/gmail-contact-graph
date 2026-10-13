/** Rope labels are 11px semibold; this approximates a character's width in graph units. */
export const LABEL_CHAR_WIDTH = 6.5;
export const LABEL_PADDING = 4;
export const LABEL_HEIGHT = 14;

export interface RopeEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface RopeLabelInput {
  edges: RopeEdge[];
  /** Estimated label width in graph units. */
  width: number;
  /** Edge the label sat on last time, or null. */
  current: number | null;
}

/**
 * Picks an edge for each rope's label so no two labels overlap. Ropes come in
 * rank order and earlier ones win. A label keeps its previous edge while that is
 * still free, so labels don't jump around while the simulation moves. A rope
 * with no free edge gets null: its label hides and the rope stays.
 *
 * Boxes are centred on edge midpoints and compared in graph coordinates, so the
 * result doesn't depend on zoom.
 */
export function placeRopeLabels(ropes: RopeLabelInput[]): (number | null)[] {
  const placed: { x: number; y: number; width: number }[] = [];

  return ropes.map(rope => {
    const box = (i: number) => {
      const e = rope.edges[i];
      return { x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2, width: rope.width };
    };
    const free = (i: number) => {
      const b = box(i);
      return !placed.some(p =>
        Math.abs(p.x - b.x) < (p.width + b.width) / 2 && Math.abs(p.y - b.y) < LABEL_HEIGHT,
      );
    };

    const all = rope.edges.map((_, i) => i);
    const order = rope.current !== null && rope.current < rope.edges.length
      ? [rope.current, ...all]
      : all;
    const edge = order.find(free);
    if (edge === undefined) return null;
    placed.push(box(edge));
    return edge;
  });
}
