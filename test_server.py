"""Round-trip checks on synthetic PDFs. Run: python test_server.py"""
import json
import tempfile
import zipfile
from pathlib import Path

import fitz

import claude_marker
import marker_tools
import server
from server import Workspace, read_marks, save_marks

NASTY = 'Check (a) \\ "quoted"\nλ ≤ 1, ‖x‖₂, 中文'
MARKS = [
    {"id": "1", "type": "tick", "page": 0, "color": "#1f9d55", "width": 1.5, "x": 50, "y": 60, "w": 14, "h": 14},
    {"id": "2", "type": "cross", "page": 0, "color": "#d92b2b", "width": 1.5, "x": 90, "y": 60, "w": 14, "h": 14},
    {"id": "3", "type": "highlight", "page": 0, "color": "#ffd400", "x": 70, "y": 90, "w": 200, "h": 16},
    {"id": "4", "type": "text", "page": 0, "color": "#d92b2b", "x": 72, "y": 200, "w": 190, "h": 20,
     "size": 11, "text": NASTY, "anchor": "2",
     "leader": {"x1": 97, "y1": 67, "x2": 97, "y2": 200, "color": "#d92b2b", "width": 0.6}},
    {"id": "5", "type": "circle", "page": 1, "color": "#d92b2b", "width": 2, "x": 100, "y": 100, "w": 200, "h": 100},
    {"id": "6", "type": "line", "page": 1, "color": "#2563eb", "width": 2, "x1": 50, "y1": 50, "x2": 200, "y2": 60},
    {"id": "9", "type": "line", "page": 1, "color": "#d92b2b", "width": 2, "x1": 50, "y1": 90, "x2": 200, "y2": 90,
     "arrow": True},
    {"id": "7", "type": "text", "page": 1, "color": "#d92b2b", "x": 300, "y": 300, "w": 190, "h": 20,
     "size": 11, "text": "note on a rotated page"},
    {"id": "8", "type": "highlight", "page": 1, "color": "#ffd400", "x": 300, "y": 400, "w": 100, "h": 20},
]


def sample(path):
    doc = fitz.open()
    doc.new_page(width=595, height=842).insert_text((72, 100), "Plain page", fontsize=14)
    rotated = doc.new_page(width=595, height=842)
    rotated.insert_text((72, 100), "Rotated page", fontsize=14)
    rotated.set_rotation(90)
    other = doc[0].add_text_annot((400, 400), "made by another tool")
    other.update()
    doc.save(path)
    doc.close()


def write_docx(path, text):
    body = f'<w:p><w:r><w:t>{text}</w:t></w:r></w:p>'
    namespace = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("[Content_Types].xml", (
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.'
            'wordprocessingml.document.main+xml"/></Types>'))
        archive.writestr("_rels/.rels", (
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
            'officeDocument" Target="word/document.xml"/></Relationships>'))
        archive.writestr("word/_rels/document.xml.rels",
                         '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>')
        archive.writestr("word/document.xml", f"<w:document {namespace}><w:body>{body}</w:body></w:document>")


def annots(path):
    with fitz.open(path) as doc:
        return [(page.number, annot.type[1], tuple(annot.rect)) for page in doc for annot in page.annots()]


def check_saving(path):
    original = path.read_bytes()
    backup = path.parent / ".orig" / path.name

    save_marks(path, MARKS)
    with fitz.open(path) as doc:
        assert read_marks(doc) == MARKS, "marks must come back exactly as saved"
    assert len(annots(path)) == len(MARKS) + 2, "leader line and other tools' annotation must be there"
    with fitz.open(path) as doc:
        heads = [annot.line_ends[1] for annot in doc[1].annots() if annot.type[1] == "Line"]
        assert sorted(heads) == [fitz.PDF_ANNOT_LE_NONE, fitz.PDF_ANNOT_LE_CLOSED_ARROW], heads
    assert backup.read_bytes() == original, "backup must be the first version"

    moved = [dict(m) for m in MARKS[:2]]
    moved[0]["x"] = 300
    save_marks(path, moved)
    with fitz.open(path) as doc:
        assert read_marks(doc) == moved, "editing must replace, not add"
    assert len(annots(path)) == 3, "leader of a removed note must go too"
    assert backup.read_bytes() == original, "backup must not be overwritten"

    save_marks(path, [])
    assert [a[1] for a in annots(path)] == ["Text"], "clearing must leave only the other tool's note"
    assert not list(path.parent.glob("*.tmp"))


def check_rotation(path):
    save_marks(path, MARKS)
    with fitz.open(path) as doc:  # marks land where the site showed them
        page = doc[1]
        shown = {annot.type[1]: annot.rect * page.rotation_matrix for annot in page.annots()}
        assert abs(shown["Circle"].x0 - 100) < 4 and abs(shown["Circle"].y0 - 100) < 4, shown["Circle"]
        assert abs(shown["FreeText"].x0 - 300) < 4 and abs(shown["FreeText"].y0 - 300) < 4, shown["FreeText"]
        assert abs(shown["Highlight"].x0 - 300) < 8 and abs(shown["Highlight"].y0 - 400) < 8, shown["Highlight"]


def check_workspace(root):
    nested = root / "Sheet 2" / "deep"
    nested.mkdir(parents=True)
    sample(nested / "b.pdf")
    (nested / "notes.txt").write_text("not a pdf")
    (root / "broken.pdf").write_bytes(b"not really a pdf")

    assert Workspace().tree() == {"root": None, "groups": []}
    assert Workspace(root / "missing").root is None

    site = Workspace(root)
    tree = site.tree()
    found = {g["dir"]: [f["name"] for f in g["files"]] for g in tree["groups"]}
    assert found == {".": ["broken.pdf", "sheet.pdf"], "Sheet 2/deep": ["b.pdf"]}, found
    assert next(f for g in tree["groups"] for f in g["files"] if f["name"] == "sheet.pdf")["marks"] == len(MARKS)

    save_marks(root / "sheet.pdf", [])  # the count must follow the file, not the cache
    assert next(f for g in site.tree()["groups"] for f in g["files"] if f["name"] == "sheet.pdf")["marks"] == 0

    server.CONFIG = root / "config.json"  # never touch the real remembered workspace
    site.choose(nested)
    assert server.last_workspace() == str(nested.resolve())
    assert [g["dir"] for g in site.tree()["groups"]] == ["."], "listing must follow the chosen workspace"
    site.choose(root)

    assert site.resolve("Sheet 2/deep/b.pdf") == nested.resolve() / "b.pdf"
    for bad in ("../secret.pdf", ".orig/sheet.pdf", "Sheet 2/deep/notes.txt", "missing.pdf"):
        try:
            site.resolve(bad)
        except ValueError:
            continue
        raise AssertionError(f"{bad} must be refused")


def check_site(root):
    site = root / "site"
    (site / "_next").mkdir(parents=True)
    (site / "index.html").write_text("page")
    (site / "_next" / "app.js").write_text("code")
    (root / "secret.pdf").write_text("private")
    server.SITE = site
    assert server.site_file("/").name == "index.html"
    assert server.site_file("/_next/app.js").name == "app.js"
    for bad in ("/../secret.pdf", "/_next/../../secret.pdf", "/missing.js", "/_next"):
        assert server.site_file(bad) is None, bad


def check_claude(root):
    pages = [{"w": 595, "h": 842}]
    lines = [{"page": 0, "line": 0, "text": "x", "box": [72, 100, 300, 114]}]
    items = [
        {"page": 0, "line": 0, "kind": "tick"},
        {"page": 0, "line": 0, "kind": "cross", "comment": "wrong sign"},
        {"page": 0, "line": 0, "kind": "comment", "comment": "just a remark"},
        {"page": 0, "kind": "highlight", "x": 0.5, "y": 0.5, "comment": "no text on this page"},
        {"page": 9, "line": 0, "kind": "tick"},
        {"page": 0, "line": 99, "kind": "tick"},
        {"page": 0, "line": 0, "kind": "explode"},
        {"page": 0, "line": 0, "kind": "comment"},
        "not a mark",
    ]
    marks = claude_marker.to_marks(items, lines, pages)
    assert [m["type"] for m in marks] == ["tick", "cross", "text", "text", "highlight", "text"], marks
    cross, note = marks[1], marks[2]
    assert note["anchor"] == cross["id"] and note["text"] == "wrong sign"
    assert "anchor" not in marks[3], "a plain remark links to nothing"
    assert all(m["x"] + m.get("w", 0) <= 595 for m in marks)
    assert marks[2]["y"] < marks[3]["y"], "notes on one line must not stack on each other"

    # Claude may use the toolbar's tools and nothing else
    toolbar = ["tick", "cross", "highlight", "comment", "circle", "line", "arrow"]
    placed = claude_marker.to_marks([{"page": 0, "line": 0, "kind": k, "comment": "c"} for k in toolbar], lines, pages)
    symbols = [m for m in placed if m["type"] != "text"]
    assert [m["type"] for m in symbols] == ["tick", "cross", "highlight", "circle", "line", "line"]
    assert symbols[-1]["arrow"] is True and "arrow" not in symbols[-2]
    assert claude_marker.to_marks([{"page": 0, "line": 0, "kind": "stamp", "comment": "c"}], lines, pages) == []
    save_marks(root / "sheet.pdf", [{**m, "page": 0} for m in placed])  # every kind must also save
    with fitz.open(root / "sheet.pdf") as doc:
        assert len(read_marks(doc)) == len(placed)
    save_marks(root / "sheet.pdf", [])

    def stream(*events):
        job = {"log": [], "marks": [], "summary": "", "draft": ""}
        reader = claude_marker.Reader(job, claude_marker.Placer(lines, pages))
        for event in events:
            reader.feed(json.dumps(event))
        return job, reader

    def text(value):
        return {"type": "stream_event", "event": {"delta": {"type": "text_delta", "text": value}}}

    job, reader = stream(
        {"type": "stream_event", "event": {"delta": {"type": "thinking_delta", "thinking": "plan\n"}}},
        {"type": "assistant", "message": {"content": [
            {"type": "tool_use", "name": "Read", "input": {"file_path": "/tmp/x/submission.pdf"}}]}},
        text("正在"), text("看\n"),
        {"type": "assistant", "message": {"content": [
            {"type": "tool_use", "name": "mcp__marker__tick", "input": {"page": 0, "line": 0}},
            {"type": "tool_use", "name": "mcp__marker__stamp", "input": {"page": 0, "line": 0}}]}},
        text("```\nSUMMARY: fine"),
        {"type": "stream_event", "event": {"type": "content_block_stop"}},
        {"type": "result", "is_error": False},
    )
    assert [n["text"] for n in job["log"]] == ["plan", "读取 submission.pdf", "正在看"], job["log"]
    assert [m["type"] for m in job["marks"]] == ["tick"] and job["summary"] == "fine" and reader.finished

    job, _ = stream(text("half a no"))
    assert job["draft"] == "half a no" and job["log"] == [], "unfinished text shows as a draft"
    job, _ = stream(text("SUMMARY half"))
    assert job["draft"] == "", "an unfinished summary is not shown as a note"
    _, reader = stream({"type": "result", "is_error": True, "result": "out of credit"})
    assert reader.failure == "out of credit"

    with fitz.open(root / "sheet.pdf") as doc:  # rotated pages report displayed coordinates
        found = claude_marker.page_lines(doc)
        for line in found:
            assert doc[line["page"]].rect.contains(fitz.Rect(line["box"])), line
        assert {line["page"] for line in found} == {0, 1}

    site = Workspace(root)
    site.add_reference("answer.py", b"print(1)")
    site.add_reference("../../general.md", b"# all")
    assert [p.name for p in site.references()] == ["answer.py", "general.md"], "one set for the whole workspace"
    assert (root / ".marker" / "reference" / "general.md").is_file(), "a path in the name must be dropped"
    site.remove_reference("answer.py")
    assert [p.name for p in site.references()] == ["general.md"]
    try:
        site.add_reference("virus.exe", b"x")
    except ValueError:
        pass
    else:
        raise AssertionError("this type must be refused")
    assert all(".marker" not in g["dir"] for g in site.tree()["groups"]), "reference answers stay out of the tree"

    # the agent's scaffold: no inherited configuration, and the toolbar as its only marking tools
    flags = claude_marker.agent_flags()
    for flag in ("--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"):
        assert flag in flags, flag
    assert flags[flags.index("--setting-sources") + 1] == "", "no user, project or local settings"
    assert flags[flags.index("--tools") + 1] == "Read", "no other built-in tool"
    allowed = flags[flags.index("--allowedTools") + 1:]
    assert sorted(allowed) == sorted("mcp__marker__" + name for name in toolbar)
    assert not any(flag.startswith("--dangerously") or flag == "--permission-mode" for flag in flags)
    names = [tool["name"] for tool in marker_tools.tool_list()]
    assert sorted(names) == sorted(toolbar), "the agent's tools are the toolbar"
    assert marker_tools.answer({"method": "tools/call", "params": {"name": "bash"}})["isError"]

    # turned-down proposals are remembered, during a run and after it
    pdf = root / "sheet.pdf"
    jobs = claude_marker.Jobs()
    claude_marker.write_result(pdf, {"summary": "s", "marks": [], "log": []})
    assert jobs.status(pdf)["rejected"] == [], "results saved before this feature must still open"
    jobs.reject(pdf, ["a"])
    assert jobs.status(pdf)["rejected"] == ["a"] and jobs.status(pdf)["summary"] == "s"
    jobs.running[pdf] = {"log": [], "marks": [], "summary": "", "draft": "", "rejected": []}
    jobs.reject(pdf, ["b"])
    assert jobs.status(pdf)["rejected"] == ["b"]
    del jobs.running[pdf]
    claude_marker.result_path(pdf).unlink()

    # only real reads are reported as reads
    job, _ = stream({"type": "assistant", "message": {"content": [
        {"type": "tool_use", "name": "cross", "input": {"page": 0}},
        {"type": "tool_use", "name": "ToolSearch", "input": {"query": "x"}}]}})
    assert job["log"] == [] and job["marks"] == []

    # from the person's Claude Code settings, only the effort level comes across
    claude_marker.SETTINGS = root / "claude-settings.json"
    assert "--effort" not in claude_marker.agent_flags(), "no settings file, no flag"
    claude_marker.SETTINGS.write_text(json.dumps({"effortLevel": "high", "permissions": {"allow": ["Bash"]}}))
    flags = claude_marker.agent_flags()
    assert flags[flags.index("--effort") + 1] == "high"
    assert "Bash" not in " ".join(flags), "permissions must never come across"
    claude_marker.SETTINGS.write_text(json.dumps({"effortLevel": "--dangerously-skip-permissions"}))
    assert "--effort" not in claude_marker.agent_flags(), "only known levels"

    # marking rules apply to a folder and below; the nearest ones win
    assert site.guidance("sheet.pdf") == ""
    site.save_guidance(None, "general rules")
    assert site.guidance("Sheet 2/deep/b.pdf") == "general rules"
    site.save_guidance("Sheet 2/deep/b.pdf", "this sheet")
    assert site.guidance("Sheet 2/deep/b.pdf") == "this sheet"
    assert site.guidance("sheet.pdf") == "general rules"
    assert all(".marker" not in g["dir"] for g in site.tree()["groups"])

    # reference answers, read-only views
    answers = root / "answers"
    answers.mkdir()
    (answers / "a.ipynb").write_text(json.dumps({"cells": [
        {"cell_type": "code", "source": ["1 + 1"], "outputs": [{"data": {"text/plain": ["2"]}}]}]}))
    assert server.reference_view(answers / "a.ipynb") == {
        "kind": "notebook", "cells": [{"type": "code", "source": "1 + 1", "output": "2"}]}
    (answers / "a.py").write_text("x = 1")
    assert server.reference_view(answers / "a.py") == {"kind": "code", "text": "x = 1", "language": "py"}
    (answers / "a.html").write_text("<p>hi</p>")
    assert server.reference_view(answers / "a.html") == {"kind": "html", "text": "<p>hi</p>"}
    sample(answers / "a.pdf")
    assert [round(p["w"]) for p in server.reference_view(answers / "a.pdf")["pages"]] == [595, 842]
    write_docx(answers / "a.docx", "The answer is 4")
    view = server.reference_view(answers / "a.docx")
    assert view["kind"] == "pages" and len(view["pages"]) >= 1
    suffix, content = server.reference_for_claude(answers / "a.docx")
    assert suffix == ".txt" and b"The answer is 4" in content, "Claude gets a Word file as text"

    class Capture:
        def start(self, pdf, data, lines, pages, references, instruction):
            self.data, self.lines = data, lines

    save_marks(root / "sheet.pdf", MARKS)
    sent = Capture()
    server.start_marking(site, sent, "sheet.pdf", "")
    with fitz.open(stream=sent.data, filetype="pdf") as doc:
        assert [a.type[1] for page in doc for a in page.annots()] == ["Text"], "Claude must not see the teacher's marks"
    assert not any("rotated page" in line["text"] for line in sent.lines), "nor their comment text"
    save_marks(root / "sheet.pdf", [])


def main():
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        path = root / "sheet.pdf"
        sample(path)
        check_saving(path)
        check_rotation(path)
        check_workspace(root)
        check_site(root)
        check_claude(root)
    print("all checks passed")


if __name__ == "__main__":
    main()
