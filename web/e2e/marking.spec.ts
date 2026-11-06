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
  await expect(page.locator("#empty h1")).toBeVisible();
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
  await page.reload();
  await expect(page.locator(".file", { hasText: "nested.pdf" })).toBeVisible();
});

test("the sidebar resizes, remembers its width and resets", async ({ page }) => {
  await page.goto("/");
  const aside = page.locator("aside");
  const width = async () => (await aside.boundingBox())!.width;
  const edge = (await page.locator("#resizer").boundingBox())!;
  const x = edge.x + 4;
  expect(await width()).toBe(272);
  await drag(page, [x, 300], [x + 120, 300]);
  expect(await width()).toBe(392);
  await page.reload();
  await expect.poll(width).toBe(392);
  await drag(page, [x + 120, 300], [x - 400, 300]);
  expect(await width()).toBe(200);
  const narrow = (await page.locator("#resizer").boundingBox())!;
  await page.mouse.dblclick(narrow.x + 4, 300);
  await expect.poll(width).toBe(272);
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
  expect(Math.round(after.y - before.y)).toBe(40);
  await expect(marks(page)).toHaveCount(count);

  await page.mouse.click(after.x + 30, after.y + 6);  // a click edits it
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press("Enter");
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

test("the API refuses other sites", async ({ request }) => {
  const response = await request.post("/api/save", {
    headers: { Origin: "http://example.com", "Content-Type": "application/json" },
    data: { file: "x.pdf", marks: [] },
  });
  expect(response.status()).toBe(403);
});
