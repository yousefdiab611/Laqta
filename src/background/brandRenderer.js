(function () {
    'use strict';

    const STORAGE_KEY = 'brandKit';

    function storedBrandKit() {
        return new Promise((resolve) => {
            chrome.storage.local.get([STORAGE_KEY], (stored) => resolve(stored[STORAGE_KEY] || null));
        });
    }

    async function bitmapFromDataUrl(dataUrl) {
        const imageBlob = await fetch(dataUrl).then((response) => response.blob());
        return createImageBitmap(imageBlob);
    }

    function anchorPosition(canvas, width, height, settings) {
        const margin = Math.max(18, Math.round(canvas.width * 0.02));
        const right = settings.position?.includes('right');
        const bottom = settings.position?.includes('bottom');
        return {
            x: right ? canvas.width - width - margin : margin,
            y: bottom ? canvas.height - height - margin : margin,
            margin
        };
    }

    function drawBrandText(context, canvas, settings) {
        if (!settings.text) return;
        const fontSize = Math.max(18, Math.round(canvas.width * 0.018));
        context.font = `700 ${fontSize}px system-ui`;
        const width = context.measureText(settings.text).width;
        const anchor = anchorPosition(canvas, width, fontSize, settings);
        context.globalAlpha = settings.opacity;
        context.fillStyle = '#fff';
        context.shadowColor = 'rgba(0,0,0,.75)';
        context.shadowBlur = 5;
        context.textBaseline = 'top';
        context.fillText(settings.text, anchor.x, anchor.y);
    }

    async function drawBrandLogo(context, canvas, settings) {
        if (!settings.logoDataUrl) return;
        const logo = await bitmapFromDataUrl(settings.logoDataUrl);
        const width = Math.round(canvas.width * settings.size / 100);
        const height = Math.round(width * logo.height / logo.width);
        const anchor = anchorPosition(canvas, width, height, settings);
        context.globalAlpha = settings.opacity;
        context.drawImage(logo, anchor.x, anchor.y, width, height);
        logo.close();
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

    async function applyBrandKit(dataUrl) {
        await self.fsPersonalBrandKitReady;
        const settings = await storedBrandKit();
        if (!settings?.enabled || (!settings.logoDataUrl && !settings.text)) return dataUrl;
        const screenshot = await bitmapFromDataUrl(dataUrl);
        const canvas = new OffscreenCanvas(screenshot.width, screenshot.height);
        const context = canvas.getContext('2d');
        context.drawImage(screenshot, 0, 0);
        screenshot.close();
        context.save();
        if (settings.logoDataUrl) await drawBrandLogo(context, canvas, settings);
        else drawBrandText(context, canvas, settings);
        context.restore();
        return blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
    }

    self.fsBrandRenderer = { applyBrandKit };
}());
