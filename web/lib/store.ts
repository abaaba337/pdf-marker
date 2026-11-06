import type { PointerEvent as ReactPointerEvent } from "react";
import { useSyncExternalStore } from "react";
import {
  GRADE_WIDTH,
  LEADER_WIDTH,
  LINE_WIDTH,
  type Mark,
  type MarkType,
  MIN_DRAG,
  NOTE_AFTER,
  NOTE_SIZE,
  NOTE_WIDTH,
  type NoteMark,
  STAMP_SIZE,
  STAMP_WIDTH,
  gradeStrokes,
  type Tool,
  leaderEnds,
  notePlace,
  resized,
} from "./marks";

export interface FileRow {
  file: string;
  name: string;
  marks: number;
  grade: string | null;
}

export interface Group {
  dir: string;
  files: FileRow[];
}

export interface ClaudeNote {
  kind: "note" | "thought" | "read" | "run" | "output";
  text: string;
}

export interface ClaudeResult {
  state: "idle" | "running" | "done" | "failed";
  summary: string;
  marks: Mark[];
  log: ClaudeNote[];
  draft: string;
  error: string;
  rejected: string[];
}

const NO_CLAUDE: ClaudeResult = { state: "idle", summary: "", marks: [], log: [], draft: "", error: "", rejected: [] };

export type ReferenceView =
  | { kind: "pages"; pages: { w: number; h: number }[] }
  | { kind: "code"; text: string; language: string }
  | { kind: "html"; text: string }
  | { kind: "notebook"; cells: { type: string; source: string; output: string }[] };

interface State {
  reference: { name: string; view: ReferenceView } | null;
  cancelling: boolean;
  panelOpen: boolean;
  references: string[];
  instruction: string;
  claude: ClaudeResult;
  root: string | null;
  groups: Group[];
  loaded: boolean;
  file: string | null;
  pages: { w: number; h: number }[];
  marks: Mark[];
  selected: string | null;
  tool: Tool;
  toolColor: Record<MarkType, string>;
  zoom: number;
  dirty: boolean;
  undo: Mark[][];
  redo: Mark[][];
  editing: string | null;
  draft: string;
  status: { text: string; error: boolean };
}

let state: State = {
  reference: null,
  cancelling: false,
  panelOpen: true,
  references: [],
  instruction: "",
  claude: NO_CLAUDE,
  root: null,
  groups: [],
  loaded: false,
  file: null,
  pages: [],
  marks: [],
  selected: null,
  tool: "select",
  toolColor: { tick: "#1f9d55", cross: "#d92b2b", highlight: "#ffd400", text: "#d92b2b", circle: "#d92b2b", line: "#d92b2b", arrow: "#d92b2b" },
  zoom: 1,
  dirty: false,
  undo: [],
  redo: [],
  editing: null,
  draft: "",
  status: { text: "", error: false },
};

const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStore() {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

const markById = (id: string | null | undefined) => state.marks.find((m) => m.id === id);
const patchMark = (id: string, patch: object) =>
  state.marks.map((m) => (m.id === id ? ({ ...m, ...patch } as Mark) : m));

function status(text: string, error = false) {
  set({ status: { text, error } });
}

/* Every finished change goes through here so undo always has the previous state. */
function commit(marks: Mark[], before: Mark[] = state.marks, extra: Partial<State> = {}) {
  set({
    marks,
    undo: [...state.undo, before],
    redo: [],
    dirty: true,
    status: { text: "有未保存的修改", error: false },
    ...extra,
  });
}

export function undo() {
  step("undo", "redo");
}

export function redo() {
  step("redo", "undo");
}

function step(from: "undo" | "redo", to: "undo" | "redo") {
  if (!state[from].length) return;
  finishEditing();
  const marks = state[from].at(-1)!;
  set({
    marks,
    [from]: state[from].slice(0, -1),
    [to]: [...state[to], state.marks],
    selected: marks.some((m) => m.id === state.selected) ? state.selected : null,
    dirty: true,
    status: { text: "有未保存的修改", error: false },
  });
}

/* ---------- comment text ---------- */
let noteBefore: Mark[] = [];

function editNote(id: string, before: Mark[]) {
  const note = markById(id) as NoteMark;
  if (note.grade) return;  // a grade changes through the grade bar
  noteBefore = before;
  set({ editing: id, selected: id, draft: note.text });
}

function openNote(page: number, x: number, y: number, color: string, anchor?: string) {
  const before = state.marks;
  const note: NoteMark = {
    id: crypto.randomUUID(),
    type: "text",
    page,
    color,
    x,
    y,
    w: NOTE_WIDTH,
    h: 20,
    size: NOTE_SIZE,
    text: "",
    ...(anchor ? { anchor } : {}),
  };
  set({ marks: [...state.marks, note] });
  editNote(note.id, before);
}

export function setDraft(draft: string) {
  set({ draft });
}

export function finishEditing() {
  const id = state.editing;
  if (!id) return;
  const before = noteBefore;
  const text = state.draft;
  const note = markById(id) as NoteMark;
  const previous = before.find((m) => m.id === id) as NoteMark | undefined;
  const selected = state.tool === "select" ? id : null;  // keep marking: no handles on the finished note
  const unchanged = previous && text.trim() === previous.text.trim() && note.x === previous.x && note.y === previous.y;
  if (unchanged || (!previous && !text.trim())) {
    set({ marks: before, editing: null, selected: previous ? selected : null });
  } else if (text.trim()) {
    commit(patchMark(id, { text: text.trimEnd() }), before, { editing: null, selected });
  } else {
    commit(state.marks.filter((m) => m.id !== id), before, { editing: null, selected: null });
    rememberRejected([id]);
  }
}

export function moveNote(id: string, x: number, y: number) {
  set({ marks: patchMark(id, { x, y }) });
}

/* Measured by the page, so it is not a change of the document. */
export function setNoteHeight(id: string, h: number) {
  const note = markById(id);
  if (note && note.type === "text" && note.h !== h) set({ marks: patchMark(id, { h }) });
}

/* ---------- pointer ---------- */
interface Point {
  x: number;
  y: number;
}

interface Gesture {
  kind: "draw" | "move" | "resize";
  svg: SVGSVGElement;
  start: Point;
  page: number;
  before: Mark[];
  handle?: string;
  original?: Mark;
  markId?: string;
  changed?: boolean;
}

let gesture: Gesture | null = null;

export function pointIn(svg: SVGSVGElement, event: { clientX: number; clientY: number }): Point {
  const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM()!.inverse());
  return { x: p.x, y: p.y };
}

function newMark(type: MarkType, page: number, fields: object): Mark {
  const width = type === "tick" || type === "cross" ? STAMP_WIDTH : type === "highlight" ? undefined : LINE_WIDTH;
  return {
    id: crypto.randomUUID(),
    type: type === "arrow" ? "line" : type,
    page,
    color: state.toolColor[type],
    ...(width ? { width } : {}),
    ...(type === "arrow" ? { arrow: true } : {}),
    ...fields,
  } as Mark;
}

function noteBeside(mark: Mark) {
  const { x, y } = notePlace(mark, state.pages[mark.page]);
  openNote(mark.page, x, y, mark.color, mark.id);
}

export function pointerDown(event: ReactPointerEvent<SVGSVGElement>, page: number) {
  if (event.button !== 0) return;
  const target = event.target as SVGElement;
  const handle = target.dataset?.handle;
  const id = target.closest("[data-id]")?.getAttribute("data-id");
  finishEditing();
  const svg = event.currentTarget;
  const start = pointIn(svg, event);
  svg.setPointerCapture(event.pointerId);

  const { tool } = state;
  if (tool === "select" || markById(id)?.type === "text") {  // notes can be dragged under any tool
    if (!handle && id !== state.selected) set({ selected: id ?? null });
    const original = markById(state.selected);
    if (original) gesture = { kind: handle ? "resize" : "move", handle, svg, start, page, before: state.marks, original };
    return;
  }
  if (tool === "tick" || tool === "cross") {
    const half = STAMP_SIZE / 2;
    const mark = newMark(tool, page, { x: start.x - half, y: start.y - half, w: STAMP_SIZE, h: STAMP_SIZE });
    commit([...state.marks, mark]);
    if (NOTE_AFTER.has(tool)) noteBeside(mark);
    return;
  }
  if (tool === "text") {
    openNote(page, start.x, start.y, state.toolColor.text);
    return;
  }
  gesture = { kind: "draw", svg, start, page, before: state.marks };
}

export function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
  if (!gesture) return;
  const p = pointIn(gesture.svg, event);
  const dx = p.x - gesture.start.x;
  const dy = p.y - gesture.start.y;
  if (gesture.kind === "draw") {
    const shape =
      state.tool === "line" || state.tool === "arrow"
        ? { x1: gesture.start.x, y1: gesture.start.y, x2: p.x, y2: p.y }
        : { x: Math.min(p.x, gesture.start.x), y: Math.min(p.y, gesture.start.y), w: Math.abs(dx), h: Math.abs(dy) };
    if (gesture.markId) {
      set({ marks: patchMark(gesture.markId, shape) });
    } else if (Math.hypot(dx, dy) >= MIN_DRAG) {
      const mark = newMark(state.tool as MarkType, gesture.page, shape);
      gesture.markId = mark.id;
      set({ marks: [...state.marks, mark], selected: null });
    }
    return;
  }
  const original = gesture.original!;
  let patch: object;
  if (gesture.kind === "move") {
    patch =
      original.type === "line"
        ? { x1: original.x1 + dx, y1: original.y1 + dy, x2: original.x2 + dx, y2: original.y2 + dy }
        : { x: original.x + dx, y: original.y + dy };
  } else if (original.type === "line") {
    patch = gesture.handle === "p1" ? { x1: p.x, y1: p.y } : { x2: p.x, y2: p.y };
  } else {
    patch = resized(original, gesture.handle!, p);
  }
  gesture.changed = true;
  set({ marks: patchMark(original.id, patch) });
}

export function pointerUp() {
  if (!gesture) return;
  const { kind, before, markId, changed, original } = gesture;
  gesture = null;
  if ((kind === "draw" && markId) || changed) commit(state.marks, before);
  const drawn = markById(markId);
  if (drawn && NOTE_AFTER.has(drawn.type)) noteBeside(drawn);
  if (kind === "move" && state.tool !== "select" && original) {  // a note under a drawing tool: click edits, drag just moves
    if (changed) set({ selected: null });
    else editNote(original.id, state.marks);
  }
}

export function doubleClick() {
  const mark = markById(state.selected);
  if (state.tool === "select" && mark?.type === "text") editNote(mark.id, state.marks);
}

/* ---------- commands ---------- */
export function setTool(tool: Tool) {
  finishEditing();
  set({ tool, selected: tool === "select" ? state.selected : null });
}

export function setColor(color: string) {
  const current = markById(state.selected);
  if (current) {
    commit(patchMark(current.id, { color }), state.marks, {
      toolColor: { ...state.toolColor, [current.type]: color },
    });
  } else if (state.tool !== "select") {
    set({ toolColor: { ...state.toolColor, [state.tool]: color } });
  }
}

export function deleteSelected() {
  const { selected } = state;
  if (!selected) return;
  // a mark takes its note with it
  commit(state.marks.filter((m) => m.id !== selected && !(m.type === "text" && m.anchor === selected)), state.marks, {
    selected: null,
  });
  rememberRejected([selected]);
}

export function stepZoom(factor: number) {
  set({ zoom: Math.min(4, Math.max(0.3, state.zoom * factor)) });
}

/* ---------- files ---------- */
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

const post = (body: object) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function loadTree() {
  try {
    const tree = await api<{ root: string | null; groups: Group[] }>("/api/tree");
    set({ ...tree, loaded: true });
  } catch (error) {
    set({ loaded: true });
    status(String((error as Error).message), true);
  }
}

export async function save() {
  finishEditing();
  if (!state.file || !state.dirty) return true;
  status("保存中…");
  const marks = state.marks.map((mark) => {
    if (mark.type !== "text") return mark;
    const { leader, ...note } = mark;
    if (note.grade) return { ...note, ink: gradeStrokes(note), width: GRADE_WIDTH };
    const anchor = markById(note.anchor);
    return anchor
      ? { ...note, leader: { ...leaderEnds(mark, anchor), color: anchor.color, width: LEADER_WIDTH } }
      : note;
  });
  try {
    const result = await api<{ saved: number }>("/api/save", post({ file: state.file, marks }));
    set({ dirty: false, status: { text: `已保存 ${result.saved} 处批注`, error: false } });
    await loadTree();
    return true;
  } catch (error) {
    status("保存失败：" + (error as Error).message, true);
    return false;
  }
}

export async function openFile(next: string) {
  if (next === state.file || !(await save())) return;
  try {
    const doc = await api<{ pages: State["pages"]; marks: Mark[] }>("/api/doc?file=" + encodeURIComponent(next));
    const main = document.getElementById("main")!;
    const widest = Math.max(...doc.pages.map((p) => p.w));
    set({
      file: next,
      pages: doc.pages,
      marks: doc.marks,
      selected: null,
      undo: [],
      redo: [],
      dirty: false,
      claude: NO_CLAUDE,
      zoom: fitZoom(main, widest),
      status: { text: doc.marks.length ? `已载入 ${doc.marks.length} 处批注，可继续修改` : "", error: false },
    });
    main.scrollTop = 0;
    void loadClaude();
    void loadGuidance();
  } catch (error) {
    status("打不开这个文件：" + (error as Error).message, true);
  }
}

export async function pickWorkspace() {
  if (!(await save())) return;
  status("请在弹出的窗口里选择文件夹");
  try {
    const result = await api<{ changed: boolean }>("/api/workspace", post({}));
    status("");
    if (!result.changed) return;
    set({ file: null, pages: [], marks: [], selected: null, undo: [], redo: [], claude: NO_CLAUDE, reference: null });
    await loadTree();
    await loadReferences();
  } catch (error) {
    status("选择失败：" + (error as Error).message, true);
  }
}

/* ---------- Claude ---------- */
function fitZoom(main: HTMLElement, widest: number) {
  // padding + scrollbar; below this the work is unreadable, so the page scrolls sideways instead
  return Math.max(0.55, Math.min(1.6, (main.clientWidth - 88) / widest));
}

/* After a side column changes the space, once the layout has settled. */
export function refit() {
  requestAnimationFrame(() => {
    const main = document.getElementById("main");
    if (main && state.pages.length) set({ zoom: fitZoom(main, Math.max(...state.pages.map((p) => p.w))) });
  });
}

export function togglePanel() {
  set({ panelOpen: !state.panelOpen });
  refit();
}

export function setInstruction(instruction: string) {
  set({ instruction });
}

export async function loadReferences() {
  try {
    const references = await api<string[]>("/api/reference");
    set({ references });
    if (state.reference && !references.includes(state.reference.name)) closeReference();
  } catch {
    set({ references: [] });
  }
}

export async function uploadReferences(files: File[]) {
  for (const file of files) {
    const url = `/api/reference?name=${encodeURIComponent(file.name)}`;
    try {
      await api(url, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
    } catch (error) {
      status(`${file.name} 上传失败：${(error as Error).message}`, true);
    }
  }
  await loadReferences();
}

export async function openReference(name: string) {
  try {
    const url = "/api/reference/view?name=" + encodeURIComponent(name);
    set({ reference: { name, view: await api<ReferenceView>(url) } });
    refit();
  } catch (error) {
    status(`打不开 ${name}：${(error as Error).message}`, true);
  }
}

export function closeReference() {
  set({ reference: null });
  refit();
}

export const referencePage = (name: string, n: number) =>
  `/api/reference/page?name=${encodeURIComponent(name)}&n=${n}&w=1400`;

export async function removeReference(name: string) {
  await api("/api/reference/delete", post({ name }));
  await loadReferences();
}

let poll: ReturnType<typeof setTimeout> | undefined;

async function loadClaude() {
  const { file } = state;
  clearTimeout(poll);
  if (!file) return;
  const claude = await api<ClaudeResult>("/api/claude?file=" + encodeURIComponent(file));
  if (file !== state.file) return;
  const seen = state.claude.marks.length;
  set({ claude, cancelling: claude.state === "running" && state.cancelling });
  mergeClaude();
  if (claude.state !== "running") return;
  poll = setTimeout(() => void loadClaude(), 600);
  const newest = claude.marks.at(-1);
  if (newest && claude.marks.length > seen) followPage(newest.page);
}

/* Bring the page Claude has reached into view, without fighting the reader within a page. */
let followed = -1;

function followPage(page: number) {
  if (page === followed) return;
  followed = page;
  document.querySelector(`.page[data-n="${page}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export async function loadGuidance() {
  try {
    const { text } = await api<{ text: string }>("/api/guidance");
    set({ instruction: text });
  } catch {
    set({ instruction: "" });
  }
}

export async function saveGuidance() {
  await api("/api/guidance", post({ text: state.instruction }));
}

export async function startClaude() {
  if (!state.file) return;
  followed = -1;
  await saveGuidance();
  const others = state.marks.filter((mark) => !mark.fromClaude);
  if (others.length < state.marks.length) commit(others);  // a new run replaces the last one; undo brings it back
  set({ claude: { ...NO_CLAUDE, state: "running" } });
  try {
    await api("/api/claude/mark", post({ file: state.file }));
    await loadClaude();
  } catch (error) {
    set({ claude: { ...NO_CLAUDE, state: "failed", error: (error as Error).message } });
  }
}

export async function cancelClaude() {
  set({ cancelling: true });
  await api("/api/claude/cancel", post({ file: state.file }));
  await loadClaude();
}

/* A mark and the note attached to it stand or fall together. */
const belongsTo = (mark: Mark, id: string) => mark.id === id || (mark.type === "text" && mark.anchor === id);

function standing({ marks, rejected }: ClaudeResult) {
  return marks.filter((mark) => !rejected.some((id) => belongsTo(mark, id)));
}

const isRow = (mark: Mark) => !(mark.type === "text" && mark.anchor);
const isGrade = (mark: Mark) => mark.type === "text" && Boolean(mark.grade);

/* One grade per submission: picking another replaces it, and picking the same one clears it. */
export function setGrade(letter: string) {
  const current = state.marks.find(isGrade) as NoteMark | undefined;
  const others = state.marks.filter((mark) => !isGrade(mark));
  if (current?.text === letter) {
    commit(others);
    rememberRejected([current.id]);
    return;
  }
  const page = state.pages[0];
  const stamp: NoteMark = current
    ? { ...current, text: letter, fromClaude: false }
    : {
        id: crypto.randomUUID(),
        type: "text",
        page: 0,
        color: "#d92b2b",
        x: page.w - 86,
        y: 14,
        w: 70,
        h: 52,
        size: 24,
        text: letter,
        grade: true,
      };
  commit([...others, stamp]);
}

/* Claude's marks count from the moment they arrive: they are ordinary marks, and go if deleted. */
function mergeClaude() {
  const graded = state.marks.some(isGrade);  // Claude never overrides a grade already given
  const added = standing(state.claude)
    .filter((mark) => !markById(mark.id) && !(graded && isGrade(mark)))
    .map((mark) => ({ ...mark, fromClaude: true }));
  if (added.length) {
    set({ marks: [...state.marks, ...added], dirty: true, status: { text: "有未保存的修改", error: false } });
  }
}

function setRejected(rejected: string[]) {
  set({ claude: { ...state.claude, rejected } });
  void api("/api/claude/reject", post({ file: state.file, ids: rejected }));
}

/* A deleted mark of Claude's stays deleted, or the next update would bring it back. */
function rememberRejected(ids: string[]) {
  const known = new Set(state.claude.marks.map((mark) => mark.id));
  const added = ids.filter((id) => known.has(id) && !state.claude.rejected.includes(id));
  if (added.length) setRejected([...state.claude.rejected, ...added]);
}

export function deleteClaudeMark(id: string) {
  const gone = markById(state.selected);
  commit(state.marks.filter((mark) => !belongsTo(mark, id)), state.marks, {
    selected: gone && belongsTo(gone, id) ? null : state.selected,
  });
  rememberRejected([id]);
}

export function deleteAllClaude() {
  const ids = state.marks.filter((mark) => mark.fromClaude && isRow(mark)).map((mark) => mark.id);
  commit(state.marks.filter((mark) => !mark.fromClaude));
  rememberRejected(ids);
}

export function restoreMark(id: string) {
  setRejected(state.claude.rejected.filter((item) => item !== id));
  mergeClaude();
}
