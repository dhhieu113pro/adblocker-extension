import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = path.resolve('src/protection-state.mjs');

async function loadProtectionState() {
  assert.equal(
    existsSync(modulePath),
    true,
    'src/protection-state.mjs must define the shared automatic-protection contract',
  );
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}-${Math.random()}`);
}

test('global protection off bypasses automatic protection for every site', async () => {
  const { isAutomaticProtectionEnabled } = await loadProtectionState();

  assert.equal(
    isAutomaticProtectionEnabled(
      { autoHideAds: false, disabledSites: [] },
      'https://news.example/article',
    ),
    false,
  );
  assert.equal(
    isAutomaticProtectionEnabled(
      { autoHideAds: false, disabledSites: ['allowed.example'] },
      'https://other.example/watch',
    ),
    false,
  );
});

test('per-site bypass disables only the matching site', async () => {
  const { isAutomaticProtectionEnabled } = await loadProtectionState();
  const settings = { autoHideAds: true, disabledSites: ['allowed.example'] };

  assert.equal(isAutomaticProtectionEnabled(settings, 'https://allowed.example/watch'), false);
  assert.equal(isAutomaticProtectionEnabled(settings, 'https://cdn.allowed.example/asset'), true);
  assert.equal(isAutomaticProtectionEnabled(settings, 'https://protected.example/watch'), true);
});

test('DNR policy disables all network rules globally and excludes disabled initiator sites otherwise', async () => {
  const { getDnrProtectionPolicy } = await loadProtectionState();

  assert.deepEqual(
    getDnrProtectionPolicy({ autoHideAds: false, disabledSites: ['allowed.example'] }),
    { enabled: false, excludedInitiatorDomains: [] },
  );
  assert.deepEqual(
    getDnrProtectionPolicy({ autoHideAds: true, disabledSites: ['Allowed.Example', 'allowed.example', ''] }),
    { enabled: true, excludedInitiatorDomains: ['allowed.example'] },
  );
});
