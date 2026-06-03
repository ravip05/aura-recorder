// ============================================================
// player.ts — Aura Recorder Editor
// Handles playback, timeline trimming, and video export.
// ============================================================
import { listRecordings, deleteRecording, getRecording, saveRecording } from '../shared/idb.js';
// ---- DOM Elements ----
const $ = (sel) => document.querySelector(sel);
const emptyState = $('#empty-state');
const playerCanvas = $('#player-canvas');
const editorCtrls = $('#editor-controls');
const videoEl = $('#player-video');
const exportCanvas = $('#export-canvas');
const pbPlayBtn = $('#pb-play');
const pbCurrent = $('#pb-current');
const pbDuration = $('#pb-duration');
const btnCopy = $('#btn-copy-link');
const btnDownload = $('#btn-download');
const btnDelete = $('#btn-delete');
const btnGallery = $('#btn-gallery');
const timelineTrack = $('#timeline-track');
const trimStartHndl = $('#trim-start-handle');
const trimEndHndl = $('#trim-end-handle');
const trimSelect = $('#timeline-selection');
const playhead = $('#timeline-playhead');
const galleryOverlay = $('#gallery-overlay');
const galleryClose = $('#gallery-close');
const galleryBody = $('#gallery-body');
const galleryEmpty = $('#gallery-empty');
const titleContainer = $('#title-container');
const titleInput = $('#video-title-input');
const saveStatus = $('#save-status');
const exportOverlay = $('#export-overlay');
const exportPercent = $('#export-percent');
const exportProgressFill = $('#export-progress-fill');
// ---- State ----
let currentRecId = null;
let currentBlob = null;
let videoDuration = 0;
let trimStartRatio = 0;
let trimEndRatio = 1;
let isDraggingHandle = false;
let activeHandle = null;
let activeObjectUrls = [];
let audioSourceNode = null;
let audioContextInstance = null;
let audioDestinationNode = null;
function clearObjectUrls() {
    activeObjectUrls.forEach(url => URL.revokeObjectURL(url));
    activeObjectUrls = [];
}
// ---- Initialization ----
async function init() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (id) {
        await loadRecording(id);
    }
    else {
        showGallery();
    }
}
// ---- Formatting Utils ----
function formatTime(secs) {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}
// ---- Loading & Playback ----
async function loadRecording(id) {
    const rec = await getRecording(id);
    if (!rec) {
        alert('Recording not found.');
        return;
    }
    currentRecId = rec.id;
    currentBlob = rec.blob;
    titleInput.value = rec.title || 'Untitled Recording';
    if (!currentBlob)
        return;
    if (videoEl.src)
        URL.revokeObjectURL(videoEl.src);
    const url = URL.createObjectURL(currentBlob);
    activeObjectUrls.push(url);
    videoEl.src = url;
    videoEl.onloadedmetadata = () => {
        videoDuration = videoEl.duration;
        if (!Number.isFinite(videoDuration) || videoDuration <= 0) {
            // Fix infinite duration bug in Chrome webm recordings
            videoEl.currentTime = 10000000;
            videoEl.onseeked = () => {
                videoDuration = videoEl.duration;
                videoEl.currentTime = 0;
                videoEl.onseeked = null;
                setupEditor();
            };
        }
        else {
            setupEditor();
        }
    };
}
function setupEditor() {
    emptyState.style.display = 'none';
    playerCanvas.style.display = 'flex';
    editorCtrls.style.display = 'flex';
    titleContainer.style.display = 'flex';
    pbDuration.textContent = formatTime(videoDuration);
    // Reset trim state
    trimStartRatio = 0;
    trimEndRatio = 1;
    updateTimelineUI();
    // URL rewrite without refresh
    const url = new URL(window.location.href);
    url.searchParams.set('id', currentRecId);
    window.history.replaceState({}, '', url);
}
let saveTimeout = null;
titleInput.addEventListener('input', () => {
    if (saveTimeout)
        clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
        if (currentRecId && currentBlob) {
            const rec = await getRecording(currentRecId);
            if (rec) {
                rec.title = titleInput.value;
                await saveRecording(rec);
                saveStatus.classList.add('show');
                setTimeout(() => saveStatus.classList.remove('show'), 2000);
            }
        }
    }, 800);
});
// ---- Timeline Logic ----
function updateTimelineUI() {
    const startPct = trimStartRatio * 100;
    const endPct = trimEndRatio * 100;
    trimStartHndl.style.left = `${startPct}%`;
    trimEndHndl.style.left = `${endPct}%`;
    trimSelect.style.left = `${startPct}%`;
    trimSelect.style.width = `${endPct - startPct}%`;
}
timelineTrack.addEventListener('pointerdown', (e) => {
    const target = e.target;
    if (target.closest('.trim-handle')) {
        activeHandle = target.closest('#trim-start-handle') ? 'start' : 'end';
        isDraggingHandle = true;
        timelineTrack.setPointerCapture(e.pointerId);
    }
    else {
        // Seek to click
        const rect = timelineTrack.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        videoEl.currentTime = ratio * videoDuration;
    }
});
timelineTrack.addEventListener('pointermove', (e) => {
    if (!isDraggingHandle)
        return;
    const rect = timelineTrack.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (activeHandle === 'start') {
        trimStartRatio = Math.min(ratio, trimEndRatio - 0.05);
        if (videoEl.paused)
            videoEl.currentTime = trimStartRatio * videoDuration;
    }
    else {
        trimEndRatio = Math.max(ratio, trimStartRatio + 0.05);
        if (videoEl.paused)
            videoEl.currentTime = trimEndRatio * videoDuration;
    }
    updateTimelineUI();
});
timelineTrack.addEventListener('pointerup', (e) => {
    if (isDraggingHandle) {
        isDraggingHandle = false;
        timelineTrack.releasePointerCapture(e.pointerId);
        activeHandle = null;
    }
});
// Video Sync
videoEl.addEventListener('timeupdate', () => {
    const current = videoEl.currentTime;
    pbCurrent.textContent = formatTime(current);
    const ratio = current / videoDuration;
    playhead.style.left = `${ratio * 100}%`;
    // Loop back if it exceeds trim bounds
    if (current >= trimEndRatio * videoDuration && !isDraggingHandle) {
        videoEl.pause();
        videoEl.currentTime = trimStartRatio * videoDuration;
        syncPlayBtn();
    }
});
function syncPlayBtn() {
    const isPlaying = !videoEl.paused;
    pbPlayBtn.querySelector('.play-icon').setAttribute('style', isPlaying ? 'display:none' : '');
    pbPlayBtn.querySelector('.pause-icon').setAttribute('style', isPlaying ? '' : 'display:none');
}
pbPlayBtn.addEventListener('click', () => {
    if (videoEl.paused) {
        if (videoEl.currentTime >= trimEndRatio * videoDuration || videoEl.currentTime < trimStartRatio * videoDuration) {
            videoEl.currentTime = trimStartRatio * videoDuration;
        }
        videoEl.play();
    }
    else {
        videoEl.pause();
    }
    syncPlayBtn();
});
videoEl.addEventListener('play', syncPlayBtn);
videoEl.addEventListener('pause', syncPlayBtn);
// ---- Actions ----
btnCopy.addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.href);
    const ogText = btnCopy.innerHTML;
    btnCopy.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
    setTimeout(() => btnCopy.innerHTML = ogText, 2000);
});
btnDelete.addEventListener('click', async () => {
    if (confirm('Delete this recording forever?')) {
        await deleteRecording(currentRecId);
        window.location.search = '';
    }
});
btnGallery.addEventListener('click', showGallery);
galleryClose.addEventListener('click', () => galleryOverlay.classList.remove('active'));
// ---- Export (Trimming via Canvas fallback) ----
btnDownload.addEventListener('click', async () => {
    if (!currentBlob)
        return;
    const isFullVideo = trimStartRatio === 0 && trimEndRatio === 1;
    if (isFullVideo) {
        // Direct download
        triggerDownload(currentBlob, `Aura_${Date.now()}.webm`);
    }
    else {
        // Trim export via Canvas rendering (MVP fallback for no ffmpeg)
        await exportTrimmedVideo();
    }
});
async function exportTrimmedVideo() {
    btnDownload.disabled = true;
    exportOverlay.classList.add('active');
    exportPercent.textContent = '0%';
    exportProgressFill.style.width = '0%';
    // Set up canvas
    exportCanvas.width = videoEl.videoWidth;
    exportCanvas.height = videoEl.videoHeight;
    const ctx = exportCanvas.getContext('2d');
    // Create MediaRecorder from Canvas
    const stream = exportCanvas.captureStream(30);
    // Mux audio if present
    // Note: Canvas captureStream doesn't have audio. We need to route the video element's audio.
    let finalStream = stream;
    try {
        if (!audioContextInstance) {
            audioContextInstance = new AudioContext();
            audioSourceNode = audioContextInstance.createMediaElementSource(videoEl);
            audioDestinationNode = audioContextInstance.createMediaStreamDestination();
            audioSourceNode.connect(audioDestinationNode);
            audioSourceNode.connect(audioContextInstance.destination); // also play out loud
        }
        const audioTracks = audioDestinationNode.stream.getAudioTracks();
        if (audioTracks.length > 0) {
            finalStream.addTrack(audioTracks[0]);
        }
    }
    catch (e) {
        console.warn("Could not mux audio for canvas trim", e);
    }
    const recorder = new MediaRecorder(finalStream, { mimeType: 'video/webm;codecs=vp9' });
    const chunks = [];
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = () => {
        const trimmedBlob = new Blob(chunks, { type: 'video/webm' });
        triggerDownload(trimmedBlob, `${titleInput.value.replace(/[^a-z0-9]/gi, '_') || 'Trimmed'}_${Date.now()}.webm`);
        btnDownload.disabled = false;
        exportOverlay.classList.remove('active');
    };
    // Play the specific segment
    videoEl.currentTime = trimStartRatio * videoDuration;
    const startTime = videoEl.currentTime;
    const endTime = trimEndRatio * videoDuration;
    const totalDuration = endTime - startTime;
    recorder.start();
    videoEl.play();
    // Draw loop
    const drawLoop = () => {
        if (videoEl.currentTime >= endTime || videoEl.paused) {
            recorder.stop();
            videoEl.pause();
        }
        else {
            ctx.drawImage(videoEl, 0, 0, exportCanvas.width, exportCanvas.height);
            const pct = Math.min(100, Math.max(0, ((videoEl.currentTime - startTime) / totalDuration) * 100));
            exportPercent.textContent = `${Math.floor(pct)}%`;
            exportProgressFill.style.width = `${pct}%`;
            requestAnimationFrame(drawLoop);
        }
    };
    requestAnimationFrame(drawLoop);
}
function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
// ---- Gallery UI ----
async function showGallery() {
    galleryOverlay.classList.add('active');
    clearObjectUrls();
    const recs = await listRecordings();
    // Keep empty state if empty
    const cards = Array.from(galleryBody.querySelectorAll('.rec-card'));
    cards.forEach(c => c.remove());
    if (recs.length === 0) {
        galleryEmpty.style.display = 'block';
        return;
    }
    galleryEmpty.style.display = 'none';
    recs.forEach((rec) => {
        const div = document.createElement('div');
        div.className = 'rec-card';
        const dateStr = new Date(rec.createdAt).toLocaleDateString();
        const objUrl = URL.createObjectURL(rec.blob);
        activeObjectUrls.push(objUrl);
        div.innerHTML = `
      <video class="rec-thumb" src="${objUrl}#t=0.5"></video>
      <div class="rec-info">
        <span class="rec-date">${dateStr}</span>
        <span class="rec-dur">${formatTime(rec.duration)}</span>
      </div>
    `;
        div.addEventListener('click', () => {
            galleryOverlay.classList.remove('active');
            loadRecording(rec.id);
        });
        galleryBody.appendChild(div);
    });
}
init();
