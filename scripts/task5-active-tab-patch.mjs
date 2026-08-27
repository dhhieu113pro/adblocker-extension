import { readFileSync, writeFileSync } from "node:fs";

const path = "tests/e2e/extension.spec.mjs";
let source = readFileSync(path, "utf8");

const before = `  await popup.reload();
  await expect(popup.getByRole('button', { name: 'Enable full protection' })).toBeHidden();
  await expect(popup.locator('#status-label')).toHaveText('Protection is on');

  const protectedPage = await context.newPage();
  await protectedPage.goto(baseUrl);
  await expect(protectedPage.locator('#normal-content')).toBeVisible();
  await expect.poll(async () => protectedPage.locator('#adbro').evaluate((el) => ({
    hidden: el.dataset.webllmAdHidden,
    display: getComputedStyle(el).display,
  }))).toEqual({ hidden: 'true', display: 'none' });`;

const after = `  const protectedPage = await context.newPage();
  await protectedPage.goto(baseUrl);
  await expect(protectedPage.locator('#normal-content')).toBeVisible();
  await expect.poll(async () => protectedPage.locator('#adbro').evaluate((el) => ({
    hidden: el.dataset.webllmAdHidden,
    display: getComputedStyle(el).display,
  }))).toEqual({ hidden: 'true', display: 'none' });

  await protectedPage.bringToFront();
  await popup.reload();
  await expect(popup.getByRole('button', { name: 'Enable full protection' })).toBeHidden();
  await expect(popup.locator('#status-label')).toHaveText('Protection is on');`;

if (!source.includes(before)) throw new Error("Task 5 active-tab sequence not found");
source = source.replace(before, after);
writeFileSync(path, source);
console.log("Updated Task 5 lifecycle test to assert full state with an active HTTP tab");
