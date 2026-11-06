import { TOOLS } from "./Toolbar";

export function EmptyState({ hasWorkspace }: { hasWorkspace: boolean }) {
  return (
    <div id="empty">
      <h1>{hasWorkspace ? "打开一份 PDF" : "选择工作区"}</h1>
      <p>{hasWorkspace ? "从左侧的文件夹里选一份开始批改" : "选一个文件夹，下面的子文件夹和 PDF 都会列出来"}</p>
      <div className="keys">
        {TOOLS.map((tool) => (
          <span key={tool.name}>
            <kbd>{tool.key}</kbd>
            {tool.label}
          </span>
        ))}
      </div>
    </div>
  );
}
