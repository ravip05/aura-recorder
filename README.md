# Aura Recorder

Aura Recorder is a premium, lightweight Chrome Extension (Manifest V3) screen and webcam recorder that elevates visual communication. It offers draggable and resizable video bubbles with glassmorphic on-screen controls, and instantly wraps completed recordings inside elegant macOS-style mockups with customizable background gradients for a polished, presentation-ready finish.

## Features

- **Screen & Webcam Recording**: Capture your screen, application windows, or browser tabs alongside a customizable webcam bubble.
- **Glassmorphic UI**: Beautifully designed on-screen controls for an elevated user experience.
- **Draggable & Resizable Bubble**: Move and scale the camera bubble anywhere on your screen.
- **macOS-style Mockups**: Automatically wraps your recordings in an elegant mockup with customizable background gradients.
- **100% Offline & Private**: Processes everything locally on your device without relying on external servers.
- **Zero Compilation Overhead**: Built with pure HTML5, CSS3, and Vanilla JavaScript.

## Screenshots

### Main Interface
![Main Interface]

### Recording in Progress
![Recording in Progress]

### Presentation Mockup
![Presentation Mockup]

## Installation

To install Aura Recorder locally for development or personal use:

1. **Clone the repository** (or download the source code):
   ```bash
   git clone https://github.com/ravip05/aura-recorder.git
   ```

2. **Open Chrome Extensions Page**:
   - Open Google Chrome.
   - Navigate to `chrome://extensions/` in your address bar.

3. **Enable Developer Mode**:
   - Toggle the **Developer mode** switch in the top right corner of the Extensions page.

4. **Load Unpacked Extension**:
   - Click the **Load unpacked** button that appears in the top left.
   - Select the `aura-recorder` directory containing the `manifest.json` file.

5. **Pin the Extension**:
   - Click the puzzle icon (Extensions) in your Chrome toolbar.
   - Click the pin icon next to **Aura Recorder** for easy access.

## Usage

1. Click the Aura Recorder extension icon in your toolbar.
2. Select whether to record your Screen, Camera, or Both.
3. Use the on-screen glassmorphic controls to pause, resume, or stop the recording.
4. Once stopped, you'll be redirected to the player page where you can preview your recording in a macOS-style mockup and customize the background gradient.
5. Export and save your polished recording locally!

## Technology Stack

- **Manifest V3**: Modern Chrome Extension architecture.
- **Vanilla JavaScript**: Pure, dependency-free JS for maximum performance.
- **HTML5/CSS3**: Custom glassmorphism UI using Shadow DOM for CSS isolation.
- **MediaRecorder & Web Audio APIs**: High-quality local media capture.
- **IndexedDB**: Robust local storage.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
