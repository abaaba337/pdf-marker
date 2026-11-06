import { useRef } from "react";
import { closeReference, openReference, removeReference, uploadReferences } from "@/lib/store";

const TYPES = ".pdf,.docx,.html,.htm,.py,.ipynb,.tex,.md,.txt,.m,.r,.jl,.c,.h,.cpp,.hpp,.java,.js,.ts,.json,.css,.sh,.f90,.rs,.go";

/* Reference answers belong to the workspace, so they sit with it, above the files. */
export function References({ names, open }: { names: string[]; open?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <section id="references">
      <div className="heading">
        <span>参考答案</span>
        <button className="upload" title="上传参考答案" onClick={() => input.current?.click()}>
          + 上传
        </button>
      </div>
      {names.map((name) => (
        <div className="row" key={name}>
          <button
            className={"referenceName" + (name === open ? " on" : "")}
            title={`查看 ${name}`}
            onClick={() => void (name === open ? closeReference() : openReference(name))}
          >
            <span className="name">{name}</span>
            <span className="hint">{name === open ? "收起" : "查看"}</span>
          </button>
          <button className="remove" aria-label={`删除 ${name}`} title="删除" onClick={() => void removeReference(name)}>
            删除
          </button>
        </div>
      ))}
      <input
        ref={input}
        id="referenceInput"
        type="file"
        hidden
        multiple
        accept={TYPES}
        onChange={(event) => {
          void uploadReferences([...event.target.files!]);
          event.target.value = "";
        }}
      />
    </section>
  );
}
