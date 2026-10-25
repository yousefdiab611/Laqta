// Stitches per-viewport captures into one tall PNG (in the service worker via OffscreenCanvas) and
// hands the resulting Blob to the editor through a small IndexedDB store (a tall PNG exceeds the
// ~9MB runtime-message limit and the ~10MB chrome.storage quota, so the normal data-URL handoff
// can't carry it). Classic-worker module: exposes self.fsFullPageStitcher + self.fsFullPageStore.
(function () {
    'use strict';

    // Preserve full resolution. Chrome supports canvases up to ~32767px/side and ~268MP area, so we
    // only downscale pages that genuinely exceed that (otherwise a long retina page, whose device
    // height is 2x its CSS height, would be needlessly degraded). These are last-resort caps to keep
    // convertToBlob from hard-failing on enormous pages — most pages stay 1:1.
    const FULLPAGE_MAX_DIM = 32767;
    const FULLPAGE_MAX_AREA = 256 * 1000 * 1000; // ~256 megapixels (under Chrome's ~268MP ceiling)

    async function toBitmap(dataUrl) {
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        return createImageBitmap(blob);
    }

    // frames: [{ dataUrl, scrollY }] (scrollY in CSS px). geom: { viewportHeight, fullHeight }.
    // Geometry (device-px ratio, strip width) is derived from the FIRST decoded capture so browser
    // zoom / devicePixelRatio drift can't squish or misalign the result.
    async function stitch(frames, geom) {
        if (!frames || !frames.length) throw new Error('No frames to stitch.');
        const viewportHeight = Math.max(1, geom.viewportHeight);
        const fullHeight = Math.max(viewportHeight, geom.fullHeight);

        const first = await toBitmap(frames[0].dataUrl);
        const pxRatio = first.height / viewportHeight; // device px per CSS px
        const stitchWidth = first.width;
        const stitchHeight = Math.max(first.height, Math.round(fullHeight * pxRatio));

        let scale = 1;
        const maxDim = Math.max(stitchWidth, stitchHeight);
        if (maxDim > FULLPAGE_MAX_DIM) scale = FULLPAGE_MAX_DIM / maxDim;
        if (stitchWidth * stitchHeight * scale * scale > FULLPAGE_MAX_AREA) {
            scale *= Math.sqrt(FULLPAGE_MAX_AREA / (stitchWidth * stitchHeight * scale * scale));
        }
        const wasDownscaled = scale < 1;
        const outW = Math.max(1, Math.round(stitchWidth * scale));
        const outH = Math.max(1, Math.round(stitchHeight * scale));

        const canvas = new OffscreenCanvas(outW, outH);
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, outW, outH);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        function drawStrip(bitmap, scrollY) {
            const dy = Math.round(scrollY * pxRatio * scale);
            ctx.drawImage(
                bitmap, 0, 0, bitmap.width, bitmap.height,
                0, dy, Math.round(bitmap.width * scale), Math.round(bitmap.height * scale)
            );
        }

        drawStrip(first, frames[0].scrollY);
        first.close();
        for (let i = 1; i < frames.length; i++) {
            const bitmap = await toBitmap(frames[i].dataUrl);
            try {
                drawStrip(bitmap, frames[i].scrollY);
            } finally {
                bitmap.close();
            }
        }

        const blob = await canvas.convertToBlob({ type: 'image/png' });
        return { blob, wasDownscaled };
    }

    // --- IndexedDB handoff store (writer side) ------------------------------
    // Editor reads via the matching ESM module src/lib/fullPageStore.js — keep these constants
    // identical there.
    const DB_NAME = 'framedshot-fullpage';
    const DB_VERSION = 1;
    const STORE = 'images';
    const FULLPAGE_TTL_MS = 10 * 60 * 1000;

    function openDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE, { keyPath: 'token' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('Failed to open full-page store.'));
        });
    }

    function runWrite(mutate) {
        return openDb().then((db) => new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            mutate(tx.objectStore(STORE));
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); reject(tx.error || new Error('Full-page store write failed.')); };
            tx.onabort = () => { db.close(); reject(tx.error || new Error('Full-page store write aborted.')); };
        }));
    }

    async function putFullPage(token, blob) {
        await runWrite((store) => store.put({ token, blob, ts: Date.now() }));
    }

    async function deleteFullPage(token) {
        await runWrite((store) => store.delete(token)).catch(() => {});
    }

    async function sweepOldFullPage(now) {
        const cutoff = (now || Date.now()) - FULLPAGE_TTL_MS;
        await runWrite((store) => {
            const req = store.openCursor();
            req.onsuccess = () => {
                const cursor = req.result;
                if (!cursor) return;
                const value = cursor.value;
                if (!value || typeof value.ts !== 'number' || value.ts < cutoff) cursor.delete();
                cursor.continue();
            };
        }).catch(() => {});
    }

    self.fsFullPageStitcher = { stitch, FULLPAGE_MAX_DIM };
    self.fsFullPageStore = { putFullPage, deleteFullPage, sweepOldFullPage };
})();
