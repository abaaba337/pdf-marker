"use client";

import { type CSSProperties, useEffect } from "react";
import { EmptyState } from "@/components/EmptyState";
import { PageCanvas } from "@/components/PageCanvas";
import { Sidebar, useSidebarWidth } from "@/components/Sidebar";
import { TOOLS, Toolbar } from "@/components/Toolbar";
import { ZoomControl } from "@/components/ZoomControl";
import { deleteSelected, loadTree, redo, save, setTool, undo, useStore } from "@/lib/store";

export default function Home() {
  const state = useStore();
  const { width, setWidth } = useSidebarWidth();

  useEffect(() => {
    void loadTree();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).matches("textarea, select, input")) return;
      const command = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (command && key === "s") {
        event.preventDefault();
        void save();
      } else if (command && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (command && key === "y") {
        event.preventDefault();
        redo();
      } else if (command) {
        return;
      } else if (key === "delete" || key === "backspace") {
        deleteSelected();
      } else if (key === "escape") {
        setTool("select");
      } else {
        const match = TOOLS.find((tool) => tool.key.toLowerCase() === key);
        if (match) setTool(match.name);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (state.dirty) event.preventDefault();
    };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [state.dirty]);

  return (
    <div className="app" style={{ "--sidebar": `${width}px` } as CSSProperties}>
      <Sidebar state={state} width={width} onResize={setWidth} />
      <Toolbar state={state} />
      <main id="main">
        {state.file ? (
          state.pages.map((page, n) => <PageCanvas key={`${state.file}:${n}`} n={n} page={page} state={state} />)
        ) : (
          state.loaded && <EmptyState hasWorkspace={Boolean(state.root)} />
        )}
      </main>
      {state.file && <ZoomControl zoom={state.zoom} />}
    </div>
  );
}
