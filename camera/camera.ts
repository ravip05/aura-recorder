export {};

const video = document.getElementById('cam-video') as HTMLVideoElement;
const loadingState = document.getElementById('loading-state');
let activeStream: MediaStream | null = null;

async function init() {
  const result = await chrome.storage.local.get('recordingSettings');
  const settings = result['recordingSettings'];

  if (!settings || !settings.cameraEnabled) {
    if (loadingState) loadingState.classList.add('hidden');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: settings.cameraDeviceId ? { deviceId: { exact: settings.cameraDeviceId } } : true,
      audio: false
    });
    
    activeStream = stream;
    video.srcObject = stream;

    // Hide loading state once the video frame is actually rendering
    video.addEventListener('playing', () => {
      if (loadingState) loadingState.classList.add('hidden');
    }, { once: true });

    video.play().catch(e => console.error('[Aura Camera] Play failed:', e));
  } catch (err) {
    console.error('[Aura Camera] Failed to get user media in iframe:', err);
    if (loadingState) loadingState.classList.add('hidden');
  }
}

window.addEventListener('unload', () => {
  if (activeStream) {
    activeStream.getTracks().forEach(t => t.stop());
  }
});

init();
