import test from "node:test";
import assert from "node:assert/strict";

function createChromeFake({ granted = false, requestResult = granted, initialRegistrations = [] } = {}) {
  const registrations = new Map(initialRegistrations.map((item) => [item.id, item]));
  let permissionGranted = granted;

  return {
    permissions: {
      contains: async ({ origins }) => permissionGranted
        && origins.length === 2
        && origins.includes("http://*/*")
        && origins.includes("https://*/*"),
      request: async ({ origins }) => {
        assert.deepEqual(origins, ["http://*/*", "https://*/*"]);
        permissionGranted = requestResult;
        return requestResult;
      },
    },
    scripting: {
      getRegisteredContentScripts: async () => Array.from(registrations.values()),
      unregisterContentScripts: async ({ ids }) => {
        ids.forEach((id) => registrations.delete(id));
      },
      registerContentScripts: async (items) => {
        items.forEach((item) => {
          if (registrations.has(item.id)) throw new Error(`duplicate registration: ${item.id}`);
          registrations.set(item.id, item);
        });
      },
    },
    _registrations: registrations,
  };
}

async function loadSiteAccess(fake) {
  globalThis.chrome = fake;
  return import(`../src/site-access.ts?test=${Date.now()}-${Math.random()}`);
}

test("denied full-site access stays in baseline mode", async () => {
  const fake = createChromeFake({ granted: false, requestResult: false });
  const siteAccess = await loadSiteAccess(fake);

  assert.equal(await siteAccess.hasFullSiteAccess(), false);
  assert.equal(await siteAccess.requestFullSiteAccess(), false);
  assert.equal(await siteAccess.syncFullProtectionRegistration(), false);
  assert.equal(fake._registrations.size, 0);
});

test("granted full-site access registers MAIN and ISOLATED protection scripts", async () => {
  const fake = createChromeFake({ granted: true });
  const siteAccess = await loadSiteAccess(fake);

  assert.deepEqual(siteAccess.FULL_SITE_ORIGINS, ["http://*/*", "https://*/*"]);
  assert.equal(await siteAccess.syncFullProtectionRegistration(), true);
  assert.deepEqual(
    Array.from(fake._registrations.keys()).sort(),
    ["ai-vision-content", "ai-vision-main"],
  );

  const main = fake._registrations.get("ai-vision-main");
  assert.deepEqual(main.js, ["runtime/inject.js"]);
  assert.deepEqual(main.matches, ["http://*/*", "https://*/*"]);
  assert.equal(main.runAt, "document_start");
  assert.equal(main.allFrames, true);
  assert.equal(main.world, "MAIN");
  assert.equal(main.persistAcrossSessions, true);

  const content = fake._registrations.get("ai-vision-content");
  assert.deepEqual(content.js, ["runtime/content.js"]);
  assert.deepEqual(content.matches, ["http://*/*", "https://*/*"]);
  assert.equal(content.runAt, "document_idle");
  assert.equal(content.allFrames, true);
  assert.equal(content.world, "ISOLATED");
  assert.equal(content.persistAcrossSessions, true);
});

test("registration synchronization is idempotent", async () => {
  const fake = createChromeFake({ granted: true });
  const siteAccess = await loadSiteAccess(fake);

  assert.equal(await siteAccess.syncFullProtectionRegistration(), true);
  assert.equal(await siteAccess.syncFullProtectionRegistration(), true);
  assert.equal(fake._registrations.size, 2);
});

test("revoked permission unregisters stale protection scripts", async () => {
  const stale = [
    { id: "ai-vision-main", js: ["old-main.js"] },
    { id: "ai-vision-content", js: ["old-content.js"] },
  ];
  const fake = createChromeFake({ granted: false, initialRegistrations: stale });
  const siteAccess = await loadSiteAccess(fake);

  assert.equal(await siteAccess.syncFullProtectionRegistration(), false);
  assert.equal(fake._registrations.size, 0);
});
