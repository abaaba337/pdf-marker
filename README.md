# PDF Marker

Mark up a folder of PDFs in a local web page: ticks, crosses, highlights, comments, circles and lines. Marks are saved into the original PDF as standard annotations, so students see them in any PDF viewer, and they stay editable when you reopen the file here.

Everything runs on your own computer. The server listens on `127.0.0.1` only and the page loads nothing from the internet. Files leave the machine in one case: when you press the button that asks Claude to mark a file.

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
| `7` | Arrow | Drag towards what you mean. A linked comment box opens for typing. |

- **Grades.** Give a submission one grade, A+ to B-, with the bar at the bottom left. It is drawn in marker strokes on the first page, where it can be dragged, and shown beside the file in the list. Pressing the same grade again clears it.
- **Comment boxes.** `Enter` confirms and `Shift+Enter` starts a new line. Clicking elsewhere confirms too and carries on with the current tool. A box left empty is removed.
- **Linked comments.** A thin line joins the box to its mark, as in Word, and follows when either one moves. Deleting a mark deletes its comment.
- **Moving comments.** Drag a box under any tool. While typing, drag the dark bar on top of it.
- **Other keys.** `Ctrl+S` saves, `Ctrl+Z` and `Ctrl+Y` undo and redo, `Delete` removes the selection, `Esc` returns to Select.
- **Switching files** saves the current one first.
- **Side panels.** Folders open and close like a file explorer. Drag the inner edge of either side panel to resize it, and double-click the edge to reset it.

## Marking with Claude

The panel on the right opens by default, and the **Claude** button hides it. It needs [Claude Code](https://claude.com/claude-code) installed and signed in.

1. **Reference answers.** They sit under the workspace in the left panel. Upload the correct answers with **+ 上传**: PDF, Word (docx), HTML or common code files. Clicking a name opens it read-only beside the work, or below it on a narrow screen, and it stays open as you move between submissions. They belong to the whole workspace, so one upload serves every submission. They are stored in a hidden `.marker` folder.
2. **Marking rules.** Write what a good answer needs and how you want comments written. Say what each grade means too. The rules are kept once for the whole workspace.
3. **Mark.** Press the button. Claude marks the same page you are working on, with the same seven tools, and its reasoning appears in the panel.
4. **Keep what you want.** Claude's marks are ordinary marks from the moment they appear, so saving puts them in the PDF. Drag, resize or reword them like your own. Claude also proposes a grade, unless you have already given one, and the grade bar changes it. To drop one, press the × on its top right corner: it stays gone, and the panel can restore it. Marking again replaces Claude's last marks.

Pressing the button sends the PDF and its reference answers to Anthropic through Claude Code, so check that your institution allows this for the work you are marking. The copy sent is named `submission.pdf`, so the file name stays behind, and it doesn't include your marks. A name written inside the PDF is still sent.

The agent is shut in. It takes only `effortLevel` from your Claude Code settings, and loads no hooks, plugins, skills or MCP servers. Its only tools are `Read`, which is confined to a temporary folder, the seven marking tools in `marker_tools.py`, and `run_answer`. It is also told to ignore instructions written in the submission.

When a reference answer is a `.py` file, Claude runs it itself with `run_answer`, on your computer, and compares what it really prints line by line with the output printed in the submission. When they differ, it reads the student's code to find the line responsible. The tool takes only a reference file's name, so student code is never run. Only upload reference code you trust.

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

To block a commit that adds a PDF, enable the hook once per clone:

```
git config core.hooksPath .githooks
```

## License

MIT
