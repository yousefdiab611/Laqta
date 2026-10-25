(function () {
    'use strict';
    const link = document.createElement('button');
    link.type = 'button';
    link.textContent = 'Open in Creative Studio ↗';
    link.style.cssText =
        'width:100%;padding:10px 12px;min-height:44px;background:#fff8ef;color:#222;border:1px solid #d5cbbf;border-radius:10px;font:600 13px system-ui;cursor:pointer';
    link.addEventListener('click', async () => {
        link.disabled = true;
        try {
            const candidates = Array.from(document.querySelectorAll('canvas')).filter(
                (canvas) => canvas.width && canvas.height,
            );
            const preview = candidates.sort(
                (first, second) => second.width * second.height - first.width * first.height,
            )[0];
            if (preview) await chrome.storage.local.set({ studioCapture: preview.toDataURL('image/png') });
            await chrome.tabs.create({ url: chrome.runtime.getURL('studio/index.html') });
        } catch {
            link.textContent = 'Could not transfer. Save image, then upload to Studio.';
        } finally {
            link.disabled = false;
        }
    });
    function attachToExportTools() {
        if (link.isConnected) return;
        const download = Array.from(document.querySelectorAll('aside button')).find(
            (control) => control.textContent.trim() === 'Download',
        );
        if (download) download.parentElement.parentElement.append(link);
    }
    // The editor is a compiled React app; its export controls mount after this script.
    new MutationObserver(attachToExportTools).observe(document.getElementById('root'), {
        childList: true,
        subtree: true,
    });
    attachToExportTools();
})();
