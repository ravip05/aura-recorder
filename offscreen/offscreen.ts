// ============================================================
// offscreen/offscreen.ts — Media Capture Pipeline
//
// Runs inside the offscreen document. Responsibilities:
// 1. Acquire screen/tab display media via getDisplayMedia
// 2. Acquire microphone media via getUserMedia (if enabled)
// 3. Merge all audio tracks via Web Audio API into a single
//    mixed output stream
// 4. Feed the merged stream into MediaRecorder
// 5. Collect chunks, finalise blob, store into IndexedDB
// 6. Send RECORDING_COMPLETE back to the background worker
// ============================================================


import { saveRecording, generateId } from '../shared/idb.js';

// ---- Quality Constraint Map ----

interface QualityConstraints {
  width:     number;
  height:    number;
  frameRate: number;
}

const QUALITY_MAP: Record<number, QualityConstraints> = {
  720:  { width: 1280,  height: 720,  frameRate: 30 },
  1080: { width: 1920,  height: 1080, frameRate: 30 },
  2160: { width: 3840,  height: 2160, frameRate: 30 },
};

// ---- State ----

let mediaRecorder:   MediaRecorder | null = null;
let displayStream:   MediaStream   | null = null;
let micStream:       MediaStream   | null = null;
let audioContext:    AudioContext   | null = null;
let mixedDestination: MediaStreamAudioDestinationNode | null = null;
let micGainNode:     GainNode      | null = null;
let chunks:          Blob[]        = [];
let recordingStartTime = 0;
let isPaused       = false;
let currentSettings: RecorderSettings | null = null;

// ---- Core Pipeline ----

/**
 * Start the full recording pipeline:
 * 1. getDisplayMedia for screen capture (+ system audio if available)
 * 2. getUserMedia for microphone (if enabled)
 * 3. Merge audio with Web Audio API
 * 4. Start MediaRecorder on the final combined stream
 */
async function startRecording(settings: RecorderSettings): Promise<void> {
  currentSettings = settings;
  chunks = [];
  isPaused = false;

  const quality = QUALITY_MAP[settings.quality] ?? QUALITY_MAP[1080]!;

  // --- 1. Display Media (screen/tab/window capture) ---
  if (settings.captureMode !== 'camera-only') {
    const displayConstraints: DisplayMediaStreamOptions = {
      video: {
        width:     { ideal: quality.width },
        height:    { ideal: quality.height },
        frameRate: { ideal: quality.frameRate },
      },
      audio: settings.audioEnabled,
    };

    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia(displayConstraints);
    } catch (err) {
      console.error('[Aura Offscreen] getDisplayMedia failed:', err);
      notifyComplete('', 0);
      return;
    }

    // Listen for user stopping the share via browser UI
    displayStream.getVideoTracks().forEach(track => {
      track.addEventListener('ended', () => {
        console.log('[Aura Offscreen] Display track ended by user.');
        void stopRecording();
      });
    });
  }

  // --- 2. Microphone Media (if enabled) ---
  if (settings.micEnabled) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: settings.micDeviceId ? { exact: settings.micDeviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl:  true,
        },
        video: false,
      });
    } catch (err) {
      console.warn('[Aura Offscreen] Mic getUserMedia failed:', err);
      micStream = null;
    }
  }

  // --- 2b. Camera-only: get webcam video stream ---
  let cameraStream: MediaStream | null = null;
  if (settings.captureMode === 'camera-only') {
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: settings.cameraDeviceId
          ? { deviceId: { exact: settings.cameraDeviceId }, width: { ideal: quality.width }, height: { ideal: quality.height } }
          : { width: { ideal: quality.width }, height: { ideal: quality.height } },
        audio: false,
      });
    } catch (err) {
      console.error('[Aura Offscreen] Camera getUserMedia failed:', err);
      notifyComplete('', 0);
      return;
    }
  }

  // --- 3. Web Audio API Mixing ---
  audioContext = new AudioContext();
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }
  mixedDestination = audioContext.createMediaStreamDestination();

  // Source A: system audio from display stream
  if (displayStream) {
    const displayAudioTracks = displayStream.getAudioTracks();
    if (displayAudioTracks.length > 0) {
      const systemSource = audioContext.createMediaStreamSource(
        new MediaStream(displayAudioTracks)
      );
      systemSource.connect(mixedDestination);
    }
  }

  // Source B: microphone (with a gain node so we can mute/unmute)
  if (micStream) {
    const micSource = audioContext.createMediaStreamSource(micStream);
    micGainNode = audioContext.createGain();
    micGainNode.gain.value = 1.0;
    micSource.connect(micGainNode);
    micGainNode.connect(mixedDestination);
  }

  // --- 4. Build the final combined stream ---
  const combinedTracks: MediaStreamTrack[] = [];

  // Video: either screen capture or webcam
  if (displayStream) {
    combinedTracks.push(...displayStream.getVideoTracks());
  } else if (cameraStream) {
    combinedTracks.push(...cameraStream.getVideoTracks());
  }

  // Audio: mixed output
  combinedTracks.push(...mixedDestination.stream.getAudioTracks());

  const combinedStream = new MediaStream(combinedTracks);

  if (combinedTracks.length === 0) {
    console.error('[Aura Offscreen] No tracks to record.');
    notifyComplete('', 0);
    return;
  }

  // --- 5. MediaRecorder ---
  const mimeType = getSupportedMimeType();
  mediaRecorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: getBitrate(settings.quality),
  });

  mediaRecorder.ondataavailable = (event: BlobEvent) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  mediaRecorder.onstop = async () => {
    await finalizeRecording();
  };

  mediaRecorder.onerror = (event) => {
    console.error('[Aura Offscreen] MediaRecorder error:', event);
  };

  // Request data every 1 second for incremental chunk collection
  mediaRecorder.start(1000);
  recordingStartTime = Date.now();
  console.log(`[Aura Offscreen] Recording started — ${mimeType}`);
}

/**
 * Stop the active recording and trigger finalization.
 */
async function stopRecording(): Promise<void> {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    cleanup();
    return;
  }

  // Resume if paused so .stop() works correctly
  if (mediaRecorder.state === 'paused') {
    mediaRecorder.resume();
  }

  mediaRecorder.stop();
  // onstop handler will call finalizeRecording()
}

/**
 * After MediaRecorder stops, assemble the blob, store in IndexedDB,
 * and notify the background worker.
 */
async function finalizeRecording(): Promise<void> {
  const duration = Math.round((Date.now() - recordingStartTime) / 1000);
  const mimeType = mediaRecorder?.mimeType ?? 'video/webm';
  const blob = new Blob(chunks, { type: mimeType });

  if (blob.size === 0) {
    console.warn('[Aura Offscreen] Empty recording blob, discarding.');
    cleanup();
    notifyComplete('', 0);
    return;
  }

  const id = generateId();

  try {
    await saveRecording({
      id,
      blob,
      mimeType,
      duration,
      createdAt: Date.now(),
      title: `Recording ${new Date().toLocaleString()}`,
    });
    console.log(`[Aura Offscreen] Saved recording ${id} (${(blob.size / 1024 / 1024).toFixed(1)} MB, ${duration}s)`);
  } catch (err) {
    console.error('[Aura Offscreen] Failed to save recording:', err);
  }

  cleanup();
  notifyComplete(id, duration);
}

/**
 * Send RECORDING_COMPLETE message back to the background worker.
 */
function notifyComplete(blobId: string, duration: number): void {
  const msg: OffscreenMessage = { action: 'RECORDING_COMPLETE', blobId, duration };
  chrome.runtime.sendMessage(msg).catch((err: Error) => {
    console.warn('[Aura Offscreen] Could not notify background:', err.message);
  });
}

/**
 * Release all media resources.
 */
function cleanup(): void {
  displayStream?.getTracks().forEach(t => t.stop());
  micStream?.getTracks().forEach(t => t.stop());
  displayStream = null;
  micStream     = null;

  if (audioContext && audioContext.state !== 'closed') {
    void audioContext.close();
  }
  audioContext      = null;
  mixedDestination  = null;
  micGainNode       = null;
  mediaRecorder     = null;
  chunks            = [];
  currentSettings   = null;
}

// ---- Control Handlers ----

function handlePause(): void {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.pause();
    isPaused = true;
    console.log('[Aura Offscreen] Recording paused.');
  }
}

function handleResume(): void {
  if (mediaRecorder && mediaRecorder.state === 'paused') {
    mediaRecorder.resume();
    isPaused = false;
    console.log('[Aura Offscreen] Recording resumed.');
  }
}

function handleSetMicMuted(muted: boolean): void {
  if (micGainNode) {
    micGainNode.gain.setTargetAtTime(muted ? 0 : 1, audioContext!.currentTime, 0.015);
    console.log(`[Aura Offscreen] Mic ${muted ? 'muted' : 'unmuted'}.`);
  }
}

// ---- MIME Type & Bitrate Helpers ----

/**
 * Determine the best supported MIME type for MediaRecorder.
 * Preference order: webm+vp9+opus > webm+vp8+opus > webm
 */
function getSupportedMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];

  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }

  // Absolute fallback — let the browser decide
  return '';
}

/**
 * Get a reasonable video bitrate for the given quality tier.
 */
function getBitrate(quality: number): number {
  switch (quality) {
    case 720:  return 2_500_000;   // 2.5 Mbps
    case 1080: return 5_000_000;   // 5 Mbps
    case 2160: return 16_000_000;  // 16 Mbps
    default:   return 5_000_000;
  }
}

// ---- Message Listener ----

type IncomingMessage = OffscreenMessage | ControlMessage;

chrome.runtime.onMessage.addListener(
  (message: IncomingMessage, _sender, sendResponse) => {
    (async () => {
      try {
        switch (message.action) {
          case 'INIT_RECORDING': {
            const initMsg = message as Extract<OffscreenMessage, { action: 'INIT_RECORDING' }>;
            await startRecording(initMsg.settings);
            break;
          }

          case 'STOP_RECORDING':
            await stopRecording();
            break;

          case 'PAUSE_RECORDING':
            handlePause();
            break;

          case 'RESUME_RECORDING':
            handleResume();
            break;

          case 'SET_MIC_MUTED':
            handleSetMicMuted(
              (message as Extract<ControlMessage, { action: 'SET_MIC_MUTED' }>).muted
            );
            break;

          default:
            break;
        }
        sendResponse({ ok: true });
      } catch (err) {
        console.error('[Aura Offscreen] Handler error:', err);
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }
);

console.log('[Aura] Offscreen document loaded — recording pipeline ready.');
