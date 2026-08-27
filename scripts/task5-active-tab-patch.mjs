import { readFileSync, writeFileSync } from "node:fs";

const path = "tests/e2e/extension.spec.mjs";
let source = readFileSync(path, "utf8");

const before = `test('granting full site access enables DOM protection and revocation returns to baseline', async () => {
  const popup = await openPopup();
  await grantFullSiteAccess(popup);

  await popup.reload();
  await expect(popup.getByRole('button', { name: 'Enable full protection' })).toBeHidden();
  await expect(popup.locator('#status-label')).toHaveText('Protection is on');

  const protectedPage = await context.newPage();
  await protectedPage.goto(baseUrl);
  await expect(protectedPage.locator('#normal-content')).toBeVisible();
  await expect.poll(async () => protectedPage.locator('#adbro').evaluate((el) => ({
    hidden: el.dataset.webllmAdHidden,
    display: getComputedStyle(el).display,
  }))).toEqual({ hidden: 'true', display: 'none' });

  await revokeFullSiteAccess(popup);
  await expect(popup.locator('#status-label')).toHaveText('Basic protection is on');
  await expect(popup.getByRole('button', { name: 'Enable full protection' })).toBeVisible();

  const baselinePage = await context.newPage();
  await baselinePage.goto(\`${baseUrl}/after-revoke\`);
  await expect(baselinePage.locator('#normal-content')).toBeVisible();
  await expect.poll(async () => baselinePage.locator('#adbro').evaluate((el) => ({
    hidden: el.dataset.webllmAdHidden,
    display: getComputedStyle(el).display,
  }))).toEqual({ hidden: undefined, display: 'block' });

  await protectedPage.close();
  await baselinePage.close();
  await popup.close();
});`;

const after = `test('granting full site access enables DOM protection and revocation returns to baseline', async () => {
  const popup = await openPopup();
  await grantFullSiteAccess(popup);

  const protectedPage = await context.newPage();
  await protectedPage.goto(baseUrl);
  await expect(protectedPage.locator('#normal-content')).toBeVisible();
  await expect.poll(async () => protectedPage.locator('#adbro').evaluate((el) => ({
    hidden: el.dataset.webllmAdHidden,
    display: getComputedStyle(el).display,
  }))).toEqual({ hidden: 'true', display: 'none' });

  await protectedPage.bringToFront();
  await popup.reload();
  await expect(popup.getByRole('button', { name: 'Enable full protection' })).toBeHidden();
  await expect(popup.locator('#status-label')).toHaveText('Protection is on');

  await revokeFullSiteAccess(popup);
  await expect(popup.locator('#status-label')).toHaveText('Basic protection is on');
  await expect(popup.getByRole('button', { name: 'Enable full protection' })).toBeVisible();

  const baselinePage = await context.newPage();
  await baselinePage.goto(\`${baseUrl}/after-revoke\`);
  await expect(baselinePage.locator('#normal-content')).toBeVisible();
  await expect.poll(async () => baselinePage.locator('#adbro').evaluate((el) => ({
    hidden: el.dataset.webllmAdHidden,
    display: getComputedStyle(el).display,
  }))).toEqual({ hidden: undefined, display: 'block' });

  await protectedPage.close();
  await baselinePage.close();
  await popup.close();
});`;

if (!source.includes(before)) throw new Error("Task 5 lifecycle block not found");
source = source.replace(before, after);
writeFileSync(path, source);
console.log("Updated Task 5 lifecycle test to assert full state with an active HTTP tab");
