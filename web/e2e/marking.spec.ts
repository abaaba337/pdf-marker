import { type Page, expect, test } from "@playwright/test";

const origin = "http://127.0.0.1:8799";

async function openFolders(page: Page, ...names: string[]) {
  for (const name of names) {
    const folder = page.locator("details").filter({ has: page.getByTitle(name, { exact: true }) }).last();
    if (!(await folder.evaluate((node) => (node as HTMLDetailsElement).open))) {
      await page.getByTitle(name, { exact: true }).click();
    }
  }
}

async function openFile(page: Page, name: string, ...folders: string[]) {
  await page.goto("/");
  await expect(page.locator("summary").first()).toBeVisible();
  await openFolders(page, ...folders);
  await page.locator(".file", { hasText: name }).click();
  await expect(page.locator('.page[data-n="1"]')).toBeVisible();
}

async function pagePoint(page: Page, x: number, y: number, n = 0) {
  const box = (await page.locator(`.page[data-n="${n}"] > svg`).boundingBox())!;
  return [box.x + x, box.y + y] as const;
}

async function drag(page: Page, from: readonly [number, number], to: readonly [number, number]) {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 6 });
  await page.mouse.up();
}

const editor = (page: Page) => page.locator("textarea.note");
const notes = (page: Page) => page.locator(".page div.note");
const marks = (page: Page) => page.locator("[data-id]");
const leaders = (page: Page) => page.locator("[data-leader]");

async function saved(page: Page) {
  await page.keyboard.press("Control+s");
  await expect(page.locator("#status")).toContainText("已保存");
}

test.beforeEach(({ page }) => {
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith(origin) && !url.startsWith("data:")) throw new Error(`outside request: ${url}`);
  });
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("the tree nests folders, starts closed and sorts numbers naturally", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#empty h1")).toHaveText("打开一份 PDF");
  await expect(page.locator(".file", { hasText: "flow.pdf" })).toBeHidden();
  await expect(page.locator("#files > details > summary")).toHaveText(["Sheet 1", "Sheet 2", "Sheet 10"]);
  await openFolders(page, "Sheet 2", "Sheet 2/deep");
  await expect(page.locator(".file", { hasText: "nested.pdf" })).toBeVisible();
  // the browser's toggle event arrives a moment after the folder opens
  await expect.poll(() => page.evaluate(() => Object.values(localStorage).join())).toContain("Sheet 2/deep");
  await page.reload();
  await expect(page.locator(".file", { hasText: "nested.pdf" })).toBeVisible();
});

test("both side panels resize, remember their width and reset", async ({ page }) => {
  const cases = [
    { panel: "aside:not(#panel)", normal: 272, drag: 120, least: 200 },
    { panel: "#panel", normal: 340, drag: -120, least: 260 },
  ];
  for (const { panel, normal, drag: move, least } of cases) {
    await page.goto("/");
    await expect(page.locator(panel)).toBeVisible();
    const width = async () => Math.round((await page.locator(panel).boundingBox())!.width);
    await expect.poll(width).toBe(normal);
    const edge = async () => {
      const box = (await page.locator(`${panel} > .resizer`).boundingBox())!;
      return box.x + 4;
    };
    const x = await edge();
    await drag(page, [x, 300], [x + move, 300]);
    expect(await width()).toBe(normal + Math.abs(move));
    await page.reload();
    await expect.poll(width).toBe(normal + Math.abs(move));
    const wide = await edge();
    await drag(page, [wide, 300], [wide - Math.sign(move) * 500, 300]);
    expect(await width()).toBe(least);
    await page.mouse.dblclick(await edge(), 300);
    await expect.poll(width).toBe(normal);
    const box = (await page.locator(panel).boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(1360);
  }
});

test("a cross opens a linked box and the next click carries on", async ({ page }) => {
  await openFile(page, "flow.pdf", "Sheet 1");
  await page.keyboard.press("2");
  await page.mouse.click(...(await pagePoint(page, 40, 200)));
  await expect(editor(page)).toBeFocused();
  await expect(leaders(page)).toHaveCount(1);
  await page.keyboard.type("first");

  await page.mouse.click(...(await pagePoint(page, 40, 300)));
  await expect(editor(page)).toBeFocused();
  await expect(notes(page)).toHaveText(["first"]);

  await page.mouse.click(...(await pagePoint(page, 40, 400)));  // the empty box is dropped, its cross stays
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("third");
  await page.keyboard.press("Enter");
  await expect(editor(page)).toHaveCount(0);
  await expect(notes(page)).toHaveText(["first", "third"]);
  await expect(marks(page)).toHaveCount(5);
  await expect(page.locator("#tools button.on")).toHaveAttribute("aria-label", "打叉");

  await page.mouse.click(...(await pagePoint(page, 40, 500)));
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press("Enter");  // Enter on an empty box removes it
  await expect(editor(page)).toHaveCount(0);
  await expect(marks(page)).toHaveCount(6);

  await page.keyboard.press("1");
  await page.mouse.click(...(await pagePoint(page, 40, 600)));
  await expect(editor(page)).toHaveCount(0);  // ticks don't ask for a comment
});

test("a note drags while typing and under a drawing tool", async ({ page }) => {
  await openFile(page, "drag.pdf", "Sheet 1");
  await page.keyboard.press("2");
  await page.mouse.click(...(await pagePoint(page, 40, 200)));
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("drag me");

  const grip = (await page.locator(".grip").boundingBox())!;
  await drag(page, [grip.x + 40, grip.y + 3], [grip.x + 110, grip.y + 33]);
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue("drag me");
  await page.keyboard.type("!");
  await page.keyboard.press("Enter");

  const before = (await notes(page).boundingBox())!;
  const count = await marks(page).count();
  await drag(page, [before.x + 30, before.y + 6], [before.x + 90, before.y + 46]);
  const after = (await notes(page).boundingBox())!;
  expect(Math.round(after.x - before.x)).toBe(60);
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("");  // dragging selects no text
  expect(Math.round(after.y - before.y)).toBe(40);
  await expect(marks(page)).toHaveCount(count);

  await page.mouse.click(after.x + 30, after.y + 6);  // a click edits it
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press("Enter");
});

test("an arrow opens a linked box and keeps its head after saving", async ({ page }) => {
  await openFile(page, "later.pdf", "Sheet 10");
  await page.keyboard.press("7");
  await drag(page, await pagePoint(page, 100, 200), await pagePoint(page, 240, 260));
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("look here");
  await page.keyboard.press("Enter");
  await expect(page.locator("polygon.head")).toHaveCount(1);
  await expect(leaders(page)).toHaveCount(1);
  await saved(page);

  await openFile(page, "later.pdf", "Sheet 10");
  await expect(page.locator("polygon.head")).toHaveCount(1);
  await expect(marks(page)).toHaveCount(2);
});

test("saved marks reopen editable and a mark takes its note with it", async ({ page }) => {
  await openFile(page, "reopen.pdf", "Sheet 1");
  await page.keyboard.press("5");
  await drag(page, await pagePoint(page, 100, 200), await pagePoint(page, 280, 260));
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("circle note");
  await page.keyboard.press("Enter");
  await page.keyboard.press("3");
  await drag(page, await pagePoint(page, 100, 400), await pagePoint(page, 300, 420));
  await saved(page);

  await openFile(page, "reopen.pdf", "Sheet 1");
  await expect(marks(page)).toHaveCount(3);
  await expect(leaders(page)).toHaveCount(1);
  await expect(page.locator(".file.on .badge")).toHaveText("3");

  const note = (await notes(page).boundingBox())!;
  await page.mouse.dblclick(note.x + 20, note.y + 6);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" edited");
  await page.keyboard.press("Enter");
  await expect(notes(page)).toHaveText("circle note edited");

  const circle = (await page.locator("[data-id] ellipse").last().boundingBox())!;
  await page.mouse.click(circle.x + 1, circle.y + circle.height / 2);
  await expect(page.locator("[data-handle]")).toHaveCount(4);
  await page.keyboard.press("Delete");
  await expect(marks(page)).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(marks(page)).toHaveCount(3);

  await page.locator(".file", { hasText: "drag.pdf" }).click();  // switching files saves
  await expect(page.locator(".file", { hasText: "reopen.pdf" }).locator(".badge")).toHaveText("3");
});

test("Claude's marks arrive as ordinary marks, edit like them, and can be deleted", async ({ page }) => {
  const remove = page.locator(".claudeDelete button");
  await openFile(page, "claude.pdf", "Sheet 1");
  await expect(page.locator("#panel")).toBeVisible();  // open from the start
  await page.locator("#referenceInput").setInputFiles({
    name: "answer.py",
    mimeType: "text/plain",
    buffer: Buffer.from("print('answer')"),
  });
  await expect(page.locator("#references .row", { hasText: "answer.py" })).toBeVisible();

  await page.getByRole("button", { name: "让 Claude 批改" }).click();

  // live: the first marks and notes are on the page while Claude is still working
  await expect(marks(page).first()).toBeVisible();
  await expect(page.locator(".thinking", { hasText: "正在看第 1 处" })).toBeVisible();
  await expect(page.locator(".thinking", { hasText: "读取 submission.pdf" })).toBeVisible();
  await expect(page.locator(".thinking .run").first()).toContainText("运行参考答案");
  await expect(page.locator(".thinking .output").first()).toContainText("answer");
  await expect(page.getByRole("button", { name: "批改中，点此取消" })).toBeVisible();
  const spark = page.locator(".working .spark");  // it visibly moves, so nobody thinks it has hung
  const first = await spark.textContent();
  await expect.poll(() => spark.textContent()).not.toBe(first);

  await expect(page.getByText("Output seen.")).toBeVisible();  // Claude got what the answer really prints
  await expect(page.getByRole("button", { name: "重新批改" })).toBeVisible();
  await expect(page.locator(".working")).toHaveCount(0);
  await expect(page.locator(".page")).toHaveCount(2);  // one copy of the work, no second column
  await expect(marks(page)).toHaveCount(8);  // a kind that is not on the toolbar is dropped
  await expect(page.locator("polygon.head")).toHaveCount(1);
  await expect(remove).toHaveCount(5);  // one per mark, with its note

  // every delete button sits just outside the top right corner, clear of the resize handle
  const note = page.locator(".page .note", { hasText: "Check this sign." });
  const corner = (await note.boundingBox())!;
  const button = (await remove.nth(1).boundingBox())!;
  expect(button.x).toBeGreaterThanOrEqual(corner.x + corner.width + 4);
  expect(button.y + button.height).toBeLessThanOrEqual(corner.y);
  expect(button.x - (corner.x + corner.width)).toBeLessThan(12);

  // Claude's marks drag and edit like any other
  await drag(page, [corner.x + 30, corner.y + 6], [corner.x + 90, corner.y + 12]);
  const moved = (await note.boundingBox())!;
  expect(Math.round(moved.x - corner.x)).toBe(60);
  await page.mouse.dblclick(moved.x + 30, moved.y + 6);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Edited");
  await page.keyboard.press("Enter");
  const edited = page.locator(".page .note", { hasText: "Check this sign. Edited" });
  await expect(edited).toBeVisible();

  await remove.nth(2).click();  // the circle and its note go
  await expect(marks(page)).toHaveCount(6);
  const circle = page.locator(".proposal", { hasText: "Say why this holds." });
  await expect(circle).toHaveClass(/rejected/);
  await saved(page);
  await expect(page.locator("#status")).toContainText("6");  // what is left is in the PDF

  await openFile(page, "claude.pdf", "Sheet 1");
  await expect(marks(page)).toHaveCount(6);
  await expect(edited).toBeVisible();
  await expect(remove).toHaveCount(4);
  await expect(page.getByText("Reference seen.")).toBeVisible();
  await expect(page.locator(".thinking", { hasText: "正在看第 5 处" })).toBeVisible();
  await expect(circle).toHaveClass(/rejected/);  // a deleted mark doesn't come back

  await circle.getByRole("button", { name: "恢复" }).click();
  await expect(marks(page)).toHaveCount(8);

  // a new run replaces the last one instead of doubling it
  await page.getByRole("button", { name: "重新批改" }).click();
  await expect(page.getByRole("button", { name: "批改中，点此取消" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新批改" })).toBeVisible({ timeout: 10000 });
  await expect(marks(page)).toHaveCount(8);
  await expect(page.locator(".thinking", { hasText: "读取 reference_1.output.txt" })).toBeVisible();
  await expect(page.locator(".thinking .run")).toHaveCount(0);  // the answer hasn't changed, so it isn't run again

  // the teacher asks for changes in words, and Claude makes them on the page
  const box = page.locator("#chat textarea");
  await box.fill("把勾去掉，语气软一点");
  await box.press("Enter");
  await expect(page.locator(".turn.teacher")).toHaveText("把勾去掉，语气软一点");
  // like a chat with an agent: the steps run inside the conversation, not in the marking notes above
  await expect(page.locator("#chat .thinkingSteps.live", { hasText: "看看要改什么" })).toBeVisible();
  await expect(page.locator("#chat .working")).toBeVisible();
  await expect(page.locator(".thinking", { hasText: "看看要改什么" })).toHaveCount(0);
  await expect(page.locator(".turn.claude")).toHaveText("已按要求修改。");
  const steps = page.locator("#chat details.steps");  // finished steps fold away, and open again
  await expect(steps.locator("summary")).toContainText("思路 · 2 步");
  await expect(steps.locator(".thinkingSteps")).toBeHidden();
  await steps.locator("summary").click();
  await expect(steps.locator(".thinkingSteps")).toContainText("读取 marks.json");
  await steps.locator("summary").click();
  await expect(page.locator(".page .note", { hasText: "Softer wording." })).toBeVisible();
  await expect(page.locator(".page .note", { hasText: "Look here." })).toHaveCount(0);
  await expect(page.locator(".page .note", { hasText: "Added on request." })).toBeVisible();
  await expect(page.locator(".gradeStamp")).toHaveAttribute("data-letter", "B+");
  await expect(marks(page)).toHaveCount(12);  // one tick gone; two comments with their marks, and a grade, added

  // a tick's line leaves from its point
  const fromPoint = await page.evaluate(() => {
    const points = [...document.querySelectorAll("[data-id] path")].map((path) => {
      const found = /^M\S+ \S+L(\S+) (\S+)L\S+ \S+$/.exec(path.getAttribute("d") ?? "");
      return found ? `${Number(found[1]).toFixed(2)},${Number(found[2]).toFixed(2)}` : "";
    });
    return [...document.querySelectorAll("[data-leader]")].some((line) => {
      const start = `${Number(line.getAttribute("x1")).toFixed(2)},${Number(line.getAttribute("y1")).toFixed(2)}`;
      return points.includes(start);
    });
  });
  expect(fromPoint).toBe(true);

  // the list above follows the conversation, which sits in its own block below it
  await expect(page.locator(".proposal", { hasText: "Softer wording." })).toBeVisible();
  await expect(page.locator(".proposal", { hasText: "Look here." })).toHaveCount(0);
  await expect(page.locator(".proposal", { hasText: "Added on request." })).toBeVisible();
  await expect(page.locator(".proposal")).toHaveCount(6);  // one tick left the list, and two new marks joined it
  await expect(page.locator(".panelBody #chat")).toHaveCount(0);
  const list = (await page.locator(".proposal").first().boundingBox())!;
  const input = (await page.locator(".chatInput").boundingBox())!;
  expect(Math.round(input.x)).toBe(Math.round(list.x));  // the two blocks line up
  expect(Math.round(input.width)).toBe(Math.round(list.width));
  const panel = (await page.locator("#panel").boundingBox())!;
  const block = (await page.locator("#chat").boundingBox())!;
  expect(Math.round(block.y + block.height)).toBe(Math.round(panel.y + panel.height));
  expect(Math.abs(block.height - panel.height / 2)).toBeLessThan(2);  // half and half by default
  await page.keyboard.press("Escape");
  await page.locator("main").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");  // a change can be undone
  await expect(page.locator(".gradeStamp")).toHaveCount(0);
  await page.keyboard.press("Control+y");
  await saved(page);

  await openFile(page, "claude.pdf", "Sheet 1");  // and nothing is applied twice on reopening
  await expect(page.locator(".turn.claude")).toHaveText("已按要求修改。");
  await expect(marks(page)).toHaveCount(12);
  await expect(page.locator(".page .note", { hasText: "Softer wording." })).toBeVisible();

  // a reply can be stopped, and the message stays in the conversation
  const before = await marks(page).count();
  await box.fill("先别改了");
  await box.press("Enter");
  await expect(page.locator("#chat .working")).toBeVisible();
  await page.getByRole("button", { name: "停止" }).click();
  await expect(page.locator(".turn.claude").last()).toHaveText("已停止。", { timeout: 4000 });
  await expect(page.locator(".turn.teacher").last()).toHaveText("先别改了");
  await expect(page.locator("#chat .working")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "发送" })).toBeVisible();
  await expect(marks(page)).toHaveCount(before);

  await page.getByRole("button", { name: "全部删除" }).click();
  await expect(marks(page)).toHaveCount(1);  // Claude's marks go, and the grade stays
  await expect(page.getByRole("button", { name: "全部删除" })).toBeDisabled();
});

test("a submission gets one grade, stamped on it and shown in the list", async ({ page }) => {
  await openFile(page, "nested.pdf", "Sheet 2", "Sheet 2/deep");
  const bar = page.locator("#grades");
  const stamp = page.locator(".gradeStamp");
  await expect(bar.getByRole("button")).toHaveText(["A+", "A", "A-", "B+", "B", "B-"]);

  await bar.getByRole("button", { name: "A-" }).click();
  await expect(stamp).toHaveAttribute("data-letter", "A-");
  await bar.getByRole("button", { name: "B+" }).click();
  await expect(stamp).toHaveCount(1);  // replaced, not added
  await expect(stamp).toHaveAttribute("data-letter", "B+");
  await expect(bar.locator("button.on")).toHaveText("B+");

  const box = (await stamp.boundingBox())!;  // it drags, and a double click doesn't turn it into free text
  await drag(page, [box.x + 20, box.y + 20], [box.x - 40, box.y + 40]);
  const moved = (await stamp.boundingBox())!;
  expect(Math.round(box.x - moved.x)).toBe(60);
  await page.mouse.dblclick(moved.x + 20, moved.y + 20);
  await expect(editor(page)).toHaveCount(0);
  await bar.getByRole("button", { name: "A", exact: true }).click();
  expect(Math.round((await stamp.boundingBox())!.x)).toBe(Math.round(moved.x));  // keeps its place
  await saved(page);

  await expect(page.locator(".file.on .gradeTag")).toHaveText("A");
  await openFile(page, "nested.pdf", "Sheet 2", "Sheet 2/deep");
  await expect(stamp).toHaveAttribute("data-letter", "A");
  await expect(bar.locator("button.on")).toHaveText("A");

  await bar.getByRole("button", { name: "A", exact: true }).click();  // the same grade again clears it
  await expect(stamp).toHaveCount(0);
  await saved(page);
  await expect(page.locator(".file.on .gradeTag")).toHaveCount(0);
});

test("a comment box resizes from every corner, and never gets shorter than its text", async ({ page }) => {
  await openFile(page, "flow.pdf", "Sheet 1");
  await page.keyboard.press("4");
  await page.mouse.click(...(await pagePoint(page, 300, 300)));
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("Resize me");
  await page.keyboard.press("Enter");
  await page.keyboard.press("v");
  const note = page.locator(".page .note", { hasText: "Resize me" });
  const start = (await note.boundingBox())!;
  await page.mouse.click(start.x + 20, start.y + 8);
  const pull = async (handle: string, dx: number, dy: number) => {
    const h = (await page.locator(`[data-handle="${handle}"]`).boundingBox())!;
    const x = h.x + h.width / 2, y = h.y + h.height / 2;
    await drag(page, [x, y], [x + dx, y + dy]);
    return (await note.boundingBox())!;
  };

  const taller = await pull("se", 40, 60);
  expect(Math.round(taller.width - start.width)).toBe(40);
  expect(Math.round(taller.height - start.height)).toBe(60);

  const wider = await pull("ne", 30, -20);  // the corner a delete button used to cover
  expect(Math.round(wider.width - taller.width)).toBe(30);
  expect(Math.round(wider.height - taller.height)).toBe(20);

  const left = await pull("nw", -25, 10);
  expect(Math.round(left.x - wider.x)).toBe(-25);
  expect(Math.round(left.height - wider.height)).toBe(-10);

  const squashed = await pull("se", 0, -400);
  expect(squashed.height).toBeGreaterThanOrEqual(start.height - 1);  // the text always fits
  await saved(page);
  await openFile(page, "flow.pdf", "Sheet 1");
  await expect(page.locator(".page .note", { hasText: "Resize me" })).toBeVisible();
});

test("marking rules are kept for the folder and reach Claude", async ({ page }) => {
  await openFile(page, "later.pdf", "Sheet 10");
  const rules = page.locator("#rules");
  await rules.fill("Use the lecturer's notation.");
  await page.getByRole("button", { name: "让 Claude 批改" }).click();
  await expect(page.getByText("Rules seen.")).toBeVisible();

  await page.reload();
  await expect(page.locator(".file.on")).toContainText("later.pdf");
  await expect(rules).toHaveValue("Use the lecturer's notation.");
});

test("moving to another file while Claude works doesn't restart it", async ({ page }) => {
  await openFile(page, "switch.pdf", "Sheet 1");
  await page.getByRole("button", { name: "让 Claude 批改" }).click();
  const seconds = async () => parseInt((await page.locator(".working .elapsed").textContent()) ?? "0", 10);
  await expect(page.locator(".thinking", { hasText: "正在看第 2 处" })).toBeVisible();
  await expect.poll(seconds).toBeGreaterThanOrEqual(1);
  const before = await seconds();

  await page.locator(".file", { hasText: "rotated.pdf" }).click();
  await expect(page.locator(".file.on")).toContainText("rotated.pdf");
  await page.locator(".file", { hasText: "switch.pdf" }).click();
  await expect(page.locator(".file.on")).toContainText("switch.pdf");

  await expect(page.locator(".thinking", { hasText: "正在看第 2 处" })).toBeVisible();  // the same run, further on
  expect(await seconds()).toBeGreaterThanOrEqual(before);
  await expect(page.getByRole("button", { name: "重新批改" })).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".thinking .step", { hasText: "正在看第 1 处" })).toHaveCount(1);  // it ran once
  await expect(page.locator(".claudeDelete button")).toHaveCount(5);  // and nothing doubled
});

test("cancelling stops Claude straight away", async ({ page }) => {
  await page.goto("/");
  await page.locator(".file", { hasText: "rotated.pdf" }).click();
  await expect(page.locator('.page[data-n="1"]')).toBeVisible();
  await page.getByRole("button", { name: "让 Claude 批改" }).click();
  await expect(marks(page).first()).toBeVisible();
  await page.getByRole("button", { name: "批改中，点此取消" }).click();
  await expect(page.getByRole("button", { name: "让 Claude 批改" })).toBeVisible({ timeout: 2000 });
  await page.waitForTimeout(800);
  await expect(page.getByRole("button", { name: "让 Claude 批改" })).toBeVisible();  // and it stays stopped
});

test("reference answers open read-only in their own column", async ({ page }) => {
  await openFile(page, "nested.pdf", "Sheet 2", "Sheet 2/deep");
  const pane = page.locator("#reference");
  const upload = (name: string, text: string) =>
    page.locator("#referenceInput").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(text) });

  const open = (name: string) => page.locator(".referenceName", { hasText: name }).click();

  await upload("key.py", "def f(x):\n    return x + 1\n");
  await expect(page.locator("#references .row", { hasText: "key.py" })).toBeVisible();
  await expect(pane).toHaveCount(0);  // uploading doesn't open the column
  await open("key.py");
  await expect(pane).toContainText("key.py");
  await expect(pane.locator("pre .hljs-keyword").first()).toHaveText("def");
  await expect(pane.locator("textarea, input, [contenteditable]")).toHaveCount(0);

  await upload("answer.html", "<h1>Result</h1><script>document.title = 'ran'</script>");
  await expect(page.locator("#references .row", { hasText: "answer.html" })).toBeVisible();
  await open("answer.html");
  await expect(pane.frameLocator("iframe").locator("h1")).toHaveText("Result");
  await expect(pane.locator("iframe")).toHaveAttribute("sandbox", "");
  await expect(page).toHaveTitle("PDF Marker");

  await upload("notes.ipynb", JSON.stringify({ cells: [
    { cell_type: "markdown", source: ["# Plan"], outputs: [] },
    { cell_type: "code", source: ["print(1)"], outputs: [{ text: ["1"] }] },
  ] }));
  await expect(page.locator("#references .row", { hasText: "notes.ipynb" })).toBeVisible();
  await open("notes.ipynb");
  await expect(pane.locator(".cell.markdown")).toContainText("Plan");
  await expect(pane.locator(".cell .output")).toHaveText("1");

  await page.locator(".referenceName", { hasText: "key.py" }).click();
  await expect(pane.locator("pre .hljs-keyword").first()).toBeVisible();

  // one upload for the whole workspace: the column stays while moving between submissions
  await page.locator(".file", { hasText: "rotated.pdf" }).click();
  await expect(page.locator(".file.on")).toContainText("rotated.pdf");
  await expect(pane.locator("pre .hljs-keyword").first()).toBeVisible();
  await expect(page.locator("#references .row", { hasText: "key.py" })).toBeVisible();
  await openFolders(page, "Sheet 1");
  await page.locator(".file", { hasText: "drag.pdf" }).click();
  await expect(page.locator(".file.on")).toContainText("drag.pdf");
  await expect(pane).toContainText("key.py");

  await page.getByRole("button", { name: "关闭参考答案" }).click();
  await expect(pane).toHaveCount(0);
  await expect(page.locator(".page[data-n=\"0\"]")).toBeVisible();
});

test("the reference sits beside the work when there is room, and below it when there isn't", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await openFile(page, "nested.pdf", "Sheet 2", "Sheet 2/deep");
  await page.locator("#referenceInput").setInputFiles({
    name: "layout.py",
    mimeType: "text/plain",
    buffer: Buffer.from("x = 1\n"),
  });
  await page.locator(".referenceName", { hasText: "layout.py" }).click();
  const pane = page.locator("#reference");
  const work = page.locator("main");
  await expect(pane).toBeVisible();
  const box = async (locator: typeof pane) => (await locator.boundingBox())!;

  expect((await box(pane)).x).toBeGreaterThanOrEqual((await box(work)).x + (await box(work)).width - 1);

  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(page.locator(".app.stacked")).toBeVisible();
  await expect.poll(async () => (await box(pane)).y).toBeGreaterThan(400);
  const below = await box(pane);
  const above = await box(work);
  expect(below.y).toBeGreaterThanOrEqual(above.y + above.height - 1);
  expect(Math.round(below.width)).toBe(Math.round(above.width));
  expect(below.x + below.width).toBeLessThanOrEqual(1100);

  for (const width of [1760, 1500, 1300]) {  // nothing is cut off at the usual widths, with both panels open
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.locator(".app > header").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1100, height: 900 });

  // the toolbar's controls never land on each other
  const history = await box(page.locator(".history"));
  expect((await box(page.locator("#save"))).x).toBeGreaterThanOrEqual(history.x + history.width);

  // the height drags, and the page never spills out
  const edge = (await box(page.locator("#reference .resizer"))).y + 4;
  await drag(page, [below.x + 200, edge], [below.x + 200, edge - 100]);
  expect(Math.round((await box(pane)).height)).toBe(Math.round(below.height) + 100);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.setViewportSize({ width: 1800, height: 900 });
  await expect(page.locator(".app.stacked")).toHaveCount(0);
});

test("nothing invites a browser to translate the student's work", async ({ page }) => {
  await openFile(page, "nested.pdf", "Sheet 2", "Sheet 2/deep");
  await expect(page.locator("html")).toHaveAttribute("translate", "no");
  await expect(page.locator('meta[name="google"]')).toHaveAttribute("content", "notranslate");
  await expect(page.locator(".page img")).toHaveCount(0);
  await expect(page.locator(".page .scan").first()).toHaveAttribute("translate", "no");
  await expect.poll(() => page.locator(".page .scan").first().evaluate((node) => getComputedStyle(node).backgroundImage))
    .toContain("/api/page");
});

test("a reload comes back to the same submission, place and reference", async ({ page }) => {
  await openFile(page, "flow.pdf", "Sheet 1");
  await page.getByRole("button", { name: "放大" }).click();
  await page.locator("#referenceInput").setInputFiles({
    name: "stay.py",
    mimeType: "text/plain",
    buffer: Buffer.from("x = 1\n"),
  });
  await page.locator(".referenceName", { hasText: "stay.py" }).click();
  await expect(page.locator("#reference")).toContainText("stay.py");
  const main = page.locator("main");
  await main.evaluate((node) => { node.scrollTop = 300; });
  await page.waitForTimeout(100);
  const zoom = await page.locator("#zoomLabel").textContent();

  await page.addInitScript(() => {  // the empty page must not flash up, even for a moment
    new MutationObserver(() => {
      if (document.getElementById("empty")) sessionStorage.setItem("emptyShown", "yes");
    }).observe(document, { childList: true, subtree: true });
  });
  await page.reload();
  await expect(page.locator(".file.on")).toContainText("flow.pdf");
  expect(await page.evaluate(() => sessionStorage.getItem("emptyShown"))).toBeNull();
  await expect(page.locator('.page[data-n="1"]')).toBeVisible();
  await expect(page.locator("#empty")).toHaveCount(0);
  await expect(page.locator("#reference")).toContainText("stay.py");
  await expect(page.locator("#zoomLabel")).toHaveText(zoom!);
  await expect.poll(() => main.evaluate((node) => Math.round(node.scrollTop))).toBe(300);
});

test("zooming zooms the work and not the browser page", async ({ page }) => {
  await openFile(page, "flow.pdf", "Sheet 1");
  const label = page.locator("#zoomLabel");
  const percent = async () => parseInt((await label.textContent())!, 10);
  const toolbar = (await page.locator("#tools").boundingBox())!;
  const start = await percent();

  const box = (await page.locator('.page[data-n="0"]').boundingBox())!;
  await page.mouse.move(box.x + 200, box.y + 200);
  const handled = await page.evaluate(() => !window.dispatchEvent(new WheelEvent("wheel", { ctrlKey: true, deltaY: -150, cancelable: true, clientX: 500, clientY: 300 })));
  expect(handled).toBe(true);  // the browser's own zoom was stopped
  await expect.poll(percent).toBeGreaterThan(start);
  expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);

  const wheeled = await percent();
  await page.keyboard.press("Control+-");
  await expect.poll(percent).toBeLessThan(wheeled);
  const smaller = await percent();
  await page.keyboard.press("Control+=");
  await expect.poll(percent).toBeGreaterThan(smaller);
  await page.keyboard.press("Control+0");
  await expect.poll(percent).toBe(start);

  const after = (await page.locator("#tools").boundingBox())!;
  expect(after.width).toBe(toolbar.width);  // the interface keeps its size
});

test("the API refuses other sites", async ({ request }) => {
  const response = await request.post("/api/save", {
    headers: { Origin: "http://example.com", "Content-Type": "application/json" },
    data: { file: "x.pdf", marks: [] },
  });
  expect(response.status()).toBe(403);
});
