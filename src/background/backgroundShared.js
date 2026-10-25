const COMMAND_CAPTURE_SELECTION = 'capture-selection';
const TRANSIENT_SCREENSHOT_KEY = 'pendingScreenshot';
const LEGACY_SCREENSHOT_KEY = 'screenshot';
const PENDING_COLLAGE_BATCH_KEY = 'pendingCollageBatch';
const PENDING_CAPTURE_TTL_MS = 2 * 60 * 1000;

const pendingCaptures = new Map();
const pendingFallbackWrites = new Map();
const pendingBatches = new Map();

function createPendingCaptureToken() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function touchWithTtl(store, token, entry) {
    if (!entry) return null;
    if (entry.timeoutId) clearTimeout(entry.timeoutId);
    entry.timeoutId = setTimeout(() => store.delete(token), PENDING_CAPTURE_TTL_MS);
    store.set(token, entry);
    return entry;
}

function storePendingCapture(screenshot) {
    const token = createPendingCaptureToken();
    touchWithTtl(pendingCaptures, token, { screenshot, timeoutId: null });
    return token;
}

function readPendingCapture(token) {
    if (!token) return null;
    const entry = touchWithTtl(pendingCaptures, token, pendingCaptures.get(token));
    return entry ? (entry.screenshot || null) : null;
}

function deletePendingCapture(token) {
    if (!token) return;
    const entry = pendingCaptures.get(token);
    if (entry && entry.timeoutId) clearTimeout(entry.timeoutId);
    pendingCaptures.delete(token);
}

async function openCollageWithImages(dataUrls) {
    const token = createPendingCaptureToken();
    touchWithTtl(pendingBatches, token, { dataUrls, timeoutId: null });

    // Durable fallback: the in-memory Map is lost if the MV3 worker is evicted during the
    // tab-open gap (the editor then reads an empty batch → blank collage). Mirror the
    // screenshot handoff and back the batch in session storage so the editor can recover it.
    // Covers both popup "Create Collage" and Capture-Steps finish (both route through here).
    const storageArea = getTransientScreenshotStorage();
    const storagePromise = storageSet(storageArea, {
        [PENDING_COLLAGE_BATCH_KEY]: { token, dataUrls }
    }).catch((error) => {
        console.error('Collage batch fallback store failed:', error);
    });

    const editorUrl = new URL('editor/index.html', chrome.runtime.getURL('/'));
    editorUrl.searchParams.set('mode', 'collage');
    editorUrl.searchParams.set('batch', token);
    await createTab({ url: editorUrl.toString() });
    await storagePromise;
}

async function readPendingBatch(token) {
    if (!token) return null;
    const entry = touchWithTtl(pendingBatches, token, pendingBatches.get(token));
    if (entry && entry.dataUrls) return entry.dataUrls;
    // Map miss (likely worker eviction) — recover from the durable session-storage fallback.
    const storageArea = getTransientScreenshotStorage();
    const result = await storageGet(storageArea, [PENDING_COLLAGE_BATCH_KEY]).catch(() => ({}));
    const value = result ? result[PENDING_COLLAGE_BATCH_KEY] : null;
    if (value && typeof value === 'object' && value.token === token && Array.isArray(value.dataUrls)) {
        return value.dataUrls;
    }
    return null;
}

function normalizeCapturePayload(input) {
    if (typeof input === 'string') {
        return { screenshot: input, selection: null };
    }

    if (input && typeof input === 'object' && typeof input.screenshot === 'string') {
        return { screenshot: input.screenshot, selection: input.selection || null };
    }

    throw new Error('Invalid capture payload.');
}

function getTransientScreenshotStorage() {
    if (chrome.storage && chrome.storage.session) return chrome.storage.session;
    return chrome.storage.local;
}

async function storageSet(storageArea, value) {
    return new Promise((resolve, reject) => {
        storageArea.set(value, () => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve();
        });
    });
}

async function storageGet(storageArea, keys) {
    return new Promise((resolve, reject) => {
        storageArea.get(keys, (result) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(result || {});
        });
    });
}

async function storageRemove(storageArea, keys) {
    return new Promise((resolve, reject) => {
        storageArea.remove(keys, () => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve();
        });
    });
}

async function createTab(createProperties) {
    return new Promise((resolve, reject) => {
        chrome.tabs.create(createProperties, (tab) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(tab);
        });
    });
}

async function getActiveTab() {
    return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            resolve((tabs && tabs[0]) || null);
        });
    });
}

// Chrome enforces MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND. Serialize captures, enforce a
// minimum gap, and retry once quota errors clear (double shortcuts, popup + command, etc.).
const CAPTURE_VISIBLE_TAB_MIN_GAP_MS = 550;
let captureVisibleTabQueue = Promise.resolve();
let lastCaptureVisibleTabEndMs = 0;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCaptureVisibleTabQuotaError(message) {
    return typeof message === 'string' && message.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND');
}

async function captureVisibleTabOnce(windowId) {
    return new Promise((resolve, reject) => {
        chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            if (!dataUrl) {
                reject(new Error('Capture returned no image data.'));
                return;
            }
            resolve(dataUrl);
        });
    });
}

async function captureVisibleTab(windowId) {
    const run = async () => {
        const gapWait = Math.max(0, CAPTURE_VISIBLE_TAB_MIN_GAP_MS - (Date.now() - lastCaptureVisibleTabEndMs));
        if (gapWait > 0) await sleep(gapWait);

        const maxAttempts = 4;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                const dataUrl = await captureVisibleTabOnce(windowId);
                lastCaptureVisibleTabEndMs = Date.now();
                return dataUrl;
            } catch (error) {
                const msg = error && error.message ? error.message : '';
                if (isCaptureVisibleTabQuotaError(msg) && attempt < maxAttempts - 1) {
                    await sleep(CAPTURE_VISIBLE_TAB_MIN_GAP_MS * (attempt + 1));
                    continue;
                }
                throw error;
            }
        }
    };

    const next = captureVisibleTabQueue.then(run, run);
    captureVisibleTabQueue = next.catch(() => {});
    return next;
}

async function openEditorWithScreenshot(input, opts) {
    const normalizedPayload = normalizeCapturePayload(input);
    const brandedScreenshot = opts && opts.skipBrand
        ? normalizedPayload.screenshot
        : await self.fsBrandRenderer.applyBrandKit(normalizedPayload.screenshot);
    const capturePayload = { ...normalizedPayload, screenshot: brandedScreenshot };
    if (!opts || !opts.skipHistory) {
        await self.fsCaptureHistory.saveCapture(capturePayload.screenshot).catch((error) => {
            console.error('Capture history save failed:', error);
        });
    }
    const captureToken = storePendingCapture(capturePayload);
    const storageArea = getTransientScreenshotStorage();
    const fallbackPayload = {
        token: captureToken,
        screenshot: capturePayload.screenshot,
        selection: capturePayload.selection || null
    };
    const storagePromise = storageSet(storageArea, { [TRANSIENT_SCREENSHOT_KEY]: fallbackPayload }).catch((error) => {
        console.error('Screenshot fallback store failed:', error);
    });
    pendingFallbackWrites.set(captureToken, { storageArea, promise: storagePromise });

    if (storageArea !== chrome.storage.local) {
        storageRemove(chrome.storage.local, [LEGACY_SCREENSHOT_KEY, TRANSIENT_SCREENSHOT_KEY]).catch(() => {});
    }

    const editorUrl = new URL('editor/index.html', chrome.runtime.getURL('/'));
    editorUrl.searchParams.set('capture', captureToken);
    if (capturePayload.selection) editorUrl.searchParams.set('selection', '1');
    if (opts && opts.autoCrop) editorUrl.searchParams.set('crop', '1');
    if (opts && opts.notice) editorUrl.searchParams.set('notice', opts.notice);

    await createTab({ url: editorUrl.toString() });
    await storagePromise;
}

async function removeTransientScreenshotIfMatches(storageArea, token) {
    if (!storageArea || !token) return;
    const result = await storageGet(storageArea, [TRANSIENT_SCREENSHOT_KEY]).catch(() => ({}));
    const value = result ? result[TRANSIENT_SCREENSHOT_KEY] : null;
    if (value && typeof value === 'object' && value.token === token) {
        await storageRemove(storageArea, [TRANSIENT_SCREENSHOT_KEY]).catch(() => {});
    }
}

async function consumePendingScreenshot(token) {
    if (!token) return;
    deletePendingCapture(token);

    const pendingWrite = pendingFallbackWrites.get(token);
    if (pendingWrite) {
        pendingFallbackWrites.delete(token);
        await pendingWrite.promise.catch(() => {});
    }

    const storageAreas = [];
    if (chrome.storage && chrome.storage.session) storageAreas.push(chrome.storage.session);
    storageAreas.push(chrome.storage.local);

    await Promise.all(storageAreas.map((storageArea) => removeTransientScreenshotIfMatches(storageArea, token)));
    await storageRemove(chrome.storage.local, [LEGACY_SCREENSHOT_KEY]).catch(() => {});
}

async function captureVisibleAndOpenEditor(tab) {
    if (!tab || !Number.isInteger(tab.windowId)) return;
    try {
        const screenshot = await captureVisibleTab(tab.windowId);
        await openEditorWithScreenshot(screenshot);
    } catch (error) {
        console.error('Visible capture failed:', error);
    }
}

async function captureTabForClipboard(windowId) {
    const screenshotDataUrl = await captureVisibleTab(windowId);
    const result = await storageGet(chrome.storage.local, ['savedState']);
    return { screenshotDataUrl, settings: result.savedState || null };
}

// Crop a visible-tab screenshot to a user-selected region. The selection is in CSS pixels
// from the overlay; the screenshot is at device pixel resolution, so we scale by the
// viewport ratio captured at selection time.
function clampInt(value, min, max) { return Math.min(max, Math.max(min, value)); }

async function offscreenBitmapToPngDataUrl(bitmap) {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
    }
    return 'data:image/png;base64,' + btoa(binary);
}

async function cropScreenshotToSelection(screenshotDataUrl, selection) {
    if (!selection) return screenshotDataUrl;
    const response = await fetch(screenshotDataUrl);
    const blob = await response.blob();
    const full = await createImageBitmap(blob);
    try {
        const scaleX = full.width / Math.max(1, selection.viewportWidth || full.width);
        const scaleY = full.height / Math.max(1, selection.viewportHeight || full.height);
        const sx = clampInt(Math.round(selection.x * scaleX), 0, full.width - 1);
        const sy = clampInt(Math.round(selection.y * scaleY), 0, full.height - 1);
        const sw = clampInt(Math.round(selection.width * scaleX), 1, full.width - sx);
        const sh = clampInt(Math.round(selection.height * scaleY), 1, full.height - sy);
        const cropped = await createImageBitmap(full, sx, sy, sw, sh);
        try {
            return await offscreenBitmapToPngDataUrl(cropped);
        } finally {
            cropped.close();
        }
    } finally {
        full.close();
    }
}

self.fsBackgroundShared = {
    COMMAND_CAPTURE_SELECTION,
    readPendingBatch,
    readPendingCapture,
    consumePendingScreenshot,
    openCollageWithImages,
    openEditorWithScreenshot,
    captureVisibleAndOpenEditor,
    captureVisibleTab,
    captureTabForClipboard,
    cropScreenshotToSelection,
    getActiveTab,
    createTab
};
