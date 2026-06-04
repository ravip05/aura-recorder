// ============================================================
// popup.ts — Extension Popup Controller
// Handles hardware enumeration, settings, and recording init.
// ============================================================
const DEFAULT_SETTINGS = {
    captureMode: 'screen-camera',
    cameraEnabled: true,
    micEnabled: true,
    audioEnabled: true,
    cameraDeviceId: '',
    micDeviceId: '',
    quality: 1080,
};
if (window.self !== window.top) {
    document.body.classList.add('embedded');
}
const $ = (sel) => document.querySelector(sel);
const modeBtns = document.querySelectorAll('.mode-btn');
const cameraToggle = $('#camera-toggle');
const micToggle = $('#mic-toggle');
const cameraSelect = $('#camera-select');
const micSelect = $('#mic-select');
const cameraRow = $('#camera-row');
const micRow = $('#mic-row');
const startBtn = $('#start-record-btn');
const galleryBtn = $('#btn-gallery');
let settings = { ...DEFAULT_SETTINGS };
let isStartingRecording = false;
let previewPort = null;
// ---- Initialization ----
async function init() {
    await loadSettings();
    applySettingsToUI();
    // Prompt for permissions immediately to get real device names
    const hasPerms = await checkPermissions();
    if (!hasPerms) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            stream.getTracks().forEach(t => t.stop());
        }
        catch (err) {
            console.warn('[Aura] Permissions denied or ignored.', err);
        }
    }
    await refreshDevices();
    updatePreview();
    // Create a long-lived connection so background script knows when popup is closed
    previewPort = chrome.runtime.connect({ name: 'popup-preview' });
    window.addEventListener('pagehide', () => {
        if (!isStartingRecording) {
            chrome.runtime.sendMessage({ action: 'TOGGLE_CAMERA_PREVIEW', show: false, settings }).catch(() => { });
        }
    });
}
function updatePreview() {
    chrome.runtime.sendMessage({ action: 'TOGGLE_CAMERA_PREVIEW', show: true, settings }).catch(() => { });
}
async function loadSettings() {
    const result = await chrome.storage.local.get('recorderSettings');
    if (result['recorderSettings']) {
        settings = { ...DEFAULT_SETTINGS, ...result['recorderSettings'] };
    }
}
function saveSettings() {
    chrome.storage.local.set({ recorderSettings: settings });
}
// ---- Permissions & Devices ----
async function checkPermissions() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.some(d => d.label !== '');
    }
    catch {
        return false;
    }
}
async function refreshDevices() {
    const all = await navigator.mediaDevices.enumerateDevices();
    const cams = all.filter(d => d.kind === 'videoinput');
    const mics = all.filter(d => d.kind === 'audioinput');
    populateSelect(cameraSelect, cams, settings.cameraDeviceId, 'Camera');
    populateSelect(micSelect, mics, settings.micDeviceId, 'Microphone');
    if (!settings.cameraDeviceId && cams.length > 0)
        settings.cameraDeviceId = cams[0].deviceId;
    if (!settings.micDeviceId && mics.length > 0)
        settings.micDeviceId = mics[0].deviceId;
    saveSettings();
}
function populateSelect(sel, devices, savedId, fallbackName) {
    sel.innerHTML = '';
    if (devices.length === 0) {
        sel.add(new Option(`No ${fallbackName} found`, ''));
        sel.disabled = true;
        return;
    }
    sel.disabled = false;
    devices.forEach((d, i) => {
        const opt = new Option(d.label || `${fallbackName} ${i + 1}`, d.deviceId);
        if (d.deviceId === savedId)
            opt.selected = true;
        sel.add(opt);
    });
}
// ---- UI Sync ----
function applySettingsToUI() {
    modeBtns.forEach(b => b.classList.toggle('active', b.dataset['mode'] === settings.captureMode));
    cameraToggle.checked = settings.cameraEnabled;
    micToggle.checked = settings.micEnabled;
    cameraRow.classList.toggle('disabled', !settings.cameraEnabled);
    micRow.classList.toggle('disabled', !settings.micEnabled);
}
// ---- Event Listeners ----
modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        settings.captureMode = btn.dataset['mode'];
        if (settings.captureMode === 'screen-camera' || settings.captureMode === 'camera-only') {
            settings.cameraEnabled = true;
        }
        else {
            settings.cameraEnabled = false;
        }
        applySettingsToUI();
        saveSettings();
        updatePreview();
    });
});
cameraToggle.addEventListener('change', () => {
    settings.cameraEnabled = cameraToggle.checked;
    applySettingsToUI();
    saveSettings();
    updatePreview();
});
micToggle.addEventListener('change', () => {
    settings.micEnabled = micToggle.checked;
    applySettingsToUI();
    saveSettings();
});
cameraSelect.addEventListener('change', () => {
    settings.cameraDeviceId = cameraSelect.value;
    saveSettings();
    updatePreview();
});
micSelect.addEventListener('change', () => {
    settings.micDeviceId = micSelect.value;
    saveSettings();
});
startBtn.addEventListener('click', () => {
    isStartingRecording = true;
    if (previewPort) {
        previewPort.disconnect(); // Disconnect early so onDisconnect ignores it since isRecording will be true
    }
    settings.cameraDeviceId = cameraSelect.value;
    settings.micDeviceId = micSelect.value;
    saveSettings();
    chrome.runtime.sendMessage({ action: 'START_RECORDING', settings });
    if (window.self !== window.top) {
        window.parent.postMessage('HIDE_SIDEBAR', '*');
    }
    else {
        setTimeout(() => window.close(), 100);
    }
});
galleryBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('player/player.html') });
});
// Start
init();
export {};
