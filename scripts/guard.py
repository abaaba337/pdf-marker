"""Refuse PDFs: this repository is public and the PDFs marked with it are student work.

Runs as the pre-commit hook. Tests generate their own PDFs in a temporary folder.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    listed = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT, text=True, encoding="utf-8")
    found = [name for name in listed.split("\0") if name.lower().endswith(".pdf")]
    for name in found:
        print("blocked:", name)
    if found:
        sys.exit(1)
    print("guard: no PDFs")


if __name__ == "__main__":
    main()
