import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { type FileRow, type Group, openFile, pickWorkspace, useStore } from "@/lib/store";

type State = ReturnType<typeof useStore>;

const MIN_WIDTH = 200;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 272;
const WIDTH_KEY = "pdf-marker-sidebar";

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

export function useSidebarWidth() {
  const [width, setRaw] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    const saved = Number(read(WIDTH_KEY));
    if (saved >= MIN_WIDTH && saved <= MAX_WIDTH) setRaw(saved);
  }, []);
  const setWidth = (next: number) => {
    const clamped = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)));
    setRaw(clamped);
    write(WIDTH_KEY, String(clamped));
  };
  return { width, setWidth };
}

interface Folder {
  folders: Map<string, Folder>;
  files: FileRow[];
}

function buildTree(groups: Group[]) {
  const top: Folder = { folders: new Map(), files: [] };
  for (const { dir, files } of groups) {
    let node = top;
    for (const name of dir === "." ? [] : dir.split("/")) {
      if (!node.folders.has(name)) node.folders.set(name, { folders: new Map(), files: [] });
      node = node.folders.get(name)!;
    }
    node.files = files;
  }
  return top;
}

function FileButton({ row, active }: { row: FileRow; active: boolean }) {
  return (
    <button className={"file" + (active ? " on" : "")} title={row.name} onClick={() => void openFile(row.file)}>
      <span className="name">{row.name}</span>
      {row.marks > 0 && <span className="badge">{row.marks}</span>}
    </button>
  );
}

interface TreeProps {
  node: Folder;
  path: string;
  file: string | null;
  open: Set<string>;
  onToggle: (path: string, isOpen: boolean) => void;
}

function Tree({ node, path, file, open, onToggle }: TreeProps) {
  const names = [...node.folders.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return (
    <>
      {names.map((name) => {
        const child = path ? `${path}/${name}` : name;
        return (
          <details key={child} open={open.has(child)} onToggle={(e) => onToggle(child, e.currentTarget.open)}>
            <summary title={child}>
              <span className="name">{name}</span>
            </summary>
            <div className="children">
              <Tree node={node.folders.get(name)!} path={child} file={file} open={open} onToggle={onToggle} />
            </div>
          </details>
        );
      })}
      {node.files.map((row) => (
        <FileButton key={row.file} row={row} active={row.file === file} />
      ))}
    </>
  );
}

/* Folders start closed; the ones opened are remembered per workspace in this browser. */
function useOpenFolders(root: string | null) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const latest = useRef(open);  // two toggles can land before the next render
  const key = "pdf-marker-open:" + root;
  const replace = (next: Set<string>) => {
    latest.current = next;
    setOpen(next);
  };
  useEffect(() => {
    try {
      replace(new Set(JSON.parse(read(key) ?? "[]")));
    } catch {
      replace(new Set());
    }
  }, [key]);
  const toggle = (path: string, isOpen: boolean) => {
    if (latest.current.has(path) === isOpen) return;
    const next = new Set(latest.current);
    if (isOpen) next.add(path);
    else next.delete(path);
    write(key, JSON.stringify([...next]));  // now, not at the next render: a reload must not lose it
    replace(next);
  };
  return { open, toggle };
}

interface SidebarProps {
  state: State;
  width: number;
  onResize: (width: number) => void;
}

export function Sidebar({ state, width, onResize }: SidebarProps) {
  const { root, groups, file, loaded } = state;
  const tree = useMemo(() => buildTree(groups), [groups]);
  const { open, toggle } = useOpenFolders(root);
  const parts = root ? root.split(/[\\/]/).filter(Boolean) : [];

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    const handle = event.currentTarget;
    const startX = event.clientX;
    handle.setPointerCapture(event.pointerId);
    handle.onpointermove = (move) => onResize(width + move.clientX - startX);
    handle.onpointerup = () => {
      handle.onpointermove = null;
    };
  };

  return (
    <aside>
      <div id="brand">PDF Marker</div>
      <button id="pick" className={root ? "" : "primary"} title={root ?? ""} onClick={() => void pickWorkspace()}>
        <span className="where">
          <span id="pickName">{parts.at(-1) ?? "选择工作区"}</span>
          <span id="root">{parts.slice(-3, -1).join(" / ")}</span>
        </span>
        <span className="change">更换</span>
      </button>
      <div id="files">
        <Tree node={tree} path="" file={file} open={open} onToggle={toggle} />
        {loaded && root && !groups.length && <p className="none">这个文件夹下没有 PDF</p>}
      </div>
      <div
        id="resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧栏宽度"
        title="拖动调整宽度，双击恢复默认"
        onPointerDown={startResize}
        onDoubleClick={() => onResize(DEFAULT_WIDTH)}
      />
    </aside>
  );
}
