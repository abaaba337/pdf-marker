# PDF Marker

Mark up a folder of PDFs in a local web page: ticks, crosses, highlights, comments, circles and lines. Marks are saved into the original PDF as standard annotations, so students see them in any PDF viewer, and they stay editable when you reopen the file here.

Everything runs on your own computer. The server listens on `127.0.0.1` only and the page loads nothing from the internet, so no file leaves the machine.

## Start

Needs Python 3.10+ with tkinter, which the standard Windows and conda installers include, and Node.js 20+ to build the page.

```
pip install -r requirements.txt
cd web
npm install
npm run build
cd ..
python server.py
```

On Windows, double-click `start.cmd`, which builds the page the first time. Click **选择工作区** and pick a folder: every PDF in it and in its subfolders is listed, grouped by folder, with a count of the marks in each. The folder is remembered for next time (in `~/.pdf-marker.json`). `python server.py --root <folder>` opens a specific one.

## Marking

| Key | Tool | Use |
| --- | --- | --- |
| `V` | Select | Click to select. Drag to move, drag a corner to resize, double-click a comment to edit it. |
| `1` | Tick | Click. |
| `2` | Cross | Click. A linked comment box opens for typing. |
| `3` | Highlight | Drag over the area. |
| `4` | Comment | Click, then type. |
| `5` | Circle | Drag. A linked comment box opens for typing. |
| `6` | Line | Drag. A linked comment box opens for typing. |

- **Comment boxes.** `Enter` confirms and `Shift+Enter` starts a new line. Clicking elsewhere confirms too and carries on with the current tool. A box left empty is removed.
- **Linked comments.** A thin line joins the box to its mark, as in Word, and follows when either one moves. Deleting a mark deletes its comment.
- **Moving comments.** Drag a box under any tool. While typing, drag the dark bar on top of it.
- **Other keys.** `Ctrl+S` saves, `Ctrl+Z` and `Ctrl+Y` undo and redo, `Delete` removes the selection, `Esc` returns to Select.
- **Switching files** saves the current one first.
- **Sidebar.** Folders open and close like a file explorer. Drag the sidebar's right edge to resize it, and double-click the edge to reset it.

## Saving

Saving overwrites the PDF in place. The first save keeps the untouched file in a `.orig` folder beside it. Annotations made by other programs are preserved, but they can't be edited here. Close the PDF in any other viewer before saving, because Windows locks open files.

## Development

`server.py` reads and writes the PDFs. The page in `web/` is a Next.js app, built to a static site that `server.py` serves, so everyday use needs only one process.

To work on the page, double-click `dev.cmd` and open http://127.0.0.1:3000. Edits appear there without reloading. That page uses your real workspace, so point automated tests at a throwaway one with `python server.py --root <folder>`.

After changing the page, rebuild it with `npm run build` in `web/`, or `start.cmd` keeps serving the previous build.

## Tests

```
python scripts/check.py
```

This runs the leak guard, server tests, type check, build and browser tests. The browser tests need Chrome, and they use generated PDFs in a temporary folder, never your workspace. CI runs the same script on every push.

To block a commit that adds a PDF or a local path, enable the hook once per clone:

```
git config core.hooksPath .githooks
```
