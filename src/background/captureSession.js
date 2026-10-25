// Capture Steps session state + toolbar badge. Extracted from background.js to keep the service
// worker's message router under the 300-line file limit. Classic-worker module: self.fsCaptureSession.
(function () {
    'use strict';

    const CAPTURE_SESSION_KEY = 'captureSession';
    const CAPTURE_SESSION_MAX_FRAMES = 8;
    const CAPTURE_SESSION_BADGE_COLOR = '#ffbf00';

    async function readCaptureSession() {
        return new Promise((resolve) => {
            try {
                chrome.storage.session.get([CAPTURE_SESSION_KEY], (result) => {
                    resolve(result && result[CAPTURE_SESSION_KEY] ? result[CAPTURE_SESSION_KEY] : null);
                });
            } catch {
                resolve(null);
            }
        });
    }

    async function writeCaptureSession(session) {
        return new Promise((resolve) => {
            try {
                if (session === null) {
                    chrome.storage.session.remove([CAPTURE_SESSION_KEY], () => resolve());
                } else {
                    chrome.storage.session.set({ [CAPTURE_SESSION_KEY]: session }, () => resolve());
                }
            } catch {
                resolve();
            }
        });
    }

    async function appendCaptureToSession(existing, dataUrl) {
        const frames = Array.isArray(existing && existing.dataUrls) ? existing.dataUrls.slice() : [];
        frames.push(await addStepNumber(dataUrl, frames.length + 1));
        const next = Object.assign({}, existing || { active: true }, { active: true, dataUrls: frames });
        await writeCaptureSession(next);
        return frames.length;
    }

    function blobToDataUrl(blob) {
        return blob.arrayBuffer().then((buffer) => {
            const bytes = new Uint8Array(buffer);
            let binary = '';
            for (let offset = 0; offset < bytes.length; offset += 8192) {
                binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
            }
            return `data:${blob.type};base64,${btoa(binary)}`;
        });
    }

    async function addStepNumber(dataUrl, stepNumber) {
        const imageBlob = await fetch(dataUrl).then((response) => response.blob());
        const bitmap = await createImageBitmap(imageBlob);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d');
        const diameter = Math.max(42, Math.round(Math.min(bitmap.width, bitmap.height) * 0.09));
        const center = diameter * 0.72;

        context.drawImage(bitmap, 0, 0);
        context.fillStyle = '#ffbf00';
        context.beginPath();
        context.arc(center, center, diameter / 2, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = '#241900';
        context.font = `700 ${Math.round(diameter * 0.52)}px system-ui`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(String(stepNumber), center, center);
        bitmap.close();

        const numberedBlob = await canvas.convertToBlob({ type: 'image/png' });
        return blobToDataUrl(numberedBlob);
    }

    function setCaptureSessionBadge(count) {
        try {
            chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
            chrome.action.setBadgeBackgroundColor({ color: CAPTURE_SESSION_BADGE_COLOR });
        } catch {
            // Badge updates should never break capture flow.
        }
    }

    function clearCaptureSessionBadge() {
        try {
            chrome.action.setBadgeText({ text: '' });
        } catch {
            // No-op on environments without action API.
        }
    }

    // Watch session storage so any cancel/finish/remove path keeps the badge in sync,
    // no matter which surface (popup, background, keyboard shortcut) made the change.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'session' || !changes[CAPTURE_SESSION_KEY]) return;
        const next = changes[CAPTURE_SESSION_KEY].newValue;
        if (!next || !next.active) {
            clearCaptureSessionBadge();
            return;
        }
        const count = Array.isArray(next.dataUrls) ? next.dataUrls.length : 0;
        setCaptureSessionBadge(count);
    });

    self.fsCaptureSession = {
        CAPTURE_SESSION_MAX_FRAMES,
        readCaptureSession,
        writeCaptureSession,
        appendCaptureToSession
    };
})();
