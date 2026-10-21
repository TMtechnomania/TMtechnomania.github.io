import { test, expect, chromium } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const extensionRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

test("new tab boots with core action-bar controls", async () => {
	const userDataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "themesplus-smoke-"),
	);
	const context = await chromium.launchPersistentContext(userDataDir, {
		headless: false,
		args: [
			`--disable-extensions-except=${extensionRoot}`,
			`--load-extension=${extensionRoot}`,
		],
	});

	try {
		let [serviceWorker] = context.serviceWorkers();
		if (!serviceWorker) {
			serviceWorker = await context.waitForEvent("serviceworker");
		}
		const extensionId = new URL(serviceWorker.url()).host;

		const page = await context.newPage();
		await page.goto(`chrome-extension://${extensionId}/newtab.html`);

		await expect(page.locator("#action-bar")).toBeVisible();
		await expect(page.locator("#action-tools")).toBeVisible();
		await expect(page.locator("#action-notes")).toBeVisible();

		// The unified content script must be the only one declared.
		const manifest = await serviceWorker.evaluate(() =>
			chrome.runtime.getManifest(),
		);
		expect(manifest.content_scripts).toHaveLength(1);
		expect(manifest.content_scripts[0].js).toEqual([
			"js/content/mediaContent.js",
		]);
	} finally {
		await context.close();
		await fs.rm(userDataDir, { recursive: true, force: true });
	}
});
