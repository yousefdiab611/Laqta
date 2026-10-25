// Full-page (scrolling) screenshot orchestration. The service worker drives a scroll loop:
// inject "measure & prepare", then for each viewport inject a scroll step, settle, and capture the
// visible tab (reusing the throttled captureVisibleTab). The strips are stitched offscreen into one
// tall PNG and handed to the editor via IndexedDB. Classic-worker module: self.fsFullPageCapture.
(function () {
    'use strict';

    const bg = self.fsBackgroundShared;
    const sel = self.fsSelectionOverlay;
    const stitcher = self.fsFullPageStitcher;
    const store = self.fsFullPageStore;

    // Settle after each scroll BEFORE hiding the overlay + capturing. Sized to cover the
    // captureVisibleTab throttle gap (~550ms) so the capture itself is near-instant — the progress
    // overlay then stays visible for almost the whole run and is hidden only for the capture frame.
    // Also gives lazy content time to paint.
    const SETTLE_MS = 600;

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function createToken() {
        if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
            return globalThis.crypto.randomUUID();
        }
        return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    function runStep(tabId, func, args) {
        return new Promise((resolve, reject) => {
            chrome.scripting.executeScript({ target: { tabId }, func, args: args || [] }, (results) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(results && results[0] ? results[0].result : null);
            });
        });
    }

    // --- Injected page functions (must be self-contained; no outer references) ---

    function measureAndPrepareFn() {
        if (window.__framedshotFullPageActive) return { busy: true };
        window.__framedshotFullPageActive = true;
        const STYLE_ID = 'framedshot-fullpage-style';
        if (!document.getElementById(STYLE_ID)) {
            const style = document.createElement('style');
            style.id = STYLE_ID;
            // Hide scrollbars without blocking programmatic scroll, and force instant scrolling.
            style.textContent = '::-webkit-scrollbar{width:0!important;height:0!important;display:none!important}html{scrollbar-width:none!important;scroll-behavior:auto!important}';
            (document.head || document.documentElement).appendChild(style);
        }
        const doc = document.documentElement;
        const body = document.body;
        const fullHeight = Math.max(doc.scrollHeight, body ? body.scrollHeight : 0, doc.offsetHeight, doc.clientHeight);
        const fullWidth = Math.max(doc.scrollWidth, body ? body.scrollWidth : 0, doc.offsetWidth, doc.clientWidth);
        return {
            busy: false,
            fullHeight,
            fullWidth,
            viewportWidth: doc.clientWidth,
            viewportHeight: doc.clientHeight,
            devicePixelRatio: window.devicePixelRatio || 1,
            originalScrollX: window.scrollX,
            originalScrollY: window.scrollY
        };
    }

    function scrollStepFn(targetY, frameIndex, totalFrames) {
        window.scrollTo(0, targetY);

        const OVERLAY_ID = 'framedshot-fullpage-progress';

        // Hide fixed/sticky elements after the top frame so headers/footers don't repeat in every
        // strip. visibility:hidden avoids reflow (so the measured page height stays stable).
        // Best-effort: done once on the first non-top frame. Never touch our own overlay.
        if (frameIndex === 1) {
            try {
                const all = document.body ? document.body.getElementsByTagName('*') : [];
                const limit = Math.min(all.length, 4000);
                for (let i = 0; i < limit; i++) {
                    const el = all[i];
                    if (el.id === OVERLAY_ID || el.hasAttribute('data-framedshot-fp')) continue;
                    const pos = getComputedStyle(el).position;
                    if (pos === 'fixed' || pos === 'sticky') {
                        el.setAttribute('data-framedshot-fp', el.style.visibility || '');
                        el.style.setProperty('visibility', 'hidden', 'important');
                    }
                }
            } catch { /* best-effort */ }
        }

        let overlay = document.getElementById(OVERLAY_ID);
        if (!overlay) {
            if (!document.getElementById('framedshot-fullpage-kf')) {
                const kf = document.createElement('style');
                kf.id = 'framedshot-fullpage-kf';
                kf.textContent = '@keyframes framedshot-fp-pulse{0%{opacity:1}50%{opacity:.3}100%{opacity:1}}';
                (document.head || document.documentElement).appendChild(kf);
            }
            overlay = document.createElement('div');
            overlay.id = OVERLAY_ID;
            overlay.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:9px;background:rgba(15,17,25,0.95);color:#fff;font:600 13px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;padding:11px 16px;border-radius:999px;border:1px solid rgba(255,191,0,0.55);pointer-events:none;box-shadow:0 14px 38px rgba(0,0,0,0.45)';
            const dot = document.createElement('span');
            dot.style.cssText = 'width:9px;height:9px;border-radius:50%;background:#ffbf00;animation:framedshot-fp-pulse 1s ease-in-out infinite';
            const label = document.createElement('span');
            label.id = 'framedshot-fullpage-label';
            overlay.appendChild(dot);
            overlay.appendChild(label);
            (document.body || document.documentElement).appendChild(overlay);
        }
        const label = document.getElementById('framedshot-fullpage-label');
        if (label) label.textContent = 'لقطة — Laqta is capturing the full page… ' + (frameIndex + 1) + ' / ' + totalFrames;
        overlay.style.display = 'flex';

        return { scrollY: window.scrollY };
    }

    function setOverlayHiddenFn(hidden) {
        const el = document.getElementById('framedshot-fullpage-progress');
        if (el) el.style.display = hidden ? 'none' : 'flex';
        return true;
    }

    function setOverlayMessageFn(message) {
        const label = document.getElementById('framedshot-fullpage-label');
        const el = document.getElementById('framedshot-fullpage-progress');
        if (label) label.textContent = message;
        if (el) el.style.display = 'flex';
        return true;
    }

    function cleanupFn(scrollX, scrollY) {
        try {
            const style = document.getElementById('framedshot-fullpage-style');
            if (style) style.remove();
            const kf = document.getElementById('framedshot-fullpage-kf');
            if (kf) kf.remove();
            const overlay = document.getElementById('framedshot-fullpage-progress');
            if (overlay) overlay.remove();
            const marked = document.querySelectorAll('[data-framedshot-fp]');
            for (let i = 0; i < marked.length; i++) {
                marked[i].style.visibility = marked[i].getAttribute('data-framedshot-fp') || '';
                marked[i].removeAttribute('data-framedshot-fp');
            }
            window.scrollTo(scrollX || 0, scrollY || 0);
        } catch { /* page may be gone */ }
        window.__framedshotFullPageActive = false;
        return true;
    }

    // --- Orchestrator -------------------------------------------------------

    async function captureFullPageAndOpenEditor(tab) {
        if (!tab || !Number.isInteger(tab.id) || !Number.isInteger(tab.windowId)) {
            throw new Error('No active tab to capture.');
        }
        if (!sel.isScriptableTab(tab)) {
            // Non-scriptable page (chrome://, web store, etc.): fall back to a single visible-tab
            // capture into the editor, same spirit as the area-selection fallback.
            const screenshot = await bg.captureVisibleTab(tab.windowId);
            await bg.openEditorWithScreenshot(screenshot, { notice: 'fullpage-fallback' });
            return { fallback: true, frameCount: 1 };
        }

        store.sweepOldFullPage(Date.now()).catch(() => {});

        const tabId = tab.id;
        let prepared = null;
        try {
            const prep = await runStep(tabId, measureAndPrepareFn);
            if (!prep) throw new Error('Could not measure the page.');
            if (prep.busy) throw new Error('A full-page capture is already running on this tab.');
            prepared = prep;

            const viewportHeight = Math.max(1, prep.viewportHeight);
            const fullHeight = Math.max(viewportHeight, prep.fullHeight);
            const maxScrollY = Math.max(0, fullHeight - viewportHeight);
            const totalFrames = Math.max(1, Math.ceil(fullHeight / viewportHeight));

            const frames = [];
            for (let i = 0; i < totalFrames; i++) {
                const targetY = Math.min(i * viewportHeight, maxScrollY);
                const step = await runStep(tabId, scrollStepFn, [targetY, i, totalFrames]);
                const actualScrollY = step && Number.isFinite(step.scrollY) ? step.scrollY : targetY;
                await sleep(SETTLE_MS);
                await runStep(tabId, setOverlayHiddenFn, [true]).catch(() => {});
                const dataUrl = await bg.captureVisibleTab(tab.windowId);
                frames.push({ dataUrl, scrollY: actualScrollY });
            }

            // Keep the user informed while stitching a large image + handing off to the editor.
            await runStep(tabId, setOverlayMessageFn, ['Finishing up…']).catch(() => {});

            const { blob, wasDownscaled } = await stitcher.stitch(frames, {
                viewportHeight,
                fullHeight
            });

            const token = createToken();
            await store.putFullPage(token, blob);

            const editorUrl = new URL('editor/index.html', chrome.runtime.getURL('/'));
            editorUrl.searchParams.set('capture', token);
            editorUrl.searchParams.set('fullpage', '1');
            if (wasDownscaled) editorUrl.searchParams.set('scaled', '1');
            await bg.createTab({ url: editorUrl.toString() });
            return { fallback: false, frameCount: totalFrames };
        } finally {
            if (prepared) {
                await runStep(tabId, cleanupFn, [prepared.originalScrollX, prepared.originalScrollY]).catch(() => {});
            }
        }
    }

    self.fsFullPageCapture = { captureFullPageAndOpenEditor };
})();
