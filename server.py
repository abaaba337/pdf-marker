"""PDF Marker: mark up PDFs in a local web page. See README.md.

Marks are saved into the PDF itself as standard annotations, so any PDF viewer
shows them. Each one also carries its editing data under the MarkerData key,
which is how the site reopens a saved file with every mark still editable.
Annotations made by other tools are left alone.

Files stay on this machine: the server listens on 127.0.0.1 only and the page
loads nothing from the internet.
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

KEY = "MarkerData"
LEADER_KEY = "MarkerLeader"  # thin line from a mark to its note; rebuilt from the note on save
HERE = Path(__file__).resolve().parent
SITE = HERE / "web" / "out"  # the built page: run `npm run build` in web/
CONTENT_TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
                 ".txt": "text/plain; charset=utf-8", ".json": "application/json",
                 ".svg": "image/svg+xml", ".woff2": "font/woff2"}
CONFIG = Path.home() / ".pdf-marker.json"  # remembers the last workspace
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
    if kind in SHAPES:
        strokes = [[tuple(point(mark["x"] + u * mark["w"], mark["y"] + v * mark["h"]))
                    for u, v in stroke] for stroke in SHAPES[kind]]
        annot = page.add_ink_annot(strokes)
    elif kind == "line":
        annot = page.add_line_annot(point(mark["x1"], mark["y1"]), point(mark["x2"], mark["y2"]))
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
    if kind != "text":
        annot.set_colors(stroke=color)
    if kind in SHAPES or kind in ("line", "circle"):
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
        self.counts = {}  # path -> (modified time, marks), so listing does not reopen every PDF
        if root and Path(root).is_dir():
            self.root = Path(root).resolve()

    def choose(self, root):
        self.root = Path(root).resolve()
        CONFIG.write_text(json.dumps({"workspace": str(self.root)}, ensure_ascii=False), encoding="utf-8")

    def count(self, path):
        modified = path.stat().st_mtime
        cached = self.counts.get(path)
        if cached and cached[0] == modified:
            return cached[1]
        try:
            with fitz.open(path) as doc:
                marks = sum(len(marker_xrefs(doc, page)) for page in doc)
        except (fitz.FileDataError, RuntimeError):
            marks = 0  # damaged file: still listed; opening it reports the problem
        self.counts[path] = (modified, marks)
        return marks

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
                    groups.setdefault(rel.parent.as_posix(), []).append(
                        {"file": rel.as_posix(), "name": name, "marks": self.count(path)})
        return {"root": str(self.root),
                "groups": [{"dir": d, "files": f} for d, f in groups.items()]}

    def resolve(self, rel):
        if not self.root:
            raise ValueError("no workspace chosen")
        path = (self.root / rel).resolve()
        parts = path.relative_to(self.root).parts  # raises ValueError outside the workspace
        if any(p.startswith(".") for p in parts) or path.suffix.lower() != ".pdf" or not path.is_file():
            raise ValueError("not a PDF in this workspace")
        return path


class Handler(BaseHTTPRequestHandler):
    workspace = None
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
        if not self.allowed() or self.headers.get("Content-Type") != "application/json":
            return self.reply({"error": "forbidden"}, status=403)
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or "{}")
            if self.path == "/api/workspace":
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
