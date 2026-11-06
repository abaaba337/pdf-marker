"""The tools Claude gets: one per tool on the toolbar, and run_answer.

A small MCP server over stdio, started by the `claude` command for one marking
run. Marking calls hold no data: each shows up in Claude's output stream, and
claude_marker.py turns that into a mark.

run_answer runs the teacher's reference code and takes only its file name. There
is no way to pass code, so nothing written in a submission can get run.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

WHERE = {
    "page": {"type": "integer", "description": "Page number, from 0."},
    "line": {"type": "integer", "description": "Line number on that page, from lines.json."},
    "target": {"type": "string", "description": "The exact words on that line the problem is in, copied from "
               "lines.json, such as found = True. Only this part gets circled or underlined."},
    "x": {"type": "number", "description": "On a page with no text lines: position across, 0 to 1."},
    "y": {"type": "number", "description": "On a page with no text lines: position down, 0 to 1."},
}
COMMENT = {"type": "string", "description": "A short, kind remark to the student, in English."}
TOOLS = {
    "tick": ("Tick a correct result.", False),
    "cross": ("Cross a mistake and say what is wrong.", True),
    "highlight": ("Highlight a passage to reread and say why.", True),
    "comment": ("Underline what you are talking about and leave a remark.", True),
    "circle": ("Circle a value or step that needs attention and say why.", True),
    "line": ("Underline something.", False),
    "arrow": ("Point an arrow at something and say why.", True),
}


# Comments are for the student. They state what is right, and never mention how it is known.
NOT_FOR_STUDENTS = re.compile(r"\breference\b|answer key|model (answer|solution)|marking (scheme|rules)|"
                              r"(official|correct answer's|the answer's) (solution|output|code)|\bthe teacher\b", re.I)
REWRITE = ("Not marked. Comments are read by the student: state what is right directly, and don't mention the "
           "reference, the answer's code or the teacher. Call the tool again with a new comment. "
           "Put anything meant for the teacher in your working notes.")
GRADE_TOOL = "grade"
EDIT_TOOLS = {  # for when the teacher asks for changes: they act on marks.json
    "remove_mark": ("Remove a mark, with its comment, by its id in marks.json.", {"id": {"type": "string"}}),
    "change_comment": ("Replace the text of a comment, by its id in marks.json.",
                       {"id": {"type": "string"}, "comment": COMMENT}),
}
GRADES = ["A+", "A", "A-", "B+", "B", "B-"]
RUN_TOOL = "run_answer"
ANSWER_NAME = re.compile(r"reference_\d+\.py")
ANSWER_SECONDS = 180
ANSWER_CACHE = Path(os.environ.get("PDF_MARKER_ANSWERS") or Path(tempfile.gettempdir()) / "pdf-marker-answers")
MAX_OUTPUT = 40_000


def answer_cache(code):
    return ANSWER_CACHE / (hashlib.sha256(code).hexdigest() + ".txt")


def known_output(code):
    """What this exact version of an answer printed, if it has been run before."""
    cached = answer_cache(code)
    return cached.read_text(encoding="utf-8") if cached.is_file() else None


def run_answer(folder, name):
    """What a reference file really prints. A version runs once, not once per submission."""
    path = Path(folder) / str(name)
    if not ANSWER_NAME.fullmatch(str(name)) or not path.is_file():
        return f"No such reference file: {name}. Only reference_N.py files can be run."
    code = path.read_bytes()
    known = known_output(code)
    if known is not None:
        return known[:MAX_OUTPUT]
    with tempfile.TemporaryDirectory(prefix="pdf-marker-answer-", ignore_cleanup_errors=True) as work:
        (Path(work) / "answer.py").write_bytes(code)
        env = {**os.environ, "MPLBACKEND": "Agg", "PYTHONIOENCODING": "utf-8"}
        try:
            done = subprocess.run([sys.executable, "-I", "answer.py"], cwd=work, env=env, stdin=subprocess.DEVNULL,
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                                  errors="replace", timeout=ANSWER_SECONDS)
        except subprocess.TimeoutExpired as stopped:
            partial = stopped.stdout or ""
            partial = partial.decode("utf-8", "replace") if isinstance(partial, bytes) else partial
            return f"{partial[:MAX_OUTPUT]}\n[stopped after {ANSWER_SECONDS} seconds, so this is only the start]"
    if done.returncode == 0:
        ANSWER_CACHE.mkdir(exist_ok=True)
        answer_cache(code).write_text(done.stdout, encoding="utf-8")
    return done.stdout[:MAX_OUTPUT]


def tool_list():
    tools = []
    for name, (description, needs_comment) in TOOLS.items():
        required = ["page", "comment"] if needs_comment else ["page"]
        schema = {"type": "object", "properties": {**WHERE, "comment": COMMENT}, "required": required}
        tools.append({"name": name, "description": description, "inputSchema": schema})
    letter = {"type": "string", "enum": GRADES, "description": "From A+, the best, down to B-."}
    tools.append({"name": GRADE_TOOL, "description": "Give the whole submission its one grade.",
                  "inputSchema": {"type": "object", "properties": {"letter": letter}, "required": ["letter"]}})
    for name, (description, properties) in EDIT_TOOLS.items():
        tools.append({"name": name, "description": description,
                      "inputSchema": {"type": "object", "properties": properties, "required": list(properties)}})
    file = {"type": "string", "description": "A reference file in your folder, such as reference_1.py."}
    tools.append({"name": RUN_TOOL, "description": "Run a reference answer and get what it really prints.",
                  "inputSchema": {"type": "object", "properties": {"file": file}, "required": ["file"]}})
    return tools


def answer(request, folder="."):
    method = request.get("method")
    if method == "initialize":
        return {"protocolVersion": request["params"].get("protocolVersion", "2024-11-05"),
                "capabilities": {"tools": {}}, "serverInfo": {"name": "marker", "version": "1"}}
    if method == "tools/list":
        return {"tools": tool_list()}
    if method == "tools/call":
        if NOT_FOR_STUDENTS.search(str(request["params"].get("arguments", {}).get("comment", ""))):
            return {"content": [{"type": "text", "text": REWRITE}], "isError": True}
        if request["params"].get("name") == RUN_TOOL:
            output = run_answer(folder, request["params"].get("arguments", {}).get("file", ""))
            return {"content": [{"type": "text", "text": output or "[printed nothing]"}], "isError": False}
        known = request["params"].get("name") in (*TOOLS, GRADE_TOOL, *EDIT_TOOLS)
        return {"content": [{"type": "text", "text": "Marked." if known else "No such tool."}], "isError": not known}
    return {}


def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else "."
    for raw in sys.stdin:
        request = json.loads(raw)
        if "id" in request:  # anything without an id is a notification
            print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": answer(request, folder)}), flush=True)


if __name__ == "__main__":
    main()
