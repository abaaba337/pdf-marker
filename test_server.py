"""Round-trip checks on synthetic PDFs. Run: python test_server.py"""
import tempfile
from pathlib import Path

import fitz

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


def main():
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        path = root / "sheet.pdf"
        sample(path)
        check_saving(path)
        check_rotation(path)
        check_workspace(root)
        check_site(root)
    print("all checks passed")


if __name__ == "__main__":
    main()
