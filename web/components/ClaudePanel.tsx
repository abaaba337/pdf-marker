import { Fragment, useEffect, useRef, useState } from "react";
import type { Mark } from "@/lib/marks";
import { CHAT_HEIGHT, PANEL, Resizer, useWidth } from "./Resizer";
import {
  type ClaudeNote,
  deleteAllClaude,
  deleteClaudeMark,
  cancelClaude,
  restoreMark,
  saveGuidance,
  sendChat,
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

const FRAMES = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
const ACTIVITY: Partial<Record<ClaudeNote["kind"], string>> = { read: "阅读中", run: "运行答案中" };

/* Marking takes a minute or more, so show that it is alive and what it is doing. */
function Working({ log, elapsed = 0 }: { log: ClaudeNote[]; elapsed?: number }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 120);
    return () => clearInterval(timer);
  }, []);
  const activity = ACTIVITY[log.at(-1)?.kind ?? "read"] ?? "批改中";
  return (
    <p className="working" role="status">
      <span className="spark" aria-hidden="true">
        {FRAMES[tick % FRAMES.length]}
      </span>
      {activity}…<span className="elapsed">{elapsed} 秒</span>
    </p>
  );
}

function Notes({ log }: { log: ClaudeNote[] }) {
  return log.map((note, index) => (
    <p key={index} className={note.kind === "note" ? "step" : note.kind}>
      {note.text}
    </p>
  ));
}

function Thinking({ log, draft, running, elapsed }: { log: ClaudeNote[]; draft: string; running: boolean; elapsed?: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [log.length, draft]);
  return (
    <section>
      <h3>思路</h3>
      <div className="thinking" ref={box}>
        <Notes log={log} />
        {draft && <p className="step">{draft}</p>}
      </div>
      {running && <Working log={log} elapsed={elapsed} />}
    </section>
  );
}

interface ProposalProps {
  mark: Mark;
  note?: Mark;
  rejected: boolean;
}

/* A block of its own under the panel, so the conversation stays in reach while the list above changes. */
function Chat({ state }: { state: State }) {
  const [draft, setDraft] = useState("");
  const { width: height, setWidth: setHeight } = useWidth(CHAT_HEIGHT);
  const log = useRef<HTMLDivElement>(null);
  const block = useRef<HTMLElement>(null);
  const { chat, state: progress, turn = [], draft: partial } = state.claude;
  const running = progress === "running";
  const replying = running && chat.at(-1)?.role === "teacher";
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [chat.length, replying, turn.length, partial]);
  const send = () => {
    if (running || !draft.trim()) return;
    void sendChat(draft);
    setDraft("");
  };
  return (
    <section id="chat" ref={block} style={{ height: height || "50%" }}>
      <Resizer
        width={() => block.current?.offsetHeight ?? 0}
        fallback={CHAT_HEIGHT.fallback}
        onResize={setHeight}
        side="top"
      />
      <h3>和 Claude 说</h3>
      <div className="chatLog" ref={log}>
        {chat.map((message, index) => (
          <Fragment key={index}>
            {message.log && message.log.length > 0 && (
              <details className="steps">
                <summary>思路 · {message.log.length} 步</summary>
                <div className="thinkingSteps">
                  <Notes log={message.log} />
                </div>
              </details>
            )}
            <p className={"turn " + message.role}>{message.text}</p>
          </Fragment>
        ))}
        {replying && (
          <div className="thinkingSteps live">
            <Notes log={turn} />
            {partial && <p className="step">{partial}</p>}
          </div>
        )}
        {!chat.length && <p className="chatHint">想改什么直接说，Claude 会在稿子上改。</p>}
        {replying && <Working log={turn} elapsed={state.claude.elapsed} />}
      </div>
      <div className="chatInput">
        <textarea
          value={draft}
          placeholder="比如：第 2 题别扣分"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
        />
        {running ? (
          <button
            aria-label="停止"
            title="停止"
            disabled={state.cancelling}
            onClick={() => void cancelClaude()}
          >
            <svg viewBox="0 0 24 24">
              <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" />
            </svg>
          </button>
        ) : (
          <button aria-label="发送" title="发送" disabled={!draft.trim()} onClick={send}>
            <svg viewBox="0 0 24 24">
              <path d="M12 19V5M6 11l6-6 6 6" />
            </svg>
          </button>
        )}
      </div>
    </section>
  );
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
  const talking = running && claude.chat.at(-1)?.role === "teacher";
  return (
    <aside id="panel">
      <Resizer width={width} fallback={PANEL.fallback} onResize={onResize} side="left" />
      <div className="panelBody">
      <h2>Claude</h2>
      <section>
        <h3>批改规范</h3>
        <textarea
          id="rules"
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
      {((running && !talking) || claude.log.length > 0) && <Thinking log={claude.log} draft={talking ? "" : claude.draft} running={running && !talking} elapsed={claude.elapsed} />}
      {(claude.state === "done" || claude.marks.length > 0) && <Result state={state} />}
      </div>
      {file && <Chat state={state} />}
    </aside>
  );
}
