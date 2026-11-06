import { type PointerEvent, useEffect, useState } from "react";

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private window: this just resets next time */
  }
}

export interface WidthRange {
  key: string;
  fallback: number;
  min: number;
  max: number;
}

export const SIDEBAR: WidthRange = { key: "pdf-marker-sidebar", fallback: 272, min: 200, max: 600 };
export const PANEL: WidthRange = { key: "pdf-marker-panel", fallback: 340, min: 260, max: 760 };
export const REFERENCE: WidthRange = { key: "pdf-marker-reference", fallback: 420, min: 280, max: 1000 };
export const CHAT_HEIGHT: WidthRange = { key: "pdf-marker-chat-height", fallback: 0, min: 150, max: 800 };  // 0: half of the panel
export const REFERENCE_HEIGHT: WidthRange = { key: "pdf-marker-reference-height", fallback: 320, min: 140, max: 800 };

/** A panel width the person can drag, remembered in this browser. */
export function useWidth({ key, fallback, min, max }: WidthRange) {
  const [width, setRaw] = useState(fallback);
  useEffect(() => {
    const saved = Number(read(key));
    if (saved >= min && saved <= max) setRaw(saved);
  }, [key, min, max]);
  const setWidth = (next: number) => {
    const clamped = next === fallback ? fallback : Math.round(Math.min(max, Math.max(min, next)));
    setRaw(clamped);
    write(key, String(clamped));
  };
  return { width, setWidth };
}

interface Props {
  width: number | (() => number);  // a function when the size comes from the layout
  fallback: number;
  onResize: (width: number) => void;
  side: "left" | "right" | "top";  // the edge of the panel this handle sits on
}

export function Resizer({ width, fallback, onResize, side }: Props) {
  const begin = (event: PointerEvent<HTMLDivElement>) => {
    const handle = event.currentTarget;
    const position = (e: { clientX: number; clientY: number }) => (side === "top" ? e.clientY : e.clientX);
    const start = position(event);
    const from = typeof width === "function" ? width() : width;
    const direction = side === "right" ? 1 : -1;
    handle.setPointerCapture(event.pointerId);
    handle.onpointermove = (move) => onResize(from + direction * (position(move) - start));
    handle.onpointerup = () => {
      handle.onpointermove = null;
    };
  };
  return (
    <div
      className={`resizer ${side}`}
      role="separator"
      aria-orientation={side === "top" ? "horizontal" : "vertical"}
      aria-label={side === "top" ? "调整高度" : "调整宽度"}
      title={`拖动调整${side === "top" ? "高度" : "宽度"}，双击恢复默认`}
      onPointerDown={begin}
      onDoubleClick={() => onResize(fallback)}
    />
  );
}
