export type Tool = "select" | "tick" | "cross" | "highlight" | "text" | "circle" | "line" | "arrow";
export type MarkType = Exclude<Tool, "select">;

interface Base {
  id: string;
  page: number;
  color: string;
  fromClaude?: boolean;  // gets a delete button on the page
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Ends {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Leader extends Ends {
  color: string;
  width: number;
}

export interface BoxMark extends Base, Box {
  type: "tick" | "cross" | "highlight" | "circle";
  width?: number;
}

export interface LineMark extends Base, Ends {
  type: "line";
  width: number;
  arrow?: boolean;  // a head at the x2, y2 end
}

export interface NoteMark extends Base, Box {
  type: "text";
  size: number;
  text: string;
  anchor?: string;
  leader?: Leader;
}

export type Mark = BoxMark | LineMark | NoteMark;

export const STAMP_SIZE = 14;
export const STAMP_WIDTH = 1.5;
export const LINE_WIDTH = 2;
export const LEADER_WIDTH = 0.6;
export const MIN_DRAG = 5;
export const NOTE_WIDTH = 190;
export const NOTE_SIZE = 11;
export const NOTE_GAP = 24;
export const NOTE_AFTER = new Set<string>(["cross", "circle", "line", "arrow"]);

export function bounds(mark: Mark): Box {
  if (mark.type !== "line") return { x: mark.x, y: mark.y, w: mark.w, h: mark.h };
  return {
    x: Math.min(mark.x1, mark.x2),
    y: Math.min(mark.y1, mark.y2),
    w: Math.abs(mark.x2 - mark.x1),
    h: Math.abs(mark.y2 - mark.y1),
  };
}

/** Beside the mark, or on its left when the right side would run off the page. */
export function notePlace(mark: Mark, page: { w: number; h: number }) {
  const box = bounds(mark);
  const right = box.x + box.w + NOTE_GAP;
  const x = right + NOTE_WIDTH <= page.w ? right : Math.max(0, box.x - NOTE_GAP - NOTE_WIDTH);
  return { x, y: Math.min(box.y, page.h - 30) };
}

/** Thin line from a mark to its note, like a Word comment. */
export function leaderEnds(note: NoteMark, anchor: Mark): Ends {
  const midX = note.x + note.w / 2;
  const midY = note.y + note.h / 2;
  let from: { x: number; y: number };
  if (anchor.type === "line") {
    const gap = (x: number, y: number) => Math.hypot(x - midX, y - midY);
    from =
      gap(anchor.x1, anchor.y1) < gap(anchor.x2, anchor.y2)
        ? { x: anchor.x1, y: anchor.y1 }
        : { x: anchor.x2, y: anchor.y2 };
  } else {
    const rx = anchor.w / 2;
    const ry = anchor.h / 2;
    const cx = anchor.x + rx;
    const cy = anchor.y + ry;
    if (anchor.type === "circle") {
      const angle = Math.atan2((midY - cy) / ry, (midX - cx) / rx);
      from = { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
    } else {
      from = { x: cx, y: cy };
    }
  }
  const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
  return {
    x1: from.x,
    y1: from.y,
    x2: clamp(from.x, note.x, note.x + note.w),
    y2: clamp(from.y, note.y, note.y + note.h),
  };
}

export function resized(box: Box, handle: string, p: { x: number; y: number }): Box {
  const left = handle.includes("w") ? Math.min(p.x, box.x + box.w - MIN_DRAG) : box.x;
  const right = handle.includes("e") ? Math.max(p.x, box.x + MIN_DRAG) : box.x + box.w;
  const top = handle.includes("n") ? Math.min(p.y, box.y + box.h - MIN_DRAG) : box.y;
  const bottom = handle.includes("s") ? Math.max(p.y, box.y + MIN_DRAG) : box.y + box.h;
  return { x: left, y: top, w: right - left, h: bottom - top };
}
