// ============================================================
// canvas.ts — Aura Canvas Whiteboard
// Handles drawing, background picking, and warning banner.
// ============================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const banner = $('#unsupported-banner');
const closeBannerBtn = $('#close-banner-btn');
const btnBackground = $('#btn-background');
const btnText = $('#btn-text');
const bgPickerPanel = $('#bg-picker-panel');
const swatches = $$('.swatch');
const canvas = $('#whiteboard');
const textLayer = $('#text-layer');
const ctx = canvas.getContext('2d');
let isDrawing = false;
let lastX = 0;
let lastY = 0;
function init() {
    // 1. Check URL parameters
    const params = new URLSearchParams(window.location.search);
    if (params.get('reason') === 'unsupported') {
        banner.classList.remove('hidden');
        // Automatically hide after 8 seconds
        setTimeout(() => {
            banner.classList.add('hidden');
        }, 8000);
    }
    // 2. Setup Canvas
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    // 3. Setup Event Listeners
    closeBannerBtn.addEventListener('click', () => {
        banner.classList.add('hidden');
    });
    btnBackground.addEventListener('click', (e) => {
        e.stopPropagation();
        bgPickerPanel.classList.toggle('hidden');
        btnBackground.classList.toggle('active');
    });
    document.addEventListener('click', (e) => {
        if (!bgPickerPanel.contains(e.target) && e.target !== btnBackground) {
            bgPickerPanel.classList.add('hidden');
            btnBackground.classList.remove('active');
        }
    });
    swatches.forEach(swatch => {
        swatch.addEventListener('click', () => {
            const bg = swatch.dataset['bg'];
            if (bg) {
                document.body.style.background = bg;
            }
        });
    });
    btnText.addEventListener('click', () => {
        // Inject clean text placeholders
        textLayer.innerHTML = `
      <div class="canvas-title" contenteditable="true" data-placeholder="Click to add title"></div>
      <div class="canvas-body" contenteditable="true" data-placeholder="Click to add text"></div>
    `;
        // Focus the title immediately
        const title = textLayer.querySelector('.canvas-title');
        if (title)
            title.focus();
    });
    // Basic drawing logic
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);
    // Listen for sidebar hide signal from popup iframe
    window.addEventListener('message', (e) => {
        if (e.data === 'HIDE_SIDEBAR') {
            const sidebar = document.querySelector('.recording-sidebar');
            if (sidebar)
                sidebar.style.display = 'none';
        }
    });
}
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    // Note: normally we'd redraw existing paths here
}
function startDrawing(e) {
    isDrawing = true;
    [lastX, lastY] = [e.clientX, e.clientY];
}
function draw(e) {
    if (!isDrawing)
        return;
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(e.clientX, e.clientY);
    // Default to a visible color
    ctx.strokeStyle = '#9d4edd';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
    [lastX, lastY] = [e.clientX, e.clientY];
}
function stopDrawing() {
    isDrawing = false;
}
init();
export {};
