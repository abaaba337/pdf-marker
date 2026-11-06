# PDF Marker

Local tool for marking up PDFs. People use it on real student work, and this repository is public, so the privacy rules below are hard rules.

## Layout

- `server.py`: Python server on `127.0.0.1`. Reads and writes PDFs with PyMuPDF, serves the built page.
- `web/`: Next.js app (read `web/AGENTS.md` first). `lib/marks.ts` holds types and geometry, `lib/store.ts` all state and gestures, `components/` rendering only.
- `web/e2e/`: browser tests. `scripts/e2e_server.py` gives them a throwaway workspace of generated PDFs.
- `scripts/check.py`: everything that must pass before a commit.

Run the app with `start.cmd`, or `dev.cmd` for hot reload at http://127.0.0.1:3000.

## Hard rules

- **No student data in this repository.** No PDFs, rosters, marks or names, in code, tests, fixtures, screenshots or commit messages. Tests generate their own PDFs. `scripts/guard.py` blocks the obvious cases, and it can't recognise a name.
- **Automated tests never touch a real workspace.** Never script the page at port 3000 or 8765: both can save into real PDFs. Use `npm run e2e`, or `python server.py --root <throwaway folder>`.
- **Nothing leaves the machine.** Keep the `127.0.0.1` binding and the Host and Origin checks. The page loads no CDN, web font or analytics, and `web/e2e` fails on any outside request.
- **Workspace paths come only from the native folder dialog or `--root`,** never from an HTTP request.
- **Saved PDFs are the database.** Each mark's JSON is stored in the file under `MarkerData`, and `server.py` and `web/lib/marks.ts` must agree on it. Old files have to keep opening, so only add optional fields.
- **Saving never loses the submission.** Keep the atomic replace, the one-time `.orig/` backup and other tools' annotations.

## Before committing

Run `python scripts/check.py`, which covers the leak guard, server tests, type check, build and browser tests. Enable the guard once per clone with `git config core.hooksPath .githooks`.

After a page change, run `npm run build` in `web/`: `start.cmd` serves `web/out` and doesn't rebuild an existing one.

## Traps already paid for

- **Focus a new comment box on the next frame.** The mousedown that created it otherwise takes the focus back, the box blurs while empty and is deleted.
- **Focus with `preventScroll`,** or the page jumps and clicks land in the wrong place.
- **The svg captures the pointer,** so `dblclick` targets the svg, not the mark. Use the current selection.
- **While a note is being typed, never unmount the textarea.** It would blur and commit.
- **Build highlight quads from the displayed corners.** On a rotated page a rectangle's `.quad` gives the wrong shape.
- **`doc.new_page()` invalidates earlier page objects** in PyMuPDF. Fetch them again.
- **Check rendering by looking at it.** Render the saved PDF to an image: a text dump can't show a missing leader line or an unreadable note.
- **A closed `<details>` keeps its children in the DOM** and they can still report `offsetParent`. Assert visibility with Playwright.
