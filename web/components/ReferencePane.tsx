import hljs from "highlight.js/lib/common";
import { useMemo } from "react";
import { type ReferenceView, closeReference, referencePage } from "@/lib/store";
import { Resizer, REFERENCE } from "./Resizer";

/* Scripts can't run and nothing can load from outside: sandbox plus this policy. */
const SAFE_HTML = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">`;

function Code({ text, language }: { text: string; language: string }) {
  const html = useMemo(() => {
    const known = hljs.getLanguage(language);
    return known ? hljs.highlight(text, { language }).value : hljs.highlightAuto(text).value;
  }, [text, language]);
  return (
    <pre>
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}

function View({ name, view }: { name: string; view: ReferenceView }) {
  if (view.kind === "pages") {
    return view.pages.map((_, n) => (
      // eslint-disable-next-line @next/next/no-img-element
      <img key={n} alt={`第 ${n + 1} 页`} loading="lazy" src={referencePage(name, n)} />
    ));
  }
  if (view.kind === "html") return <iframe title={name} sandbox="" srcDoc={SAFE_HTML + view.text} />;
  if (view.kind === "code") return <Code text={view.text} language={view.language} />;
  return view.cells.map((cell, index) => (
    <div key={index} className={"cell " + cell.type}>
      {cell.type === "code" ? <Code text={cell.source} language="python" /> : <pre>{cell.source}</pre>}
      {cell.output && <pre className="output">{cell.output}</pre>}
    </div>
  ));
}

interface Props {
  reference: { name: string; view: ReferenceView };
  width: number;
  onResize: (width: number) => void;
}

export function ReferencePane({ reference, width, onResize }: Props) {
  return (
    <section id="reference" aria-label="参考答案">
      <Resizer width={width} fallback={REFERENCE.fallback} onResize={onResize} side="left" />
      <header>
        <span className="name" title={reference.name}>
          参考答案 · {reference.name}
        </span>
        <button className="secondary" aria-label="关闭参考答案" onClick={closeReference}>
          收起
        </button>
      </header>
      <div className="referenceBody">
        <View name={reference.name} view={reference.view} />
      </div>
    </section>
  );
}
