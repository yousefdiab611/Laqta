const startButton = document.getElementById('start');
const cancelButton = document.getElementById('cancel');
const status = document.getElementById('status');
const video = document.getElementById('capture-video');
const timerSelect = document.getElementById('timer');
const cursorCheckbox = document.getElementById('cursor');
const copyCheckbox = document.getElementById('copy');

function chooseCaptureSource() {
    return new Promise((resolve, reject) => {
        chrome.desktopCapture.chooseDesktopMedia(['window'], (streamId) => {
            if (!streamId) {
                reject(new Error('Screen sharing was cancelled.'));
                return;
            }
            resolve(streamId);
        });
    });
}

function applyCursorPreference(stream) {
    const track = stream.getVideoTracks()[0];
    if (!track || typeof track.getCapabilities !== 'function') return Promise.resolve();
    if (!track.getCapabilities().cursor) return Promise.resolve();
    const cursor = cursorCheckbox.checked ? 'always' : 'never';
    return track.applyConstraints({ cursor });
}

function currentWindow() {
    return new Promise((resolve, reject) => {
        chrome.windows.getCurrent((windowInfo) => {
            if (chrome.runtime.lastError || !windowInfo?.id) {
                reject(new Error(chrome.runtime.lastError?.message || 'Could not identify the capture window.'));
                return;
            }
            resolve(windowInfo);
        });
    });
}

function minimizeWindow(windowId) {
    return new Promise((resolve) => {
        chrome.windows.update(windowId, { state: 'minimized' }, () => resolve());
    });
}

function waitForVideoMetadata() {
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth > 0) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('The shared screen did not become ready.')), 8000);
        video.addEventListener('loadedmetadata', () => {
            clearTimeout(timer);
            resolve();
        }, { once: true });
    });
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function captureVideoFrame() {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context || !canvas.width || !canvas.height) {
        throw new Error('Could not read the shared screen.');
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
}

function openInEditor(dataUrl) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: 'POPUP_OPEN_WITH_IMAGE',
            dataUrl,
            fileType: 'png'
        }, (response) => {
            if (chrome.runtime.lastError || !response?.ok) {
                reject(new Error(chrome.runtime.lastError?.message || 'Could not open the screenshot in the editor.'));
                return;
            }
            resolve();
        });
    });
}

async function copyScreenshot(dataUrl) {
    const imageBlob = await fetch(dataUrl).then((response) => response.blob());
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': imageBlob })]);
}

function deliverScreenshot(dataUrl) {
    if (!copyCheckbox.checked) return openInEditor(dataUrl);
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'APPLY_BRAND_KIT', dataUrl }, (response) => {
            if (!response?.ok) {
                reject(new Error(response?.error || 'Brand Kit failed.'));
                return;
            }
            copyScreenshot(response.dataUrl).then(resolve, reject);
        });
    });
}

function ensureClipboardPermission() {
    if (!copyCheckbox.checked) return Promise.resolve(true);
    return new Promise((resolve, reject) => {
        chrome.permissions.request({ permissions: ['clipboardWrite'] }, (granted) => {
            if (granted) resolve(true);
            else reject(new Error('Clipboard permission is required to copy the screenshot.'));
        });
    });
}

async function waitForCountdown() {
    const seconds = Number(timerSelect.value);
    for (let remaining = seconds; remaining > 0; remaining--) {
        status.textContent = `Capturing in ${remaining}…`;
        await wait(1000);
    }
}

async function startCapture() {
    let stream;
    let captureWindow;
    startButton.disabled = true;
    cancelButton.disabled = true;
    status.textContent = 'Preparing capture…';

    try {
        await ensureClipboardPermission();
        status.textContent = 'Choose your main Chrome window in the next window…';
        const streamId = await chooseCaptureSource();
        stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: streamId,
                    maxWidth: 7680,
                    maxHeight: 4320,
                    maxFrameRate: 5
                }
            }
        });

        video.srcObject = stream;
        await applyCursorPreference(stream);
        await video.play();
        await waitForVideoMetadata();

        captureWindow = await currentWindow();
        status.textContent = 'Capturing…';
        await minimizeWindow(captureWindow.id);
        await wait(900);
        await waitForCountdown();

        const dataUrl = captureVideoFrame();
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
        await deliverScreenshot(dataUrl);
        chrome.windows.remove(captureWindow.id);
    } catch (error) {
        if (stream) stream.getTracks().forEach((track) => track.stop());
        if (captureWindow?.id) {
            chrome.windows.update(captureWindow.id, { state: 'normal', focused: true });
        }
        status.textContent = error?.message || 'Screen capture failed.';
        startButton.disabled = false;
        cancelButton.disabled = false;
    }
}

startButton.addEventListener('click', startCapture);
cancelButton.addEventListener('click', () => window.close());

if (new URLSearchParams(location.search).get('output') === 'copy') {
    copyCheckbox.checked = true;
}
