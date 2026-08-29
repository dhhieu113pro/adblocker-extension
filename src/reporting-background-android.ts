const chromeApi = globalThis.chrome as typeof chrome & { contextMenus?: typeof chrome.contextMenus };

if (!chromeApi.contextMenus) {
  const noOpEvent = { addListener: () => undefined } as unknown as typeof chrome.contextMenus.onClicked;
  chromeApi.contextMenus = {
    ACTION_MENU_TOP_LEVEL_LIMIT: 0,
    create: () => undefined,
    remove: async () => undefined,
    removeAll: async () => undefined,
    update: async () => undefined,
    onClicked: noOpEvent,
  } as unknown as typeof chrome.contextMenus;
}

await import('./reporting-background');
