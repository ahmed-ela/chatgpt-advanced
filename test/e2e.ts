import { createServer } from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(appDir, "dist");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const hostId = "plannotator-chatgpt-root";

await Bun.$`bun run --cwd ${appDir} build`.quiet();

const harnessFile = Bun.file(resolve(appDir, "test/harness.html"));
const harnessHtml = await harnessFile.text();

const server = createServer((req, res) => {
  if (!req.url || req.url === "/" || req.url === "/harness.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(harnessHtml);
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", () => resolvePromise()));
const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("Failed to start harness server");
}

const harnessUrl = `http://127.0.0.1:${address.port}/harness.html`;
const storageKey = `plannotator-chatgpt-notes:v1:${new URL(harnessUrl).origin}${new URL(harnessUrl).pathname}`;
const profileDir = join(tmpdir(), `plannotator-browser-extension-${Date.now()}`);
mkdirSync(profileDir, { recursive: true });

let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;

try {
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    pipe: true,
    enableExtensions: [distDir],
    args: [
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-search-engine-choice-screen",
      "--window-size=1440,1200",
    ],
    defaultViewport: { width: 1440, height: 1200 },
  });

  const page = await browser.newPage();
  await page.goto(harnessUrl, { waitUntil: "networkidle0" });

  await page.waitForFunction((rootId: string) => {
    return Boolean(document.getElementById(rootId)?.shadowRoot);
  }, {}, hostId);

  await page.evaluate(() => {
    const target = Array.from(document.querySelectorAll("[data-message-author-role='assistant']")).find((element) =>
      element.textContent?.includes("latency budgets"),
    );
    if (!target) throw new Error("Assistant message not found");

    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const content = node.textContent ?? "";
      const start = content.indexOf("latency budgets");
      if (start === -1) continue;

      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + "latency budgets".length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      return;
    }

    throw new Error("Target text not found");
  });

  await page.waitForFunction((rootId: string) => {
    const root = document.getElementById(rootId)?.shadowRoot;
    return Boolean(root?.querySelector(".selection-trigger")) && !root?.querySelector("textarea[data-field='draft']");
  }, {}, hostId);

  await page.evaluate((rootId: string) => {
    const root = document.getElementById(rootId)?.shadowRoot;
    const trigger = root?.querySelector(".selection-trigger") as HTMLButtonElement | null;
    if (!trigger) throw new Error("Selection trigger missing");
    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
  }, hostId);

  await page.waitForFunction((rootId: string) => {
    return Boolean(document.getElementById(rootId)?.shadowRoot?.querySelector("textarea[data-field='draft']"));
  }, {}, hostId);

  await page.evaluate((rootId: string) => {
    const root = document.getElementById(rootId)?.shadowRoot;
    if (!root) throw new Error("Shadow root missing");

    const draft = root.querySelector("textarea[data-field='draft']") as HTMLTextAreaElement | null;
    if (!draft) throw new Error("Draft input missing");

    draft.value = "Explain the exact latency thresholds and the throughput tradeoff.";
    draft.dispatchEvent(new Event("input", { bubbles: true }));
    draft.focus();
  }, hostId);

  await page.keyboard.press("Enter");

  await page.waitForFunction((rootId: string) => {
    const root = document.getElementById(rootId)?.shadowRoot;
    return Boolean(root?.querySelector(".notes-list-toggle")) &&
      !root?.querySelector(".note-marker") &&
      !root?.querySelector("textarea[data-field='draft']");
  }, {}, hostId);

  await page.evaluate(() => {
    const target = Array.from(document.querySelectorAll("[data-message-author-role='assistant']")).find((element) =>
      element.textContent?.includes("throughput and correctness"),
    );
    if (!target) throw new Error("Assistant message not found for draft stability test");

    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const content = node.textContent ?? "";
      const start = content.indexOf("throughput and correctness");
      if (start === -1) continue;

      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + "throughput and correctness".length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      return;
    }

    throw new Error("Target text not found for draft stability test");
  });

  await page.waitForFunction((rootId: string) => {
    const root = document.getElementById(rootId)?.shadowRoot;
    return Boolean(root?.querySelector(".selection-trigger")) &&
      !root?.querySelector("textarea[data-field='draft']");
  }, {}, hostId);

  const regressionPrefix = "Keep this draft";
  const regressionSuffix = " typing contiguously.";

  await page.evaluate((rootId: string, prefix: string) => {
    const root = document.getElementById(rootId)?.shadowRoot;
    const trigger = root?.querySelector(".selection-trigger") as HTMLButtonElement | null;
    if (!root || !trigger) {
      throw new Error("Selection trigger missing for draft stability test");
    }

    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));

    const draft = root.querySelector("textarea[data-field='draft']") as HTMLTextAreaElement | null;
    if (!draft) throw new Error("Draft input was not created synchronously");

    draft.value = prefix;
    draft.dispatchEvent(new Event("input", { bubbles: true }));

    const testWindow = window as typeof window & {
      __plannotatorDraftBeforeMutation?: HTMLTextAreaElement;
    };
    testWindow.__plannotatorDraftBeforeMutation = draft;

    const selection = window.getSelection();
    selection?.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
  }, hostId, regressionPrefix);

  await page.waitForFunction((rootId: string, prefixLength: number) => {
    const root = document.getElementById(rootId)?.shadowRoot;
    const draft = root?.querySelector("textarea[data-field='draft']") as HTMLTextAreaElement | null;
    return Boolean(
      draft &&
      root?.activeElement === draft &&
      draft.selectionStart === prefixLength &&
      draft.selectionEnd === prefixLength,
    );
  }, {}, hostId, regressionPrefix.length);

  await page.evaluate(async (rootId: string, prefix: string) => {
    const root = document.getElementById(rootId)?.shadowRoot;
    if (!root) throw new Error("Shadow root missing for draft stability test");

    const testWindow = window as typeof window & {
      __plannotatorDraftBeforeMutation?: HTMLTextAreaElement;
    };
    const draft = testWindow.__plannotatorDraftBeforeMutation;
    if (!draft) throw new Error("Draft identity missing for draft stability test");

    const unrelatedMutation = document.createElement("div");
    unrelatedMutation.hidden = true;
    unrelatedMutation.dataset.plannotatorUnrelatedMutation = "true";
    document.body.appendChild(unrelatedMutation);

    await new Promise<void>((resolvePromise) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolvePromise());
      });
    });

    const current = root.querySelector("textarea[data-field='draft']") as HTMLTextAreaElement | null;
    if (current !== draft) {
      throw new Error("Unrelated body mutation replaced the active draft textarea");
    }
    if (root.activeElement !== current) {
      throw new Error("Unrelated body mutation moved focus away from the active draft textarea");
    }
    if (current.value !== prefix) {
      throw new Error("Unrelated body mutation changed the active draft value");
    }
    if (current.selectionStart !== prefix.length || current.selectionEnd !== prefix.length) {
      throw new Error("Unrelated body mutation moved or selected the draft caret");
    }
  }, hostId, regressionPrefix);

  await page.keyboard.type(regressionSuffix);

  await page.evaluate((rootId: string, expectedValue: string) => {
    const root = document.getElementById(rootId)?.shadowRoot;
    const current = root?.querySelector("textarea[data-field='draft']") as HTMLTextAreaElement | null;
    const testWindow = window as typeof window & {
      __plannotatorDraftBeforeMutation?: HTMLTextAreaElement;
    };

    if (!current || current !== testWindow.__plannotatorDraftBeforeMutation) {
      throw new Error("Draft textarea identity changed during contiguous typing");
    }
    if (root?.activeElement !== current) {
      throw new Error("Draft textarea lost focus during contiguous typing");
    }
    if (current.value !== expectedValue) {
      throw new Error(`Draft typing was not contiguous: ${JSON.stringify(current.value)}`);
    }

    const composer = document.getElementById("prompt-textarea");
    if ((composer?.textContent ?? "") !== "") {
      throw new Error("Draft keystrokes leaked into the native composer");
    }
  }, hostId, `${regressionPrefix}${regressionSuffix}`);

  await page.keyboard.press("Escape");

  await page.waitForFunction((rootId: string) => {
    const root = document.getElementById(rootId)?.shadowRoot;
    return Boolean(root?.querySelector(".notes-list-toggle")) &&
      !root?.querySelector("textarea[data-field='draft']");
  }, {}, hostId);

  await page.evaluate((rootId: string) => {
    const root = document.getElementById(rootId)?.shadowRoot;
    const toggle = root?.querySelector(".notes-list-toggle") as HTMLButtonElement | null;
    if (!toggle) throw new Error("Notes list toggle missing");
    toggle.click();
  }, hostId);

  await page.waitForFunction((rootId: string) => {
    const root = document.getElementById(rootId)?.shadowRoot;
    return Boolean(root?.querySelector(".notes-menu-row")) &&
      !root?.querySelector("textarea[data-field='comment']");
  }, {}, hostId);

  await page.evaluate((rootId: string) => {
    const root = document.getElementById(rootId)?.shadowRoot;
    const row = root?.querySelector(".notes-menu-row") as HTMLButtonElement | null;
    if (!row) throw new Error("Notes menu row missing");
    row.click();
  }, hostId);

  await page.waitForFunction((rootId: string) => {
    const root = document.getElementById(rootId)?.shadowRoot;
    const activeHighlight = (CSS as unknown as {
      highlights?: Map<string, { size?: number; forEach?: (callback: () => void) => void }>;
    }).highlights?.get("plannotator-note-active");
    let highlightCount = activeHighlight?.size;
    if (highlightCount === undefined && activeHighlight?.forEach) {
      highlightCount = 0;
      activeHighlight.forEach(() => {
        highlightCount = (highlightCount ?? 0) + 1;
      });
    }
    return !root?.querySelector(".notes-menu") && highlightCount === 1;
  }, {}, hostId);

  await page.evaluate(() => {
    window.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
  });

  await page.waitForFunction(() => {
    const activeHighlight = (CSS as unknown as {
      highlights?: Map<string, { size?: number; forEach?: (callback: () => void) => void }>;
    }).highlights?.get("plannotator-note-active");
    let highlightCount = activeHighlight?.size;
    if (highlightCount === undefined && activeHighlight?.forEach) {
      highlightCount = 0;
      activeHighlight.forEach(() => {
        highlightCount = (highlightCount ?? 0) + 1;
      });
    }
    return !activeHighlight || highlightCount === 0;
  });

  await page.evaluate((rootId: string) => {
    const root = document.getElementById(rootId)?.shadowRoot;
    const action = root?.querySelector(".notes-action[data-state='idle']") as HTMLButtonElement | null;
    if (!action || action.disabled) throw new Error("Insert action missing");
    (window as typeof window & { __plannotatorActionClicks?: number }).__plannotatorActionClicks = 0;
    action.addEventListener("click", () => {
      (window as typeof window & { __plannotatorActionClicks?: number }).__plannotatorActionClicks =
        ((window as typeof window & { __plannotatorActionClicks?: number }).__plannotatorActionClicks ?? 0) + 1;
    }, { once: false });
    action.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    action.click();
  }, hostId);

  await page.waitForFunction(() => {
    return ((window as typeof window & { __plannotatorActionClicks?: number }).__plannotatorActionClicks ?? 0) > 0;
  });

  await page.waitForFunction((rootId: string) => {
    const root = document.getElementById(rootId)?.shadowRoot;
    const action = root?.querySelector(".notes-action[data-state='success']") as HTMLButtonElement | null;
    return Boolean(action && action.disabled) &&
      !root?.querySelector(".note-marker") &&
      !root?.querySelector(".notes-menu") &&
      !root?.querySelector("textarea[data-field='comment']") &&
      !root?.querySelector("textarea[data-field='draft']");
  }, {}, hostId);

  const [sentOutput, composerText, persistedNotes] = await Promise.all([
    page.$eval("#sent-output", (element: Element) => element.textContent ?? ""),
    page.$eval("#prompt-textarea", (element: Element) => element.textContent ?? ""),
    page.evaluate((key: string) => window.localStorage.getItem(key), storageKey),
  ]);

  if (sentOutput.trim() !== "Nothing sent yet.") {
    throw new Error("Prompt should be inserted without auto-sending");
  }
  if (!composerText.includes('responding to AI selected text: "latency budgets"')) {
    throw new Error("Composer did not receive the selected text");
  }
  if (!composerText.includes('user: "Explain the exact latency thresholds and the throughput tradeoff."')) {
    throw new Error("Composer did not receive the note");
  }
  if (persistedNotes !== null) {
    throw new Error("Inserted notes should be cleared from persisted conversation state");
  }

  console.log("Browser extension end-to-end flow passed.");
  console.log(`Harness URL: ${harnessUrl}`);
} finally {
  await browser?.close();
  await new Promise<void>((resolvePromise, rejectPromise) => server.close((error) => error ? rejectPromise(error) : resolvePromise()));
  rmSync(profileDir, { recursive: true, force: true });
}
