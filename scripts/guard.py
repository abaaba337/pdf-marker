"""Refuse files that must never reach this public repository. Runs as the pre-commit hook."""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BLOCKED_TYPES = {".pdf", ".xlsx", ".xls", ".docx", ".doc", ".csv", ".zip"}
MAX_BYTES = 1_000_000
GENERATED = {"web/package-lock.json"}
LOCAL_PATH = re.compile(r"[A-Za-z]:[\\/]+Users[\\/]|/home/[a-z]|/Users/[A-Za-z]")


def problems():
    listed = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT, text=True, encoding="utf-8")
    for name in filter(None, listed.split("\0")):
        path = ROOT / name
        if Path(name).suffix.lower() in BLOCKED_TYPES:
            yield f"{name}: this file type can hold student work"
        if not path.is_file() or name in GENERATED:
            continue
        if path.stat().st_size > MAX_BYTES:
            yield f"{name}: larger than {MAX_BYTES} bytes"
        elif LOCAL_PATH.search(path.read_text(encoding="utf-8", errors="ignore")):
            yield f"{name}: contains a path from someone's computer"


def main():
    found = list(problems())
    for problem in found:
        print("blocked:", problem)
    if found:
        sys.exit(1)
    print("guard: nothing blocked")


if __name__ == "__main__":
    main()
