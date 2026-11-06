import { type PointerEvent, useEffect, useLayoutEffect, useRef } from "react";
import { GRADE_WIDTH, type Mark, type NoteMark, LEADER_WIDTH, bounds, gradeStrokes, leaderEnds } from "@/lib/marks";
import {
  deleteClaudeMark,
  doubleClick,
  finishEditing,
  moveNote,
  pointIn,
  pointerDown,
  pointerMove,
  pointerUp,
  setDraft,
  setNoteHeight,
  useStore,
} from "@/lib/store";

type State = ReturnType<typeof useStore>;

const HIT = { stroke: "transparent", strokeWidth: 10, fill: "none" };

function stampPath(m: { type: string; x: number; y: number; w: number; h: number }) {
  const at = (u: number, v: number) => `${m.x + u * m.w} ${m.y + v * m.h}`;
  return m.type === "tick" ? `M${at(0, 0.55)}L${at(0.35, 1)}L${at(1, 0)}` : `M${at(0, 0)}L${at(1, 1)}M${at(1, 0)}L${at(0, 1)}`;
}

function arrowHead(m: { x1: number; y1: number; x2: number; y2: number; width: number }) {
  const angle = Math.atan2(m.y2 - m.y1, m.x2 - m.x1);
  const size = 4 + m.width * 2;
  const wing = (side: number) =>
    `${m.x2 - size * Math.cos(angle + side)},${m.y2 - size * Math.sin(angle + side)}`;
  return `${m.x2},${m.y2} ${wing(0.45)} ${wing(-0.45)}`;
}

function Shape({ mark }: { mark: Exclude<Mark, NoteMark> }) {
  const stroke = {
    stroke: mark.color,
    strokeWidth: mark.width,
    fill: "none",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  } as const;
  if (mark.type === "highlight") {
    return <rect x={mark.x} y={mark.y} width={mark.w} height={mark.h} fill={mark.color} opacity={0.4} />;
  }
  if (mark.type === "line") {
    const ends = { x1: mark.x1, y1: mark.y1, x2: mark.x2, y2: mark.y2 };
    return (
      <>
        <line {...ends} {...HIT} />
        <line {...ends} {...stroke} />
        {mark.arrow && <polygon className="head" points={arrowHead(mark)} fill={mark.color} />}
      </>
    );
  }
  if (mark.type === "circle") {
    const shape = { cx: mark.x + mark.w / 2, cy: mark.y + mark.h / 2, rx: mark.w / 2, ry: mark.h / 2 };
    return (
      <>
        <ellipse {...shape} {...HIT} />
        <ellipse {...shape} {...stroke} />
      </>
    );
  }
  const d = stampPath(mark);
  return (
    <>
      <path d={d} {...HIT} />
      <path d={d} {...stroke} />
    </>
  );
}

function GradeStamp({ note }: { note: NoteMark }) {
  const d = gradeStrokes(note)
    .map((stroke) => "M" + stroke.map(([x, y]) => `${x} ${y}`).join("L"))
    .join("");
  return (
    <g className="gradeStamp" data-letter={note.text}>
      <rect x={note.x} y={note.y} width={note.w} height={note.h} fill="transparent" />
      <path d={d} fill="none" stroke={note.color} strokeWidth={GRADE_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

function NoteEditor({ note, draft }: { note: NoteMark; draft: string }) {
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // next frame: the mousedown that created this box would otherwise take the focus straight back
    const frame = requestAnimationFrame(() => box.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);
  useLayoutEffect(() => {
    const element = box.current!;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
    setNoteHeight(note.id, Math.ceil(element.offsetHeight));
  }, [draft, note.id, note.w]);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const grip = event.currentTarget;
    const svg = grip.closest("svg")!;
    const start = pointIn(svg, event);
    const { x, y } = note;
    grip.setPointerCapture(event.pointerId);
    grip.onpointermove = (move) => {
      const p = pointIn(svg, move);
      moveNote(note.id, x + p.x - start.x, y + p.y - start.y);
    };
    grip.onpointerup = () => {
      grip.onpointermove = null;
    };
  };

  return (
    <div className="noteWrap">
      {/* preventDefault keeps the typing focus in the box while it is dragged */}
      <div className="grip" title="拖动文本框" onMouseDown={(e) => e.preventDefault()} onPointerDown={startDrag} />
      <textarea
        ref={box}
        className="note"
        value={draft}
        placeholder="回车确认，Shift+回车换行"
        style={{ fontSize: note.size, color: note.color, minHeight: note.boxHeight }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={finishEditing}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          const confirm = e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing;
          if (confirm || e.key === "Escape") {
            e.preventDefault();
            finishEditing();
          }
        }}
      />
    </div>
  );
}

function NoteText({ note }: { note: NoteMark }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(
    () => setNoteHeight(note.id, Math.ceil(box.current!.offsetHeight)),
    [note.id, note.text, note.w, note.size, note.boxHeight],
  );
  return (
    <div ref={box} className="note" style={{ fontSize: note.size, color: note.color, minHeight: note.boxHeight }}>
      {note.text}
    </div>
  );
}

function Handles({ mark, zoom }: { mark: Mark; zoom: number }) {
  const scale = 1 / zoom;
  const handle = (name: string, x: number, y: number) => (
    <rect
      key={name}
      className="handle"
      data-handle={name}
      x={x - 4 * scale}
      y={y - 4 * scale}
      width={8 * scale}
      height={8 * scale}
      strokeWidth={1.5 * scale}
      style={{ cursor: name.startsWith("p") ? "move" : "nwse-resize" }}
    />
  );
  if (mark.type === "line") return [handle("p1", mark.x1, mark.y1), handle("p2", mark.x2, mark.y2)];
  const b = bounds(mark);
  return (
    <>
      <rect
        x={b.x}
        y={b.y}
        width={b.w}
        height={b.h}
        fill="none"
        stroke="#2f3437"
        strokeWidth={scale}
        strokeDasharray={4 * scale}
        pointerEvents="none"
      />
      {handle("nw", b.x, b.y)}
      {handle("ne", b.x + b.w, b.y)}
      {handle("sw", b.x, b.y + b.h)}
      {handle("se", b.x + b.w, b.y + b.h)}
    </>
  );
}

/* Just outside the top right corner of the mark or its note, clear of the resize handle.
   Fixed size on screen, whatever the zoom. */
function DeleteButton({ mark, note, zoom }: { mark: Mark; note?: Mark; zoom: number }) {
  const box = bounds(note ?? mark);
  return (
    <foreignObject x={box.x + box.w + 6 / zoom} y={box.y - 22 / zoom} width={18 / zoom} height={18 / zoom}>
      <div
        className="claudeDelete"
        style={{ transform: `scale(${1 / zoom})` }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button aria-label="删除这条批注" title="删除" onClick={() => deleteClaudeMark(mark.id)}>
          ×
        </button>
      </div>
    </foreignObject>
  );
}

interface Props {
  n: number;
  page: { w: number; h: number };
  state: State;
}

export function PageCanvas({ n, page, state }: Props) {
  const { file, marks, tool, zoom, editing, draft, selected } = state;
  const here = marks.filter((m) => m.page === n);
  const current = here.find((m) => m.id === selected);
  return (
    <div className="page" data-n={n} style={{ width: page.w * zoom, height: page.h * zoom }}>
      {/* a background, not an <img>: image translators would otherwise rewrite the student's work */}
      <div
        className="scan notranslate"
        translate="no"
        style={{ backgroundImage: `url("/api/page?file=${encodeURIComponent(file!)}&n=${n}&w=1800")` }}
      />
      <svg
        viewBox={`0 0 ${page.w} ${page.h}`}
        className={tool === "select" ? "" : tool === "text" ? "text" : "draw"}
        onPointerDown={(e) => pointerDown(e, n)}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onDoubleClick={doubleClick}
      >
        {here.map((m) => {
          const anchor = m.type === "text" && m.anchor ? marks.find((a) => a.id === m.anchor) : undefined;
          if (m.type !== "text" || !anchor) return null;
          return (
            <line
              key={m.id}
              {...leaderEnds(m, anchor)}
              data-leader={m.id}
              stroke={anchor.color}
              strokeWidth={LEADER_WIDTH}
              pointerEvents="none"
            />
          );
        })}
        {here.map((m) => (
          <g key={m.id} data-id={m.id}>
            {m.type === "text" && m.grade ? (
              <GradeStamp note={m} />
            ) : m.type === "text" ? (
              <foreignObject x={m.x} y={m.y} width={m.w} height={m.h}>
                {editing === m.id ? <NoteEditor note={m} draft={draft} /> : <NoteText note={m} />}
              </foreignObject>
            ) : (
              <Shape mark={m} />
            )}
          </g>
        ))}
        {current && editing !== current.id && <Handles mark={current} zoom={zoom} />}
        {here.map((m) =>
          m.fromClaude && !(m.type === "text" && m.anchor) && editing !== m.id ? (
            <DeleteButton
              key={m.id}
              mark={m}
              note={here.find((other) => other.type === "text" && other.anchor === m.id)}
              zoom={zoom}
            />
          ) : null,
        )}
      </svg>
    </div>
  );
}
