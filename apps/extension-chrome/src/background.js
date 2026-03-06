const DAEMON_BASE = 'http://127.0.0.1:4317';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['immersionEnabled'], (result) => {
    if (typeof result.immersionEnabled !== 'boolean') {
      chrome.storage.local.set({ immersionEnabled: true });
    }
  });

  chrome.contextMenus.create({
    id: 'save-korean-vocab',
    title: 'Save to Korean Vocabulary',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== 'save-korean-vocab' || !info.selectionText) {
    return;
  }

  const text = info.selectionText.trim();
  if (!text) {
    return;
  }

  try {
    await fetch(`${DAEMON_BASE}/v1/vocab/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        meaning: 'Captured from context menu',
        source: 'extension_context_menu'
      })
    });
  } catch {
    // Ignore silent errors from unavailable daemon.
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'SET_IMMERSION') {
    chrome.storage.local.set({ immersionEnabled: Boolean(message.enabled) }, () => {
      if (sender.tab?.id) {
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'IMMERSION_TOGGLE',
          enabled: Boolean(message.enabled)
        });
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});
