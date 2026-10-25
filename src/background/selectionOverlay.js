// Keep in sync with popup/popup.js (different runtimes, no shared module possible).
const NON_SCRIPTABLE_URL_PREFIXES = [
    'chrome://',
    'chrome-extension://',
    'edge://',
    'about:',
    'view-source:',
    'https://chromewebstore.google.com'
];

function isScriptableTab(tab) {
    if (typeof tab.url !== 'string') return true;
    return !NON_SCRIPTABLE_URL_PREFIXES.some((prefix) => tab.url.startsWith(prefix));
}

async function executeScript(tabId, func, args) {
    return new Promise((resolve, reject) => {
        chrome.scripting.executeScript(
            {
                target: { tabId },
                func,
                args: args || []
            },
            (results) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(results || []);
            }
        );
    });
}

async function requestAreaSelection(tabId) {
    const results = await executeScript(tabId, () => {
        return new Promise((resolve) => {
            const overlayId = 'framedshot-selection-overlay';
            const existing = document.getElementById(overlayId);
            if (existing) existing.remove();

            const overlay = document.createElement('div');
            const box = document.createElement('div');
            const hint = document.createElement('div');

            overlay.id = overlayId;
            overlay.style.position = 'fixed';
            overlay.style.inset = '0';
            overlay.style.zIndex = '2147483647';
            overlay.style.background = 'rgba(8, 10, 18, 0.24)';
            overlay.style.cursor = 'crosshair';
            overlay.style.userSelect = 'none';
            overlay.style.webkitUserSelect = 'none';
            overlay.style.touchAction = 'none';

            box.style.position = 'fixed';
            box.style.border = '2px solid #ffbf00';
            box.style.background = 'rgba(255, 191, 0, 0.12)';
            box.style.boxShadow = '0 0 0 1px rgba(255, 255, 255, 0.22), 0 18px 40px rgba(0, 0, 0, 0.28)';
            box.style.borderRadius = '12px';
            box.style.display = 'none';

            hint.textContent = 'Drag to select an area. Esc to cancel.';
            hint.style.position = 'fixed';
            hint.style.top = '18px';
            hint.style.left = '50%';
            hint.style.transform = 'translateX(-50%)';
            hint.style.padding = '10px 14px';
            hint.style.borderRadius = '999px';
            hint.style.background = 'rgba(15, 17, 25, 0.92)';
            hint.style.border = '1px solid rgba(255, 255, 255, 0.16)';
            hint.style.color = '#F5F7FF';
            hint.style.font = '600 13px/1 -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif';
            hint.style.letterSpacing = '0.01em';
            hint.style.pointerEvents = 'none';

            overlay.appendChild(box);
            overlay.appendChild(hint);
            document.documentElement.appendChild(overlay);

            let dragStartX = 0;
            let dragStartY = 0;
            let pointerId = null;
            let isDragging = false;
            let didResolve = false;

            function resolveAfterPaint(result) {
                if (didResolve) return;
                didResolve = true;
                document.removeEventListener('keydown', handleKeyDown, true);
                if (overlay.parentNode) overlay.remove();
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        resolve(result || null);
                    });
                });
            }

            function updateBox(clientX, clientY) {
                const left = Math.min(dragStartX, clientX);
                const top = Math.min(dragStartY, clientY);
                const width = Math.abs(clientX - dragStartX);
                const height = Math.abs(clientY - dragStartY);

                box.style.display = 'block';
                box.style.left = `${left}px`;
                box.style.top = `${top}px`;
                box.style.width = `${width}px`;
                box.style.height = `${height}px`;
            }

            function finishSelection(clientX, clientY) {
                const left = Math.min(dragStartX, clientX);
                const top = Math.min(dragStartY, clientY);
                const width = Math.abs(clientX - dragStartX);
                const height = Math.abs(clientY - dragStartY);

                if (width < 12 || height < 12) {
                    resolveAfterPaint(null);
                    return;
                }

                resolveAfterPaint({
                    x: left,
                    y: top,
                    width,
                    height,
                    viewportWidth: window.innerWidth,
                    viewportHeight: window.innerHeight
                });
            }

            function handlePointerDown(event) {
                if (event.button !== 0) return;
                isDragging = true;
                pointerId = event.pointerId;
                dragStartX = event.clientX;
                dragStartY = event.clientY;
                overlay.setPointerCapture(pointerId);
                updateBox(event.clientX, event.clientY);
                event.preventDefault();
            }

            function handlePointerMove(event) {
                if (!isDragging || event.pointerId !== pointerId) return;
                updateBox(event.clientX, event.clientY);
                event.preventDefault();
            }

            function handlePointerUp(event) {
                if (!isDragging || event.pointerId !== pointerId) return;
                isDragging = false;
                if (overlay.hasPointerCapture(pointerId)) overlay.releasePointerCapture(pointerId);
                finishSelection(event.clientX, event.clientY);
                event.preventDefault();
            }

            function handlePointerCancel(event) {
                if (!isDragging || event.pointerId !== pointerId) return;
                isDragging = false;
                if (overlay.hasPointerCapture(pointerId)) overlay.releasePointerCapture(pointerId);
                resolveAfterPaint(null);
            }

            function handleKeyDown(event) {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                resolveAfterPaint(null);
            }

            overlay.addEventListener('pointerdown', handlePointerDown);
            overlay.addEventListener('pointermove', handlePointerMove);
            overlay.addEventListener('pointerup', handlePointerUp);
            overlay.addEventListener('pointercancel', handlePointerCancel);
            document.addEventListener('keydown', handleKeyDown, true);
        });
    });

    return results[0] && results[0].result ? results[0].result : null;
}

self.fsSelectionOverlay = {
    isScriptableTab,
    requestAreaSelection
};
