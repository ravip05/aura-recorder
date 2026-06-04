// ============================================================
// background.ts — Extension Service Worker (Message Broker)
// Routes messages between popup, content scripts, and the
// offscreen recording document.
// ============================================================



// ---- Offscreen Document Management ----

const OFFSCREEN_URL = 'offscreen/offscreen.html';

async function ensureOffscreenDocument(): Promise<void> {
  const existing = await chrome.offscreen.hasDocument();
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [
        chrome.offscreen.Reason.DISPLAY_MEDIA,
        chrome.offscreen.Reason.USER_MEDIA,
      ],
      justification: 'Recording screen, webcam, and audio for Aura Recorder',
    });
  }
}

async function closeOffscreenDocument(): Promise<void> {
  const existing = await chrome.offscreen.hasDocument();
  if (existing) {
    await chrome.offscreen.closeDocument();
  }
}

// ---- Content Script Injection ----

async function injectContentScript(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content.js'],
    });
  } catch (err) {
    console.warn('[Aura] Could not inject content script:', err);
  }
}

// ---- Message Routing ----

chrome.runtime.onMessage.addListener(
  (message: PopupMessage | OffscreenMessage | ControlMessage, _sender, sendResponse) => {
    (async () => {
      try {
        if (message.action === 'START_RECORDING') {
          const startMsg = message as Extract<PopupMessage, { action: 'START_RECORDING' }>;
          await handleStartRecording(startMsg.settings);
          sendResponse({ ok: true });
        } else if (message.action === 'STOP_RECORDING') {
          await handleStopRecording();
          sendResponse({ ok: true });
        } else if (message.action === 'RECORDING_COMPLETE') {
          const msg = message as Extract<OffscreenMessage, { action: 'RECORDING_COMPLETE' }>;
          await handleRecordingComplete(msg.blobId, msg.duration);
          sendResponse({ ok: true });
        } else if (message.action === 'OPEN_PLAYER') {
          chrome.tabs.create({ url: chrome.runtime.getURL('player/player.html') });
          sendResponse({ ok: true });
        } else if (message.action === 'TOGGLE_CAMERA_PREVIEW') {
          const msg = message as Extract<PopupMessage, { action: 'TOGGLE_CAMERA_PREVIEW' }>;
          await handleToggleCameraPreview(msg.show, msg.settings);
          sendResponse({ ok: true });
        } else if (
          message.action === 'PAUSE_RECORDING' ||
          message.action === 'RESUME_RECORDING' ||
          message.action === 'SET_MIC_MUTED'
        ) {
          // Forward control signals to the offscreen document
          chrome.runtime.sendMessage(message).catch(() => {});
          sendResponse({ ok: true });
        }
      } catch (err) {
        console.error('[Aura] Message handler error:', err);
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }
);

// ---- Handlers ----

async function handleStartRecording(recSettings: RecorderSettings): Promise<void> {
  await chrome.storage.local.set({ isRecording: true, recordingSettings: recSettings });

  // Show camera bubble (or controls pill) on the active tab
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id) {
    await injectContentScript(activeTab.id);
    chrome.tabs.sendMessage(activeTab.id, {
      action: 'SHOW_CAMERA_BUBBLE',
      settings: recSettings,
    }).catch(() => {});
  }
  // Broadcast to extension pages (like canvas.html)
  chrome.runtime.sendMessage({
    action: 'SHOW_CAMERA_BUBBLE',
    settings: recSettings,
  }).catch(() => {});

  // For camera-only mode, skip the offscreen display capture
  // For screen modes, the offscreen doc will call getDisplayMedia
  await ensureOffscreenDocument();

  const offscreenMsg: OffscreenMessage = {
    action: 'INIT_RECORDING',
    settings: recSettings,
  };
  chrome.runtime.sendMessage(offscreenMsg).catch((err: Error) => {
    console.warn('[Aura] Offscreen message failed:', err.message);
  });
}

async function handleStopRecording(): Promise<void> {
  await chrome.storage.local.set({ isRecording: false });

  chrome.runtime.sendMessage({ action: 'STOP_RECORDING' }).catch((err: Error) => {
    console.warn('[Aura] Stop recording message failed:', err.message);
  });

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id) {
    chrome.tabs.sendMessage(activeTab.id, { action: 'HIDE_CAMERA_BUBBLE' }).catch(() => {});
  }
  chrome.runtime.sendMessage({ action: 'HIDE_CAMERA_BUBBLE' }).catch(() => {});
}

async function handleRecordingComplete(blobId: string, duration: number): Promise<void> {
  await chrome.storage.local.set({ isRecording: false });
  await closeOffscreenDocument();
  await chrome.tabs.create({
    url: `${chrome.runtime.getURL('player/player.html')}?id=${blobId}&duration=${duration}`,
  });
}

async function handleToggleCameraPreview(show: boolean, recSettings: RecorderSettings): Promise<void> {
  const { isRecording } = await chrome.storage.local.get('isRecording');
  if (isRecording) return; // Do not toggle preview if a recording is already active

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id) {
    if (show) {
      await injectContentScript(activeTab.id);
      
      // Prevent showing bubble if popup was closed during injection
      if (!isPreviewActive) return;

      chrome.tabs.sendMessage(activeTab.id, {
        action: 'SHOW_CAMERA_BUBBLE',
        settings: recSettings,
      }).catch(() => {});
      chrome.runtime.sendMessage({
        action: 'SHOW_CAMERA_BUBBLE',
        settings: recSettings,
      }).catch(() => {});
    } else {
      chrome.tabs.sendMessage(activeTab.id, {
        action: 'HIDE_CAMERA_BUBBLE',
      }).catch(() => {});
      chrome.runtime.sendMessage({
        action: 'HIDE_CAMERA_BUBBLE',
      }).catch(() => {});
    }
  }
}

// ---- Popup Connection Resilience ----
// Handles cases where the user clicks away from the popup, abruptly killing it.

let isPreviewActive = false;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup-preview') {
    isPreviewActive = true;
    port.onDisconnect.addListener(async () => {
      isPreviewActive = false;
      const { isRecording } = await chrome.storage.local.get('isRecording');
      if (!isRecording) {
        // Broadcast HIDE to all tabs to guarantee cleanup
        const tabs = await chrome.tabs.query({});
        for (const t of tabs) {
          if (t.id) {
            chrome.tabs.sendMessage(t.id, { action: 'HIDE_CAMERA_BUBBLE' }).catch(() => {});
          }
        }
        chrome.runtime.sendMessage({ action: 'HIDE_CAMERA_BUBBLE' }).catch(() => {});
      }
    });
  }
});

// ---- Dynamic Popup / Canvas Routing ----
// On regular http(s) pages: show the popup dropdown.
// On chrome:// pages (new tab, settings, etc.): disable popup so onClicked fires -> open canvas.

function updatePopupForTab(tab: chrome.tabs.Tab): void {
  if (!tab.id) return;
  const isChromePage = !tab.url || !tab.url.startsWith('http');
  chrome.action.setPopup({
    tabId: tab.id,
    popup: isChromePage ? '' : 'popup/popup.html',
  });
}

chrome.action.onClicked.addListener(async () => {
  // This only fires when popup is empty (i.e. on chrome:// pages)
  const canvasUrl = chrome.runtime.getURL('canvas/canvas.html?reason=unsupported');
  const queryUrl = chrome.runtime.getURL('canvas/canvas.html*');
  const existing = await chrome.tabs.query({ url: queryUrl });
  if (existing.length > 0 && existing[0].id) {
    chrome.tabs.update(existing[0].id, { active: true });
    chrome.windows.update(existing[0].windowId, { focused: true });
  } else {
    chrome.tabs.create({ url: canvasUrl });
  }
});

// ---- Tab Navigation Resilience ----
// The content script self-restores from chrome.storage on load,
// so we only need to ensure it gets injected on navigation.
// No sendMessage needed — eliminates the race condition entirely.

async function ensureContentScriptOnTab(tabId: number): Promise<void> {
  const { isRecording } = await chrome.storage.local.get('isRecording');
  if (!isRecording) return;
  await injectContentScript(tabId);
  // Content script will auto-detect isRecording from storage and show the bubble.
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Inject content script early so it self-restores the overlay
  if (changeInfo.status === 'loading' && tab.url?.startsWith('http')) {
    void ensureContentScriptOnTab(tabId);
  }
  // Update popup routing when page finishes loading
  if (changeInfo.status === 'complete') {
    updatePopupForTab(tab);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    updatePopupForTab(tab);
    if (tab.url?.startsWith('http')) {
      void ensureContentScriptOnTab(tabId);
    }
  });
});

console.log('[Aura] Background service worker loaded.');

