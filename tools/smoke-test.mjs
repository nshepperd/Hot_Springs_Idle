// Smoke test: every script parses, and the game boots from a fresh save in headless Chrome and runs ten game-minutes
// without page errors or failed requests. Exits non-zero on failure.
//
//   npm install --no-save playwright-core && node tools/smoke-test.mjs
//
// Uses the system Chrome; set CHROME_PATH to use a different browser binary.
import { execFileSync } from "node:child_process";
import { createReadStream, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "..");
const failures = [];

for (const f of readdirSync(root).filter((f) => f.endsWith(".js"))) {
    try {
        execFileSync(process.execPath, ["--check", join(root, f)], { stdio: "pipe" });
    } catch (e) {
        failures.push(`syntax: ${f}: ${String(e.stderr).trim()}`);
    }
}

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".json": "application/json", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav" };
const server = createServer((req, res) => {
    const path = normalize(join(root, decodeURIComponent(new URL(req.url, "http://x").pathname)));
    let file = path.startsWith(root) ? path : null;
    if (file && statSync(file, { throwIfNoEntry: false })?.isDirectory()) {
        file = join(file, "index.html");
    }
    if (!file || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
        res.writeHead(404).end();
        return;
    }
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
    createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" });
try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on("pageerror", (e) => failures.push(`page error: ${e.stack || e}`));
    // Failed loads also log a console error; the response handler reports those with their URL.
    page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && failures.push(`console error: ${m.text()}`));
    page.on("response", (r) => r.status() >= 400 && r.url().startsWith(base) && !r.url().endsWith("favicon.ico") && failures.push(`HTTP ${r.status()}: ${r.url()}`));
    page.on("requestfailed", (r) => r.url().startsWith(base) && failures.push(`request failed: ${r.url()} ${r.failure()?.errorText}`));
    await page.goto(base + "index.html");
    await page.waitForFunction(() => typeof engine !== "undefined" && typeof offline !== "undefined" && typeof view !== "undefined", null, { timeout: 20000 });
    await page.waitForTimeout(3000);
    const result = await page.evaluate(() => {
        for (let i = 0; i < 600; i++) {
            offline.runOneGameSecond({ nonCombatOnly: false });
        }
        saving.save();
        for (const tab of events.mainMenuTabOrder()) {
            events.switchTab(tab);
        }
        events.switchTab("base");
        return { saved: !!localStorage[saveName] };
    });
    await page.waitForTimeout(2000);
    if (!result.saved) {
        failures.push("game did not write a save");
    }
} catch (e) {
    failures.push(`harness: ${e.stack || e}`);
} finally {
    await browser.close();
    server.close();
}

if (failures.length) {
    console.error(`SMOKE TEST FAILED (${failures.length}):\n` + failures.join("\n"));
    process.exit(1);
}
console.log("Smoke test passed: scripts parse, game boots, ran 600 game-seconds, saved.");
