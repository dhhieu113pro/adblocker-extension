import { readFileSync, writeFileSync } from "node:fs";

const path = "tests/e2e/extension.spec.mjs";
let source = readFileSync(path, "utf8");

const helperAnchor = `async function openPopup() {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 390, height: 650 });
  await popup.goto(popupUrl());
  return popup;
}
`;

const helpers = `${helperAnchor}
const FULL_SITE_ORIGINS = ['http://*/*', 'https://*/*'];

async function grantFullSiteAccess(popup) {
  const granted = await popup.evaluate(async (origins) => chrome.permissions.request({ origins }), FULL_SITE_ORIGINS);
  expect(granted).toBe(true);
}

async function revokeFullSiteAccess(popup) {
  const removed = await popup.evaluate(async (origins) => chrome.permissions.remove({ origins }), FULL_SITE_ORIGINS);
  expect(removed).toBe(true);
}
`;

if (!source.includes(helperAnchor)) throw new Error("openPopup helper anchor not found");
if (!source.includes("const FULL_SITE_ORIGINS")) source = source.replace(helperAnchor, helpers);

const baselineAnchor = `test('baseline mode leaves page DOM untouched before full site access is granted', async () => {
  const page = await context.newPage();
  await page.goto(baseUrl);

  await expect(page.locator('#normal-content')).toBeVisible();
  await expect.poll(async () => page.locator('#adbro').evaluate((el) => ({
    hidden: el.dataset.webllmAdHidden,
    display: getComputedStyle(el).display,
  }))).toEqual({ hidden: undefined, display: 'block' });
});
`;

const lifecycleTest = `${baselineAnchor}
test('granting full site access enables DOM protection and revocation returns to baseline', async () => {
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
  await baselinePage.goto(\`\${baseUrl}/after-revoke\`);
  await expect(baselinePage.locator('#normal-content')).toBeVisible();
  await expect.poll(async () => baselinePage.locator('#adbro').evaluate((el) => ({
    hidden: el.dataset.webllmAdHidden,
    display: getComputedStyle(el).display,
  }))).toEqual({ hidden: undefined, display: 'block' });

  await protectedPage.close();
  await baselinePage.close();
  await popup.close();
});
`;

if (!source.includes(baselineAnchor)) throw new Error("baseline lifecycle anchor not found");
if (!source.includes("granting full site access enables DOM protection")) source = source.replace(baselineAnchor, lifecycleTest);

writeFileSync(path, source);
console.log("Added Task 5 grant/revoke lifecycle E2E coverage");
