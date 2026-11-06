import type { CSSProperties, ReactNode } from "react";
import type { Tool } from "@/lib/marks";
import { deleteSelected, redo, save, setColor, setTool, togglePanel, undo, useStore } from "@/lib/store";

type State = ReturnType<typeof useStore>;

export const TOOLS: { name: Tool; label: string; key: string; icon: ReactNode }[] = [
  { name: "select", label: "选择", key: "V", icon: <path d="M5 3l14 9-6 1.5L10 20z" /> },
  { name: "tick", label: "打勾", key: "1", icon: <path d="M4 13l5 6L20 5" /> },
  { name: "cross", label: "打叉", key: "2", icon: <path d="M5 5l14 14M19 5L5 19" /> },
  {
    name: "highlight",
    label: "高亮",
    key: "3",
    icon: (
      <>
        <rect x="3" y="8" width="18" height="8" fill="#f4d35e" stroke="none" />
        <path d="M3 8h18M3 16h18" />
      </>
    ),
  },
  { name: "text", label: "批注", key: "4", icon: <path d="M4 5h16v11H10l-4 4v-4H4z" /> },
  { name: "circle", label: "画圈", key: "5", icon: <ellipse cx="12" cy="12" rx="9" ry="7" /> },
  { name: "line", label: "划线", key: "6", icon: <path d="M4 19L20 5" /> },
  { name: "arrow", label: "箭头", key: "7", icon: <path d="M4 20L20 4M10 4h10v10" /> },
];

const COLORS = ["#d92b2b", "#1f9d55", "#2563eb", "#ffd400"];

export function Toolbar({ state }: { state: State }) {
  const selected = state.marks.find((m) => m.id === state.selected);
  const activeColor = selected ? selected.color : state.tool === "select" ? null : state.toolColor[state.tool];
  return (
    <header>
      <div id="tools">
        {TOOLS.map((tool) => (
          <button
            key={tool.name}
            className={state.tool === tool.name ? "on" : ""}
            title={`${tool.label}（快捷键 ${tool.key}）`}
            aria-label={tool.label}
            onClick={() => setTool(tool.name)}
          >
            <svg viewBox="0 0 24 24">{tool.icon}</svg>
            <span className="label">{tool.label}</span>
            <kbd>{tool.key}</kbd>
          </button>
        ))}
      </div>
      <div id="colors">
        {COLORS.map((color) => (
          <button
            key={color}
            className={"swatch" + (color === activeColor ? " on" : "")}
            style={{ "--dot": color } as CSSProperties}
            title="颜色"
            aria-label={`颜色 ${color}`}
            onClick={() => setColor(color)}
          />
        ))}
      </div>
      <div className="history">
        <button title="撤销 Ctrl+Z" aria-label="撤销" disabled={!state.undo.length} onClick={undo}>
          <svg viewBox="0 0 24 24">
            <path d="M9 14L4 9l5-5" />
            <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
          </svg>
        </button>
        <button title="重做 Ctrl+Y" aria-label="重做" disabled={!state.redo.length} onClick={redo}>
          <svg viewBox="0 0 24 24">
            <path d="M15 14l5-5-5-5" />
            <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
          </svg>
        </button>
        <button title="删除选中 Delete" aria-label="删除选中" disabled={!state.selected} onClick={deleteSelected}>
          <svg viewBox="0 0 24 24">
            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
          </svg>
        </button>
      </div>
      <div className="end">
        <span id="status" className={state.status.error ? "error" : ""} title={state.status.text}>
          {state.status.text}
        </span>
        <button
          id="openPdf"
          title="在新标签页查看已保存的 PDF"
          disabled={!state.file}
          onClick={() => window.open("/pdf?file=" + encodeURIComponent(state.file!))}
        >
          查看 PDF
        </button>
        <button id="save" title="Ctrl+S" disabled={!state.file || !state.dirty} onClick={() => void save()}>
          保存
        </button>
        <button
          id="claudeToggle"
          className={state.panelOpen ? "on" : ""}
          title="打开或关闭 Claude 面板"
          onClick={togglePanel}
        >
          Claude
        </button>
      </div>
    </header>
  );
}
