"""Serve the built page on a throwaway workspace of generated PDFs, for the browser tests."""
import sys
import tempfile
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import claude_marker  # noqa: E402
import server  # noqa: E402

PORT = "8799"
FILES = [
    "Sheet 1/flow.pdf",
    "Sheet 1/drag.pdf",
    "Sheet 1/reopen.pdf",
    "Sheet 1/claude.pdf",
    "Sheet 2/deep/nested.pdf",
    "Sheet 10/later.pdf",
    "rotated.pdf",
]


def write_pdf(path, rotation=0):
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = fitz.open()
    for number in (1, 2):
        page = doc.new_page(width=595, height=842)
        for line in range(12):
            page.insert_text((72, 100 + line * 40), f"Question {number}, line {line}", fontsize=13)
        page.set_rotation(rotation)
    doc.save(path)
    doc.close()


def main():
    claude_marker.COMMAND = [sys.executable, str(ROOT / "scripts" / "fake_claude.py")]
    root = Path(tempfile.mkdtemp(prefix="pdf-marker-e2e-"))
    for name in FILES:
        write_pdf(root / name, rotation=90 if name == "rotated.pdf" else 0)
    sys.argv = ["server.py", "--root", str(root), "--port", PORT, "--no-browser"]
    server.main()


if __name__ == "__main__":
    main()
