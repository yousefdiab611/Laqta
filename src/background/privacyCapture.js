(function () {
    'use strict';

    function markSensitiveElements() {
        const marker = 'data-framedshot-private';
        const styleId = 'framedshot-private-style';
        const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
        const phone = /(?:\+?\d[\d\s().-]{6,}\d)/;
        const secret = /(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+/i;
        const card = /\b(?:\d[ -]*?){13,19}\b/;
        const sensitive = (text) => email.test(text) || phone.test(text) || secret.test(text) || card.test(text);
        const targets = new Set();
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

        while (walker.nextNode()) {
            const textNode = walker.currentNode;
            const parent = textNode.parentElement;
            if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) continue;
            if (sensitive(textNode.textContent || '')) targets.add(parent);
        }

        document.querySelectorAll('input, textarea').forEach((field) => {
            if (sensitive(field.value || '')) targets.add(field);
        });
        targets.forEach((element) => element.setAttribute(marker, ''));

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `[${marker}] { filter: blur(7px) !important; user-select: none !important; }`;
        document.documentElement.appendChild(style);
        return targets.size;
    }

    function restoreSensitiveElements() {
        document.getElementById('framedshot-private-style')?.remove();
        document.querySelectorAll('[data-framedshot-private]').forEach((element) => {
            element.removeAttribute('data-framedshot-private');
        });
    }

    function inject(tabId, func) {
        return chrome.scripting.executeScript({ target: { tabId }, func });
    }

    async function capturePrivateTab(tab) {
        if (!Number.isInteger(tab.id) || !Number.isInteger(tab.windowId)) {
            throw new Error('The active tab cannot be captured.');
        }

        const injection = await inject(tab.id, markSensitiveElements);
        const hiddenCount = injection[0]?.result || 0;
        try {
            await new Promise((resolve) => setTimeout(resolve, 120));
            const screenshot = await self.fsBackgroundShared.captureVisibleTab(tab.windowId);
            await self.fsBackgroundShared.openEditorWithScreenshot(screenshot);
        } finally {
            await inject(tab.id, restoreSensitiveElements);
        }
        return { hiddenCount };
    }

    self.fsPrivacyCapture = { capturePrivateTab };
}());
