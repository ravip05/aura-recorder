// ============================================================
// shared/types.ts
// Shared TypeScript type definitions for the Aura Recorder
// Chrome Extension. Import from here in all modules.
// ============================================================

/** Capture source type */
type CaptureMode = 'screen-only' | 'screen-camera' | 'camera-only';

/** Quality preset in vertical pixels */
type Quality = 720 | 1080 | 2160;

/** The full configuration object persisted in chrome.storage.local */
interface RecorderSettings {
  captureMode:    CaptureMode;
  cameraEnabled:  boolean;
  micEnabled:     boolean;
  audioEnabled:   boolean;
  cameraDeviceId: string;
  micDeviceId:    string;
  quality:        Quality;
}

/** Messages from popup → background worker */
type PopupMessage =
  | { action: 'START_RECORDING'; settings: RecorderSettings }
  | { action: 'STOP_RECORDING' }
  | { action: 'OPEN_PLAYER' }
  | { action: 'TOGGLE_CAMERA_PREVIEW'; show: boolean; settings: RecorderSettings };

/** Messages from background ↔ offscreen document */
type OffscreenMessage =
  | { action: 'INIT_RECORDING'; settings: RecorderSettings }
  | { action: 'STOP_RECORDING' }
  | { action: 'RECORDING_COMPLETE'; blobId: string; duration: number };

/** Messages from background → content script */
type ContentMessage =
  | { action: 'SHOW_CAMERA_BUBBLE'; settings: RecorderSettings }
  | { action: 'HIDE_CAMERA_BUBBLE' };

/** Messages from content script → background (control signals) */
type ControlMessage =
  | { action: 'PAUSE_RECORDING' }
  | { action: 'RESUME_RECORDING' }
  | { action: 'SET_MIC_MUTED'; muted: boolean }
  | { action: 'STOP_RECORDING' };
