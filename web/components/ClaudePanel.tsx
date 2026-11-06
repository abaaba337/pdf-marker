import { useEffect, useRef } from "react";
import type { Mark } from "@/lib/marks";
import { PANEL, Resizer } from "./Resizer";
import {
  type ClaudeNote,
  deleteAllClaude,
  deleteClaudeMark,
  cancelClaude,
  restoreMark,
  saveGuidance,
  setInstruction,
  startClaude,
  useStore,
} from "@/lib/store";

type State = ReturnType<typeof useStore>;

const KIND_LABEL: Record<Mark["type"], string> = {
  tick: "打勾",
  cross: "打叉",
  highlight: "高亮",
  circle: "画圈",
  line: "划线",
  text: "批注",
};

function Thinking({ log, draft }: { log: ClaudeNote[]; draft: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [log.length, draft]);
  return (
    <section>
      <h3>思路</h3>
      <div className="thinking" ref={box}>
        {log.map((note, index) => (
          <p key={index} className={note.kind === "note" ? "step" : note.kind}>
            {note.text}
          </p>
        ))}
        {draft && <p className="step">{draft}</p>}
      </div>
    </section>
  );
}

interface ProposalProps {
  mark: Mark;
  note?: Mark;
  rejected: boolean;
}

function Proposal({ mark, note, rejected }: ProposalProps) {
  const comment = mark.type === "text" ? mark.text : note?.type === "text" ? note.text : "";
  return (
    <div className={"proposal" + (rejected ? " rejected" : "")}>
      <div className="row">
        <span className="kind">
          第 {mark.page + 1} 页 ·{" "}
          {mark.type === "text" && mark.grade ? "等第" : mark.type === "line" && mark.arrow ? "箭头" : KIND_LABEL[mark.type]}
        </span>
        {rejected ? (
          <button className="secondary" onClick={() => restoreMark(mark.id)}>
            恢复
          </button>
        ) : (
          <button className="secondary" onClick={() => deleteClaudeMark(mark.id)}>
            删除
          </button>
        )}
      </div>
      {comment && <p>{comment}</p>}
    </div>
  );
}

function Result({ state }: { state: State }) {
  const { claude, marks } = state;
  const rows = claude.marks.filter((m) => !(m.type === "text" && m.anchor));
  const live = (id: string) => marks.find((m) => m.id === id);
  return (
    <section>
      <h3>Claude 的批注</h3>
      {claude.summary && <p>{claude.summary}</p>}
      <div className="actions">
        <button className="secondary" disabled={!marks.some((m) => m.fromClaude)} onClick={deleteAllClaude}>
          全部删除
        </button>
      </div>
      {rows.map((row) => {
        const note = claude.marks.find((m) => m.type === "text" && m.anchor === row.id);
        return (
          <Proposal
            key={row.id}
            mark={live(row.id) ?? row}
            note={note && (live(note.id) ?? note)}
            rejected={claude.rejected.includes(row.id)}
          />
        );
      })}
    </section>
  );
}

interface PanelProps {
  state: State;
  width: number;
  onResize: (width: number) => void;
}

export function ClaudePanel({ state, width, onResize }: PanelProps) {
  const { cancelling, claude, file, instruction } = state;
  const running = claude.state === "running";
  return (
    <aside id="panel">
      <Resizer width={width} fallback={PANEL.fallback} onResize={onResize} side="left" />
      <div className="panelBody">
      <h2>Claude</h2>
      <section>
        <h3>批改规范</h3>
        <textarea
          value={instruction}
          placeholder="写下批改要求和等第标准，这个工作区的每一份都会用"
          onChange={(event) => setInstruction(event.target.value)}
          onBlur={() => void saveGuidance()}
        />
        {running ? (
          <button className="primary" disabled={cancelling} onClick={() => void cancelClaude()}>
            {cancelling ? "正在取消…" : "批改中，点此取消"}
          </button>
        ) : (
          <button className="primary" disabled={!file} onClick={() => void startClaude()}>
            {claude.state === "done" ? "重新批改" : "让 Claude 批改"}
          </button>
        )}
        {claude.state === "failed" && <p className="failed">{claude.error}</p>}
      </section>
      {(running || claude.log.length > 0) && <Thinking log={claude.log} draft={claude.draft} />}
      {(claude.state === "done" || claude.marks.length > 0) && <Result state={state} />}
      </div>
    </aside>
  );
}
