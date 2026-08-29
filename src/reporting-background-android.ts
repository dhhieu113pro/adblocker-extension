const chromeApi = chrome as any;

if (!chromeApi.contextMenus) {
  chromeApi.contextMenus = {
    create: () => undefined,
    remove: async () => undefined,
    removeAll: async () => undefined,
    update: async () => undefined,
    onClicked: { addListener: () => undefined },
  };
}

await import('./reporting-background');
