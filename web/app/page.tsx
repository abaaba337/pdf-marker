"use client";

import { type CSSProperties, useEffect, useState } from "react";
import { ClaudePanel } from "@/components/ClaudePanel";
import { EmptyState } from "@/components/EmptyState";
import { GradeBar } from "@/components/GradeBar";
import { PageCanvas } from "@/components/PageCanvas";
import { ReferencePane } from "@/components/ReferencePane";
import { PANEL, REFERENCE, REFERENCE_HEIGHT, SIDEBAR, useWidth } from "@/components/Resizer";
import { Sidebar } from "@/components/Sidebar";
import { TOOLS, Toolbar } from "@/components/Toolbar";
import { ZoomControl } from "@/components/ZoomControl";
import { deleteSelected, loadReferences, loadTree, redo, refit, save, setTool, undo, useStore } from "@/lib/store";

const SIDE_BY_SIDE_FROM = 1000;  // room the work and the reference need next to each other

function useWindowWidth() {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    update();
    addEventListener("resize", update);
    return () => removeEventListener("resize", update);
  }, []);
  return width;
}

export default function Home() {
  const state = useStore();
  const sidebar = useWidth(SIDEBAR);
  const panel = useWidth(PANEL);
  const referenceWidth = useWidth(REFERENCE);
  const referenceHeight = useWidth(REFERENCE_HEIGHT);
  const windowWidth = useWindowWidth();
  const panelWidth = state.panelOpen ? panel.width : 0;
  const stacked = windowWidth - sidebar.width - panelWidth < SIDE_BY_SIDE_FROM;
  const open = Boolean(state.reference);

  useEffect(refit, [stacked, open]);

  useEffect(() => {
    void loadTree().then(loadReferences);
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
    <div
      className={stacked ? "app stacked" : "app"}
      style={
        {
          "--sidebar-width": `${sidebar.width}px`,
          "--reference-width": `${open && !stacked ? referenceWidth.width : 0}px`,
          "--reference-height": `${open && stacked ? referenceHeight.width : 0}px`,
          "--panel-width": `${panelWidth}px`,
        } as CSSProperties
      }
    >
      <Sidebar state={state} width={sidebar.width} onResize={sidebar.setWidth} />
      <Toolbar state={state} />
      <main id="main">
        {!state.file && state.loaded && <EmptyState hasWorkspace={Boolean(state.root)} />}
        {state.file &&
          state.pages.map((page, n) => <PageCanvas key={`${state.file}:${n}`} n={n} page={page} state={state} />)}
      </main>
      {state.reference && (
        <ReferencePane
          reference={state.reference}
          stacked={stacked}
          size={stacked ? referenceHeight.width : referenceWidth.width}
          onResize={stacked ? referenceHeight.setWidth : referenceWidth.setWidth}
        />
      )}
      {state.panelOpen && <ClaudePanel state={state} width={panel.width} onResize={panel.setWidth} />}
      {state.file && <GradeBar marks={state.marks} />}
      {state.file && <ZoomControl zoom={state.zoom} />}
    </div>
  );
}
