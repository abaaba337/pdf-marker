"""PDF Marker: mark up PDFs in a local web page. See README.md.

Marks are saved into the PDF itself as standard annotations, so any PDF viewer
shows them. Each one also carries its editing data under the MarkerData key,
which is how the site reopens a saved file with every mark still editable.
Annotations made by other tools are left alone.

Files stay on this machine: the server listens on 127.0.0.1 only and the page
loads nothing from the internet. The one exception is the Claude button: see
claude_marker.py.
"""
import argparse
import base64
import json
import os
import shutil
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import fitz

import claude_marker

KEY = "MarkerData"
LEADER_KEY = "MarkerLeader"  # thin line from a mark to its note; rebuilt from the note on save
HERE = Path(__file__).resolve().parent
SITE = HERE / "web" / "out"  # the built page: run `npm run build` in web/
CONTENT_TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
                 ".txt": "text/plain; charset=utf-8", ".json": "application/json",
                 ".svg": "image/svg+xml", ".woff2": "font/woff2"}
CONFIG = Path.home() / ".pdf-marker.json"  # remembers the last workspace
PAGED_TYPES = {".pdf", ".docx"}  # PyMuPDF lays these out as pages
HTML_TYPES = {".html", ".htm"}
CODE_TYPES = {".py", ".ipynb", ".tex", ".md", ".txt", ".m", ".r", ".jl", ".c", ".h", ".cpp", ".hpp", ".java",
              ".js", ".ts", ".json", ".css", ".sh", ".f90", ".rs", ".go"}
REFERENCE_TYPES = PAGED_TYPES | HTML_TYPES | CODE_TYPES
MAX_UPLOAD = 50_000_000
NOTE_FILL = (0.984, 0.953, 0.859)  # same pale yellow as the page
TEXT_PAD = 8  # room PyMuPDF keeps inside a text box, in points
SHAPES = {
    "tick": [[(0, 0.55), (0.35, 1), (1, 0)]],
    "cross": [[(0, 0), (1, 1)], [(1, 0), (0, 1)]],
}


def rgb(color):
    return tuple(int(color[i:i + 2], 16) / 255 for i in (1, 3, 5))


def marker_xrefs(doc, page):
    return [x[0] for x in page.annot_xrefs() if doc.xref_get_key(x[0], KEY)[0] == "string"]


def strip_marks(doc, page):
    for xref in [x[0] for x in page.annot_xrefs()]:
        if "string" in (doc.xref_get_key(xref, KEY)[0], doc.xref_get_key(xref, LEADER_KEY)[0]):
            page.delete_annot(page.load_annot(xref))


def read_marks(doc):
    marks = []
    for page in doc:
        for xref in marker_xrefs(doc, page):
            raw = doc.xref_get_key(xref, KEY)[1]
            marks.append(json.loads(base64.b64decode(raw)))
    return marks


def text_height(mark):
    """Height the wrapped text needs, so a long comment is never cut off in the PDF."""
    size = mark["size"]
    usable = mark["w"] - TEXT_PAD
    lines = 0
    for para in mark["text"].split("\n"):
        lines += 1
        width = 0
        for word in para.split(" "):
            word_width = fitz.get_text_length(word + " ", "helv", size)
            if width and width + word_width > usable:
                lines += 1
                width = 0
            width += word_width
    return lines * size * 1.3 + TEXT_PAD


def add_leader(doc, page, leader):
    to_pdf = page.derotation_matrix
    annot = page.add_line_annot(fitz.Point(leader["x1"], leader["y1"]) * to_pdf,
                                fitz.Point(leader["x2"], leader["y2"]) * to_pdf)
    annot.set_colors(stroke=rgb(leader["color"]))
    annot.set_border(width=leader["width"])
    annot.set_info(title="Marker")
    annot.update()
    doc.xref_set_key(annot.xref, LEADER_KEY, "(1)")


def add_mark(doc, page, mark):
    to_pdf = page.derotation_matrix  # site coordinates follow the page as displayed

    def point(x, y):
        return fitz.Point(x, y) * to_pdf

    kind = mark["type"]
    color = rgb(mark["color"])
    grade = mark.get("grade")
    if grade:  # drawn as marker strokes, so it looks the same in every viewer
        annot = page.add_ink_annot([[tuple(point(x, y)) for x, y in stroke] for stroke in mark["ink"]])
    elif kind in SHAPES:
        strokes = [[tuple(point(mark["x"] + u * mark["w"], mark["y"] + v * mark["h"]))
                    for u, v in stroke] for stroke in SHAPES[kind]]
        annot = page.add_ink_annot(strokes)
    elif kind == "line":
        annot = page.add_line_annot(point(mark["x1"], mark["y1"]), point(mark["x2"], mark["y2"]))
        if mark.get("arrow"):
            annot.set_line_ends(fitz.PDF_ANNOT_LE_NONE, fitz.PDF_ANNOT_LE_CLOSED_ARROW)
    else:
        height = max(mark["h"], text_height(mark)) if kind == "text" else mark["h"]
        left, top, right, bottom = mark["x"], mark["y"], mark["x"] + mark["w"], mark["y"] + height
        box = fitz.Rect(left, top, right, bottom) * to_pdf
        if kind == "circle":
            annot = page.add_circle_annot(box)
        elif kind == "highlight":
            annot = page.add_highlight_annot(quads=[fitz.Quad(
                point(left, top), point(right, top), point(left, bottom), point(right, bottom))])
        elif kind == "text":
            if mark.get("leader"):  # added first so the note sits on top of it
                add_leader(doc, page, mark["leader"])
            annot = page.add_freetext_annot(
                box, mark["text"], fontsize=mark["size"], fontname="helv", text_color=color,
                fill_color=NOTE_FILL, rotate=page.rotation, border_width=0)
        else:
            raise ValueError(f"unknown mark type: {kind}")
    if kind != "text" or grade:
        annot.set_colors(stroke=color, fill=color if mark.get("arrow") else None)  # a solid head
    if grade or kind in SHAPES or kind in ("line", "circle"):
        annot.set_border(width=mark.get("width", 2))
    annot.set_info(title="Marker")
    annot.update()
    data = base64.b64encode(json.dumps(mark, ensure_ascii=False).encode()).decode()
    doc.xref_set_key(annot.xref, KEY, f"({data})")


def save_marks(path, marks):
    """Replace the marks in `path`. The file as it first was is kept once in .orig/."""
    path = Path(path)
    tmp = path.with_name(path.name + ".tmp")
    with fitz.open(path) as doc:
        for page in doc:
            strip_marks(doc, page)
        for mark in marks:
            add_mark(doc, doc[mark["page"]], mark)
        doc.save(tmp, garbage=3, deflate=True)
    try:
        backup = path.parent / ".orig" / path.name
        if not backup.exists():
            backup.parent.mkdir(exist_ok=True)
            shutil.copy2(path, backup)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def pick_folder(initial):
    """Native folder dialog. Paths never arrive over HTTP, only from the person at the screen."""
    import tkinter
    from tkinter import filedialog
    window = tkinter.Tk()
    window.withdraw()
    window.attributes("-topmost", True)
    chosen = filedialog.askdirectory(parent=window, title="选择工作区", initialdir=initial or Path.home())
    window.destroy()
    return chosen


def site_file(url_path):
    """The built file for a URL path, or None. Nothing outside SITE is ever served."""
    path = (SITE / (url_path.lstrip("/") or "index.html")).resolve()
    return path if path.is_relative_to(SITE.resolve()) and path.is_file() else None


class Workspace:
    def __init__(self, root=None):
        self.root = None
        self.counts = {}  # path -> (modified time, marks, grade), so listing does not reopen every PDF
        if root and Path(root).is_dir():
            self.root = Path(root).resolve()

    def choose(self, root):
        self.root = Path(root).resolve()
        CONFIG.write_text(json.dumps({"workspace": str(self.root)}, ensure_ascii=False), encoding="utf-8")

    def summary(self, path):
        modified = path.stat().st_mtime
        cached = self.counts.get(path)
        if cached and cached[0] == modified:
            return cached[1:]
        try:
            with fitz.open(path) as doc:
                marks = read_marks(doc)
        except (fitz.FileDataError, RuntimeError):
            marks = []  # damaged file: still listed; opening it reports the problem
        grade = next((mark["text"] for mark in marks if mark.get("grade")), None)
        self.counts[path] = (modified, len(marks), grade)
        return len(marks), grade

    def tree(self):
        """Every PDF under the workspace, grouped by folder. Dot folders such as .orig are skipped."""
        if not self.root:
            return {"root": None, "groups": []}
        groups = {}
        for folder, subfolders, names in os.walk(self.root):
            subfolders[:] = sorted((d for d in subfolders if not d.startswith(".")), key=str.lower)
            for name in sorted(names, key=str.lower):
                if name.lower().endswith(".pdf"):
                    path = Path(folder) / name
                    rel = path.relative_to(self.root)
                    marks, grade = self.summary(path)
                    groups.setdefault(rel.parent.as_posix(), []).append(
                        {"file": rel.as_posix(), "name": name, "marks": marks, "grade": grade})
        return {"root": str(self.root),
                "groups": [{"dir": d, "files": f} for d, f in groups.items()]}

    def reference_place(self):
        """Reference answers belong to the whole workspace, so one upload serves every submission."""
        if not self.root:
            raise ValueError("no workspace chosen")
        return self.root / ".marker" / "reference"

    def references(self):
        place = self.reference_place()
        if not place.is_dir():
            return []
        return sorted(p for p in place.iterdir() if p.suffix.lower() in REFERENCE_TYPES)

    def add_reference(self, name, data):
        name = Path(name).name
        if Path(name).suffix.lower() not in REFERENCE_TYPES:
            raise ValueError("只支持 PDF、Word（docx）、HTML 和常见代码文件")
        place = self.reference_place()
        place.mkdir(parents=True, exist_ok=True)
        (place / name).write_bytes(data)

    def remove_reference(self, name):
        self.reference(name).unlink()

    def guidance_path(self):
        if not self.root:
            raise ValueError("no workspace chosen")
        return self.root / ".marker" / "guidance.md"

    def guidance(self):
        """The teacher's marking rules and grade scale, one set for the whole workspace."""
        path = self.guidance_path()
        return path.read_text(encoding="utf-8") if path.is_file() else ""

    def save_guidance(self, text):
        path = self.guidance_path()
        path.parent.mkdir(exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def reference(self, name):
        for path in self.references():
            if path.name == name:
                return path
        raise ValueError("no such reference")

    def resolve(self, rel):
        if not self.root:
            raise ValueError("no workspace chosen")
        path = (self.root / rel).resolve()
        parts = path.relative_to(self.root).parts  # raises ValueError outside the workspace
        if any(p.startswith(".") for p in parts) or path.suffix.lower() != ".pdf" or not path.is_file():
            raise ValueError("not a PDF in this workspace")
        return path


def notebook_cells(text):
    cells = []
    for cell in json.loads(text).get("cells", []):
        output = []
        for item in cell.get("outputs", []):
            data = item.get("data", {})
            output.append("".join(item.get("text") or data.get("text/plain") or []))
        cells.append({"type": cell.get("cell_type"), "source": "".join(cell.get("source", [])),
                      "output": "\n".join(part for part in output if part)})
    return cells


def reference_view(path):
    """What the read-only pane needs to show a reference answer."""
    suffix = path.suffix.lower()
    if suffix in PAGED_TYPES:
        with fitz.open(path) as doc:
            return {"kind": "pages", "pages": [{"w": p.rect.width, "h": p.rect.height} for p in doc]}
    text = path.read_text(encoding="utf-8", errors="replace")
    if suffix in HTML_TYPES:
        return {"kind": "html", "text": text}
    if suffix == ".ipynb":
        return {"kind": "notebook", "cells": notebook_cells(text)}
    return {"kind": "code", "text": text, "language": suffix[1:]}


def reference_for_claude(path):
    """Claude's Read tool can't open Word files, so it gets their text."""
    suffix = path.suffix.lower()
    if suffix != ".docx":
        return suffix, path.read_bytes()
    with fitz.open(path) as doc:
        return ".txt", "\n".join(page.get_text() for page in doc).encode("utf-8")


def start_marking(workspace, jobs, rel, instruction):
    pdf = workspace.resolve(rel)
    with fitz.open(pdf) as doc:
        for page in doc:
            strip_marks(doc, page)  # Claude marks independently: it must not see the teacher's marks
        lines = claude_marker.page_lines(doc)
        pages = [{"w": p.rect.width, "h": p.rect.height} for p in doc]
        data = doc.tobytes()
    references = [reference_for_claude(path) for path in workspace.references()]
    jobs.start(pdf, data, lines, pages, references, instruction)


class Handler(BaseHTTPRequestHandler):
    workspace = None
    jobs = claude_marker.Jobs()
    ui_port = None  # the Next.js development server, when one is proxying to this server

    def log_message(self, *args):
        pass

    def allowed(self):
        """Refuse requests that did not come from this page (other sites, DNS rebinding)."""
        ports = {self.server.server_address[1], self.ui_port}
        hosts = {f"{name}:{port}" for name in ("127.0.0.1", "localhost") for port in ports}
        origin = self.headers.get("Origin")
        return self.headers.get("Host") in hosts and (
            origin is None or origin.split("//")[-1] in hosts)

    def reply(self, body, kind="application/json", status=200):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode()
        try:
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
        except ConnectionError:
            pass  # the page moved on, for example to another file

    def do_GET(self):
        if not self.allowed():
            return self.reply({"error": "forbidden"}, status=403)
        url = urlparse(self.path)
        args = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            if url.path == "/api/tree":
                self.reply(self.workspace.tree())
            elif url.path == "/api/reference":
                self.reply([p.name for p in self.workspace.references()])
            elif url.path == "/api/guidance":
                self.reply({"text": self.workspace.guidance()})
            elif url.path == "/api/reference/view":
                self.reply(reference_view(self.workspace.reference(args["name"])))
            elif url.path == "/api/reference/page":
                with fitz.open(self.workspace.reference(args["name"])) as doc:
                    page = doc[int(args["n"])]
                    zoom = min(3, max(1, float(args["w"]) / page.rect.width))
                    self.reply(page.get_pixmap(matrix=fitz.Matrix(zoom, zoom)).tobytes("png"), "image/png")
            elif url.path == "/api/claude":
                self.reply(self.jobs.status(self.workspace.resolve(args["file"])))
            elif url.path == "/api/doc":
                with fitz.open(self.workspace.resolve(args["file"])) as doc:
                    pages = [{"w": p.rect.width, "h": p.rect.height} for p in doc]
                    self.reply({"pages": pages, "marks": read_marks(doc)})
            elif url.path == "/api/page":
                with fitz.open(self.workspace.resolve(args["file"])) as doc:
                    page = doc[int(args["n"])]
                    strip_marks(doc, page)  # in memory only; the page draws these itself
                    zoom = min(3, max(1, float(args["w"]) / page.rect.width))
                    pixmap = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), annots=True)
                    self.reply(pixmap.tobytes("png"), "image/png")
            elif url.path == "/pdf":
                self.reply(self.workspace.resolve(args["file"]).read_bytes(), "application/pdf")
            elif page := site_file(url.path):
                self.reply(page.read_bytes(), CONTENT_TYPES.get(page.suffix, "application/octet-stream"))
            else:
                self.reply({"error": "not found"}, status=404)
        except (KeyError, ValueError, IndexError, fitz.FileDataError) as error:
            self.reply({"error": str(error)}, status=400)

    def do_POST(self):
        url = urlparse(self.path)
        kind = "application/octet-stream" if url.path == "/api/reference" else "application/json"
        if not self.allowed() or self.headers.get("Content-Type") != kind:
            return self.reply({"error": "forbidden"}, status=403)
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_UPLOAD:
                return self.reply({"error": "文件太大"}, status=413)
            raw = self.rfile.read(length)
            if url.path == "/api/reference":
                args = {k: v[0] for k, v in parse_qs(url.query).items()}
                self.workspace.add_reference(args["name"], raw)
                return self.reply({"ok": True})
            body = json.loads(raw or "{}")
            if self.path == "/api/reference/delete":
                self.workspace.remove_reference(body["name"])
                self.reply({"ok": True})
            elif self.path == "/api/claude/mark":
                start_marking(self.workspace, self.jobs, body["file"], self.workspace.guidance().strip())
                self.reply({"ok": True})
            elif self.path == "/api/guidance":
                self.workspace.save_guidance(str(body["text"]))
                self.reply({"ok": True})
            elif self.path == "/api/claude/reject":
                self.jobs.reject(self.workspace.resolve(body["file"]), [str(item) for item in body["ids"]])
                self.reply({"ok": True})
            elif self.path == "/api/claude/cancel":
                self.jobs.cancel(self.workspace.resolve(body["file"]))
                self.reply({"ok": True})
            elif self.path == "/api/workspace":
                chosen = pick_folder(self.workspace.root)
                if chosen:
                    self.workspace.choose(chosen)
                self.reply({"root": str(self.workspace.root) if self.workspace.root else None,
                            "changed": bool(chosen)})
            elif self.path == "/api/save":
                save_marks(self.workspace.resolve(body["file"]), body["marks"])
                self.reply({"saved": len(body["marks"])})
            else:
                self.reply({"error": "not found"}, status=404)
        except PermissionError:
            self.reply({"error": "文件被其他程序占用，请先关闭正在打开它的 PDF 阅读器"}, status=409)
        except Exception as error:
            self.reply({"error": str(error)}, status=500)


def last_workspace():
    try:
        return json.loads(CONFIG.read_text(encoding="utf-8"))["workspace"]
    except (OSError, ValueError, KeyError):
        return None


def main():
    parser = argparse.ArgumentParser(description="Mark up the PDFs in a folder.")
    parser.add_argument("--root", help="workspace folder (default: the last one used)")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--ui-port", type=int, help="port of the Next.js development server")
    args = parser.parse_args()
    Handler.workspace = Workspace(args.root or last_workspace())
    Handler.ui_port = args.ui_port
    if not site_file("/") and not args.ui_port:
        print("The page is not built yet: run `npm install` and `npm run build` in web/")
    server = HTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{args.port}/"
    print(f"PDF Marker: {url}  (Ctrl+C to stop)")
    if not args.no_browser:
        webbrowser.open(url)
    server.serve_forever()


if __name__ == "__main__":
    main()
