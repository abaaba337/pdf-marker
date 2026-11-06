"""Everything that must pass before a commit. Run: python scripts/check.py"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYTHON = f'"{sys.executable}"'
STEPS = [
    ("leak guard", f"{PYTHON} scripts/guard.py", ROOT),
    ("server tests", f"{PYTHON} test_server.py", ROOT),
    ("type check", "npm run typecheck", ROOT / "web"),
    ("build", "npm run build", ROOT / "web"),
    ("browser tests", "npm run e2e", ROOT / "web"),
]


def main():
    for name, command, folder in STEPS:
        print(f"\n== {name} ==", flush=True)
        if subprocess.run(command, cwd=folder, shell=True).returncode:
            sys.exit(f"\nFAILED: {name}")
    print("\nall checks passed")


if __name__ == "__main__":
    main()
