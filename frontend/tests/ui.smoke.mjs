import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const screenshotDir = path.join(root, ".tools/screenshots");
await mkdir(screenshotDir, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
page.on("pageerror", (error) => errors.push(error.message));
const screenshot = (name) =>
  page.screenshot({
    path: path.join(screenshotDir, name + ".png"),
    fullPage: false,
  });
const assertNoOverflow = async () =>
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Page should not overflow horizontally",
  );

try {
  await page.goto("http://127.0.0.1:5173");
  await page.getByRole("heading", { name: "For you." }).waitFor();
  await page
    .locator(".reel-media img")
    .first()
    .evaluate((img) => img.decode());
  await assertNoOverflow();
  await screenshot("desktop-feed");
  await page.getByRole("button", { name: "Music", exact: true }).click();
  assert.equal(await page.locator(".reel").count(), 1);
  await page
    .getByRole("button", { name: "All interests", exact: true })
    .click();
  await page.getByRole("button", { name: "Highlights", exact: true }).click();
  assert.equal(await page.locator(".reel").count(), 1);
  await page
    .getByRole("button", { name: "Open the album", exact: true })
    .click();
  await page.locator(".photo-card").first().waitFor();
  const photoCount = await page.locator(".photo-card").count();
  assert.ok(photoCount >= 3);
  await screenshot("desktop-album");
  await page.getByRole("button", { name: "Add photos", exact: true }).click();
  await page.getByLabel("Your name", { exact: true }).fill("QA Student");
  const email = `qa-${Date.now()}@example.com`;
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page
    .getByLabel("Upload event photos", { exact: true })
    .setInputFiles(path.join(root, "backend/public/media/arts.jpg"));
  await page.getByText(`${photoCount + 1} photos`, { exact: true }).waitFor();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Download arts.jpg", exact: true })
    .first()
    .click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "arts.jpg");

  await page.getByRole("button", { name: "Discover", exact: true }).click();
  await page.getByRole("button", { name: "All vibes", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Save After Hours: Live on campus",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "Unsave After Hours: Live on campus",
      exact: true,
    })
    .waitFor();
  await page.getByRole("button", { name: /Saved events/ }).click();
  assert.equal(await page.locator(".reel").count(), 1);
  await page
    .getByRole("button", { name: "Get the details", exact: true })
    .click();
  await page.getByRole("button", { name: "I'm going", exact: true }).click();
  await page
    .getByRole("button", { name: "You're going", exact: true })
    .waitFor();
  await screenshot("desktop-event");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  execFileSync(
    process.execPath,
    ["--import", "tsx", "src/coordinator.ts", email, "music"],
    {
      cwd: path.join(root, "backend"),
      env: {
        ...process.env,
        APP_DATA_DIR:
          process.env.APP_DATA_DIR || path.join(root, ".tools/qa-data"),
      },
    },
  );
  await page.reload();
  await page.getByRole("heading", { name: "For you." }).waitFor();
  await page
    .getByRole("button", { name: "Get the details", exact: true })
    .first()
    .click();
  const featureSwitch = page.getByRole("switch", { name: "Coordinator pick" });
  const previousFeature = await featureSwitch.isChecked();
  await featureSwitch.setChecked(!previousFeature);
  await page
    .getByText(
      previousFeature
        ? "Removed from coordinator picks."
        : "Added to coordinator picks.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await page.getByRole("switch", { name: "Coordinator pick" }).isChecked(),
    !previousFeature,
  );
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();

  await page.getByRole("button", { name: "Societies", exact: true }).click();
  assert.equal(await page.locator(".society-card").count(), 6);
  await page
    .locator(".society-card")
    .first()
    .getByRole("button", { name: "Follow", exact: true })
    .click();
  await page
    .locator(".society-card")
    .first()
    .getByRole("button", { name: "Following", exact: true })
    .waitFor();
  await screenshot("desktop-societies");
  await page.getByRole("button", { name: "Event map", exact: true }).click();
  await page.locator(".leaflet-container").waitFor();
  await page
    .locator(".leaflet-tile-loaded")
    .first()
    .waitFor({ timeout: 25000 });
  assert.equal(await page.locator(".map-marker").count(), 4);
  await page.locator(".map-event").first().click();
  await page
    .getByRole("button", { name: "View selected event", exact: true })
    .waitFor();
  await screenshot("desktop-map");

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [nav, title, shot] of [
      ["Discover", "For you.", "feed"],
      ["Event map", "Explore the map.", "map"],
      ["Societies", "Find your community.", "societies"],
      ["Photo albums", "The moments after.", "albums"],
    ]) {
      await page.getByRole("button", { name: nav, exact: true }).click();
      await page.getByRole("heading", { name: title }).waitFor();
      await assertNoOverflow();
      if (width === 390) await screenshot("mobile-" + shot);
    }
  }
  assert.deepEqual(errors, [], "No frontend runtime errors");
  console.log(
    "UI checks passed: feed filters, accounts, shared uploads/downloads, saves, RSVPs, follows, map tiles, and mobile layouts.",
  );
  console.log(`Screenshots: ${screenshotDir}`);
} finally {
  await browser.close();
}
