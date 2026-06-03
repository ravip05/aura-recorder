"use strict";
// ============================================================
// content.ts — Injected Content Script
// Injects a Shadow DOM with a separated camera bubble and 
// control pill. Both are independently draggable and their 
// positions are persisted across navigations.
// ============================================================
(function () {
    if (window.__AURA_INJECTED)
        return;
    window.__AURA_INJECTED = true;
    // ---- Constants & State ----
    const BUBBLE_MIN_SIZE = 100;
    const BUBBLE_MAX_SIZE = 400;
    const BUBBLE_DEFAULT = 200;
    const HOST_ID = 'aura-recorder-host';
    let hostEl = null;
    let shadow = null;
    let bubble = null;
    let controls = null;
    let videoWrap = null;
    let iframeEl = null;
    let isPaused = false;
    let isMicMuted = false;
    let isCircle = true;
    // Drag state
    let activeDragEl = null;
    let dragStartX = 0;
    let dragStartY = 0;
    let elLeft = 0;
    let elTop = 0;
    let bubbleSize = BUBBLE_DEFAULT;
    let isResizing = false;
    let resizeStartX = 0;
    let resizeStartY = 0;
    let resizeStartSz = 0;
    // ---- Position Validation ----
    // Clamp saved positions to the current viewport so they never appear offscreen.
    function clampPosition(pos, elWidth, elHeight) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        return {
            x: Math.max(0, Math.min(pos.x, vw - elWidth)),
            y: Math.max(0, Math.min(pos.y, vh - elHeight)),
        };
    }
    // ---- UI Builder ----
    function buildDOM(cssText, settings, savedPositions = {}) {
        const style = document.createElement('style');
        style.textContent = cssText;
        shadow.appendChild(style);
        // --- 1. Camera Bubble ---
        bubble = document.createElement('div');
        bubble.id = 'aura-bubble';
        if (savedPositions.bubble) {
            const clamped = clampPosition(savedPositions.bubble, BUBBLE_DEFAULT, BUBBLE_DEFAULT);
            bubble.style.left = `${clamped.x}px`;
            bubble.style.top = `${clamped.y}px`;
            bubble.style.bottom = 'auto';
        }
        // If no saved position, CSS defaults apply: bottom: 20px; left: 20px;
        videoWrap = document.createElement('div');
        videoWrap.id = 'aura-video-wrap';
        iframeEl = document.createElement('iframe');
        iframeEl.id = 'aura-video';
        iframeEl.allow = 'camera; microphone';
        iframeEl.style.border = 'none';
        iframeEl.style.width = '100%';
        iframeEl.style.height = '100%';
        iframeEl.style.pointerEvents = 'none'; // Let drag events pass through to bubble
        const pausedOverlay = document.createElement('div');
        pausedOverlay.id = 'aura-paused-overlay';
        pausedOverlay.innerHTML = `<svg viewBox="0 0 24 24"><path d="M10 4H6v16h4V4zm8 0h-4v16h4V4z"/></svg>`;
        const micMuted = document.createElement('div');
        micMuted.id = 'aura-mic-muted';
        micMuted.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none">
      <line x1="1" y1="1" x2="23" y2="23"/>
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v4M8 23h8"/>
    </svg>`;
        const resizeHandle = document.createElement('div');
        resizeHandle.id = 'aura-resize';
        videoWrap.append(iframeEl, pausedOverlay, micMuted);
        bubble.append(videoWrap, resizeHandle);
        shadow.appendChild(bubble);
        // --- 2. Controls Pill ---
        controls = document.createElement('div');
        controls.id = 'aura-controls';
        if (savedPositions.controls) {
            // Controls pill is about 40px wide, ~180px tall
            const clamped = clampPosition(savedPositions.controls, 40, 180);
            controls.style.left = `${clamped.x}px`;
            controls.style.top = `${clamped.y}px`;
            controls.style.transform = 'none'; // Clear the default translateY
        }
        // If no saved position, CSS defaults apply: top: 50%; left: 20px; transform: translateY(-50%);
        const pauseBtn = makeCtrlBtn('pause-btn', `<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/></svg>`, 'Pause');
        const micBtn = makeCtrlBtn('mic-btn', `<svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg>`, 'Toggle microphone');
        const shapeBtn = makeCtrlBtn('shape-btn', `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke-width="2"/></svg>`, 'Toggle shape');
        const div = document.createElement('span');
        div.className = 'ctrl-divider';
        const stopBtn = makeCtrlBtn('stop-btn', `<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor"/></svg>`, 'Stop recording');
        controls.append(pauseBtn, micBtn, shapeBtn, div, stopBtn);
        shadow.appendChild(controls);
        // --- Events ---
        pauseBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePause(pauseBtn, pausedOverlay); });
        micBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMic(micBtn, micMuted); });
        shapeBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleShape(shapeBtn); });
        stopBtn.addEventListener('click', (e) => { e.stopPropagation(); stopRecording(); });
        bubble.addEventListener('pointerdown', (e) => onDragStart(e, bubble));
        controls.addEventListener('pointerdown', (e) => onDragStart(e, controls));
        resizeHandle.addEventListener('pointerdown', onResizeStart);
    }
    function makeCtrlBtn(extraClass, svgHTML, title) {
        const btn = document.createElement('button');
        btn.className = `ctrl-btn ${extraClass}`;
        btn.title = title;
        btn.innerHTML = svgHTML;
        return btn;
    }
    // ---- Media Streams ----
    async function startCamera(settings) {
        if (!settings.cameraEnabled) {
            if (bubble)
                bubble.style.display = 'none';
            return;
        }
        if (bubble)
            bubble.style.display = 'block';
        if (iframeEl) {
            iframeEl.src = chrome.runtime.getURL('camera/camera.html');
            videoWrap?.classList.add('recording-active');
        }
    }
    function stopCamera() {
        if (iframeEl)
            iframeEl.src = '';
    }
    // ---- Actions ----
    function togglePause(btn, overlay) {
        isPaused = !isPaused;
        btn.classList.toggle('active', isPaused);
        overlay.classList.toggle('visible', isPaused);
        btn.innerHTML = isPaused
            ? `<svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>`
            : `<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/></svg>`;
        chrome.runtime.sendMessage({ action: isPaused ? 'PAUSE_RECORDING' : 'RESUME_RECORDING' }).catch(() => { });
    }
    function toggleMic(btn, indicator) {
        isMicMuted = !isMicMuted;
        btn.classList.toggle('active', isMicMuted);
        indicator.classList.toggle('visible', isMicMuted);
        chrome.runtime.sendMessage({ action: 'SET_MIC_MUTED', muted: isMicMuted }).catch(() => { });
    }
    function toggleShape(btn) {
        isCircle = !isCircle;
        videoWrap?.classList.toggle('rounded-rect', !isCircle);
        btn.innerHTML = isCircle
            ? `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke-width="2"/></svg>`
            : `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5" stroke-width="2"/></svg>`;
    }
    function stopRecording() {
        chrome.runtime.sendMessage({ action: 'STOP_RECORDING' }).catch(() => { });
        removeBubble();
    }
    // ---- Drag Logic ----
    function onDragStart(e, el) {
        const target = e.target;
        if (target.closest('.ctrl-btn') || target.closest('#aura-resize'))
            return;
        activeDragEl = el;
        el.setPointerCapture(e.pointerId);
        const rect = el.getBoundingClientRect();
        elLeft = rect.left;
        elTop = rect.top;
        el.style.bottom = 'auto';
        el.style.right = 'auto';
        el.style.left = `${elLeft}px`;
        el.style.top = `${elTop}px`;
        el.style.transform = 'none';
        dragStartX = e.clientX - elLeft;
        dragStartY = e.clientY - elTop;
        el.addEventListener('pointermove', onDragMove);
        el.addEventListener('pointerup', onDragEnd);
    }
    function onDragMove(e) {
        if (!activeDragEl)
            return;
        const rect = activeDragEl.getBoundingClientRect();
        const maxLeft = window.innerWidth - rect.width;
        const maxTop = window.innerHeight - rect.height;
        elLeft = Math.max(0, Math.min(e.clientX - dragStartX, maxLeft));
        elTop = Math.max(0, Math.min(e.clientY - dragStartY, maxTop));
        activeDragEl.style.left = `${elLeft}px`;
        activeDragEl.style.top = `${elTop}px`;
    }
    async function onDragEnd(e) {
        if (!activeDragEl)
            return;
        activeDragEl.releasePointerCapture(e.pointerId);
        activeDragEl.removeEventListener('pointermove', onDragMove);
        activeDragEl.removeEventListener('pointerup', onDragEnd);
        // Save position state
        const pos = await chrome.storage.local.get('uiPositions').then(r => r['uiPositions'] || {});
        if (activeDragEl === bubble) {
            pos.bubble = { x: elLeft, y: elTop };
        }
        else {
            pos.controls = { x: elLeft, y: elTop };
        }
        await chrome.storage.local.set({ uiPositions: pos });
        activeDragEl = null;
    }
    // ---- Resize Logic ----
    function onResizeStart(e) {
        e.stopPropagation();
        if (!bubble)
            return;
        isResizing = true;
        bubble.setPointerCapture(e.pointerId);
        resizeStartX = e.clientX;
        resizeStartY = e.clientY;
        resizeStartSz = bubbleSize;
        bubble.style.transition = 'none';
        bubble.addEventListener('pointermove', onResizeMove);
        bubble.addEventListener('pointerup', onResizeEnd);
    }
    function onResizeMove(e) {
        if (!isResizing || !bubble)
            return;
        const dx = e.clientX - resizeStartX;
        const dy = e.clientY - resizeStartY;
        const maxDelta = Math.max(dx, dy);
        bubbleSize = Math.max(BUBBLE_MIN_SIZE, Math.min(BUBBLE_MAX_SIZE, resizeStartSz + maxDelta));
        bubble.style.width = `${bubbleSize}px`;
        bubble.style.height = `${bubbleSize}px`;
    }
    function onResizeEnd(e) {
        if (!isResizing || !bubble)
            return;
        isResizing = false;
        bubble.releasePointerCapture(e.pointerId);
        bubble.style.transition = '';
        bubble.removeEventListener('pointermove', onResizeMove);
        bubble.removeEventListener('pointerup', onResizeEnd);
    }
    // Cache CSS text so we only fetch it once across navigations
    let cachedCssText = null;
    async function showBubble(settings) {
        // Guard: don't double-inject
        if (hostEl || document.getElementById(HOST_ID))
            return;
        hostEl = document.createElement('div');
        hostEl.id = HOST_ID;
        hostEl.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;';
        shadow = hostEl.attachShadow({ mode: 'open' });
        // Use cached CSS or fetch it once
        if (!cachedCssText) {
            cachedCssText = await fetch(chrome.runtime.getURL('content/overlay.css')).then(r => r.text());
        }
        const pos = await chrome.storage.local.get('uiPositions').then(r => r['uiPositions'] || {});
        buildDOM(cachedCssText, settings, pos);
        // Append directly to documentElement — it exists at document_start,
        // so the overlay appears instantly without waiting for body.
        // position:fixed works identically on <html> as on <body>.
        document.documentElement.appendChild(hostEl);
        await startCamera(settings);
    }
    function removeBubble() {
        stopCamera();
        hostEl?.remove();
        hostEl = shadow = bubble = controls = videoWrap = iframeEl = null;
        isPaused = isMicMuted = false;
        isCircle = true;
    }
    // ---- Message Handler ----
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'SHOW_CAMERA_BUBBLE') {
            void showBubble(msg.settings);
        }
        else if (msg.action === 'HIDE_CAMERA_BUBBLE') {
            removeBubble();
        }
    });
    // ---- Self-Restore on Injection ----
    // This is the critical piece that eliminates the race condition.
    // When this script loads (whether via manifest content_scripts or
    // background.ts programmatic injection), it immediately checks 
    // chrome.storage for an active recording and auto-shows the bubble.
    // This means we do NOT depend on a sendMessage arriving on time.
    (async function autoRestore() {
        try {
            const { isRecording, recordingSettings } = await chrome.storage.local.get(['isRecording', 'recordingSettings']);
            if (isRecording && recordingSettings) {
                await showBubble(recordingSettings);
            }
        }
        catch {
            // Extension context may be invalidated during unload — silently ignore
        }
    })();
})();
