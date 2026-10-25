function clampInt(value, min, max) { return Math.min(max, Math.max(min, value)); }

async function cropAndRenderToDataUrl(screenshotDataUrl, selection, settings) {
    const response = await fetch(screenshotDataUrl);
    const blob = await response.blob();
    const fullBitmap = await createImageBitmap(blob);

    let srcBitmap;
    if (selection) {
        const scaleX = fullBitmap.width / Math.max(1, selection.viewportWidth || fullBitmap.width);
        const scaleY = fullBitmap.height / Math.max(1, selection.viewportHeight || fullBitmap.height);
        const sx = clampInt(Math.round(selection.x * scaleX), 0, fullBitmap.width - 1);
        const sy = clampInt(Math.round(selection.y * scaleY), 0, fullBitmap.height - 1);
        const sw = clampInt(Math.round(selection.width * scaleX), 1, fullBitmap.width - sx);
        const sh = clampInt(Math.round(selection.height * scaleY), 1, fullBitmap.height - sy);
        srcBitmap = await createImageBitmap(fullBitmap, sx, sy, sw, sh);
        fullBitmap.close();
    } else {
        srcBitmap = fullBitmap;
    }

    const outputCanvas = new OffscreenCanvas(1, 1);
    drawStyledToOffscreenCanvas(outputCanvas, srcBitmap, settings);
    srcBitmap.close();

    const outputBlob = await outputCanvas.convertToBlob({ type: 'image/png' });
    const arrayBuffer = await outputBlob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    return 'data:image/png;base64,' + btoa(binary);
}

async function writeImageToClipboardViaTab(tabId, dataUrl) {
    const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: async (url) => {
            try {
                const r = await fetch(url);
                const b = await r.blob();
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]);
                return { ok: true };
            } catch (err) {
                return { ok: false, error: err && err.message ? err.message : 'Unknown' };
            }
        },
        args: [dataUrl]
    });
    const result = results && results[0] && results[0].result;
    if (!result || !result.ok) throw new Error((result && result.error) || 'Clipboard write failed');
}

function parseAspectRatioSelectionBg(value, customWidth, customHeight) {
    if (!value || value === 'auto') return { mode: 'auto' };
    if (value === 'custom') {
        const w = parseInt(customWidth, 10);
        const h = parseInt(customHeight, 10);
        return { mode: 'fixed', width: (Number.isFinite(w) && w > 0) ? w : 1080, height: (Number.isFinite(h) && h > 0) ? h : 1080 };
    }
    if (value.startsWith('preset:')) {
        const parts = value.slice('preset:'.length).split('x').map(Number);
        if (Number.isFinite(parts[0]) && Number.isFinite(parts[1]) && parts[0] > 0 && parts[1] > 0) {
            return { mode: 'fixed', width: parts[0], height: parts[1] };
        }
        return { mode: 'auto' };
    }
    const ratio = parseFloat(value);
    if (Number.isFinite(ratio) && ratio > 0) return { mode: 'ratio', ratio };
    return { mode: 'auto' };
}

function roundRectPathBg(ctx, x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// Mirrors drawStyledToCanvas in popup.js — accepts ImageBitmap instead of HTMLImageElement.
function drawStyledToOffscreenCanvas(canvas, bitmap, settings) {
    const s = settings || {};

    function posInt(v, fb) { const n = parseInt(v, 10); return (Number.isFinite(n) && n >= 0) ? n : fb; }
    function posIntPos(v, fb) { const n = parseInt(v, 10); return (Number.isFinite(n) && n > 0) ? n : fb; }
    function validHex(v, fb) { return /^#[0-9a-fA-F]{6}$/.test(String(v || '').trim()) ? v : fb; }
    function clampUnitVal(v, fb) { const n = parseFloat(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fb; }

    const scale     = posIntPos(s.exportScale, 1);
    const p         = posInt(s.padding, 20);
    const r         = posInt(s.radius, 16);
    const frameR    = posInt(s.frameRadius, 0);
    const shadow    = posInt(s.shadow, 28);
    const imageSize = posIntPos(s.imageSize, 100);
    const fitMode   = s.fitMode === 'cover' ? 'cover' : 'contain';
    const focusX    = clampUnitVal(s.focusX, 0.5);
    const focusY    = clampUnitVal(s.focusY, 0.5);
    const gStart    = validHex(s.gradientStart, '#ffbf00');
    const gEnd      = validHex(s.gradientEnd, '#06b6d4');
    const gStyle    = s.gradientStyle === 'radial' ? 'radial' : 'linear';
    const bgType    = s.bgType === 'solid' ? 'solid' : 'gradient';
    const angle     = Number.isFinite(parseInt(s.angle, 10)) ? parseInt(s.angle, 10) : 135;
    const aspect    = parseAspectRatioSelectionBg(s.aspectRatio, s.customWidth, s.customHeight);

    const naturalW = bitmap.width;
    const naturalH = bitmap.height;
    const frame = (s.browserFrame === 'mac' || s.browserFrame === 'windows') ? s.browserFrame : 'none';
    const barH = browserBarHeight(frame, naturalW);
    // The bar is laid out as part of the image so every fit mode sizes bar + image together.
    const layoutH = naturalH + barH;

    let canvasW, canvasH;
    if (aspect.mode === 'fixed') {
        canvasW = aspect.width;
        canvasH = aspect.height;
    } else {
        canvasW = naturalW + (p * 2);
        canvasH = layoutH + (p * 2);
        if (aspect.mode === 'ratio') {
            const currentRatio = canvasW / canvasH;
            if (currentRatio > aspect.ratio) canvasH = canvasW / aspect.ratio;
            else canvasW = canvasH * aspect.ratio;
        }
    }

    const availableW   = Math.max(1, canvasW - (p * 2));
    const availableH   = Math.max(1, canvasH - (p * 2));
    const containScale = Math.min(availableW / naturalW, availableH / layoutH);
    const coverScale   = Math.max(availableW / naturalW, availableH / layoutH);

    let viewportX, viewportY, viewportW, viewportH, drawImgX, drawImgY, drawImgW, drawImgH;

    if (aspect.mode === 'auto') {
        drawImgW = naturalW; drawImgH = layoutH;
        viewportW = drawImgW; viewportH = drawImgH;
        viewportX = (canvasW - viewportW) / 2; viewportY = (canvasH - viewportH) / 2;
        drawImgX = viewportX; drawImgY = viewportY;
    } else {
        const baseFitScale   = fitMode === 'cover' ? coverScale : containScale;
        const imageSizeScale = imageSize / 100;
        drawImgW = naturalW * baseFitScale * imageSizeScale;
        drawImgH = layoutH * baseFitScale * imageSizeScale;
        if (fitMode === 'cover') {
            viewportX = p; viewportY = p; viewportW = availableW; viewportH = availableH;
            const overflowX = Math.max(0, drawImgW - viewportW);
            const overflowY = Math.max(0, drawImgH - viewportH);
            drawImgX = viewportX - (overflowX * focusX);
            drawImgY = viewportY - (overflowY * focusY);
            if (drawImgW <= viewportW) drawImgX = viewportX + ((viewportW - drawImgW) / 2);
            if (drawImgH <= viewportH) drawImgY = viewportY + ((viewportH - drawImgH) / 2);
        } else {
            viewportW = drawImgW; viewportH = drawImgH;
            viewportX = p + ((availableW - viewportW) / 2);
            viewportY = p + ((availableH - viewportH) / 2);
            drawImgX = viewportX; drawImgY = viewportY;
        }
    }

    // Defensive cap (8000 = UI max): savedState is normally clamped via snapshotState, but a
    // legacy/tampered dimension reaching this worker renderer would OOM the OffscreenCanvas.
    canvas.width  = Math.max(1, Math.min(8000, Math.round(canvasW * scale)));
    canvas.height = Math.max(1, Math.min(8000, Math.round(canvasH * scale)));

    const ctx = canvas.getContext('2d');
    const cW = canvas.width;
    const cH = canvas.height;

    viewportX *= scale; viewportY *= scale; viewportW *= scale; viewportH *= scale;
    drawImgX  *= scale; drawImgY  *= scale; drawImgW  *= scale; drawImgH  *= scale;

    const scaledFrameR = Math.max(0, frameR * scale);
    const cornerRadius = r * scale;

    if (scaledFrameR > 0) { ctx.save(); roundRectPathBg(ctx, 0, 0, cW, cH, scaledFrameR); ctx.clip(); }

    if (bgType === 'solid') {
        ctx.fillStyle = gStart;
        ctx.fillRect(0, 0, cW, cH);
    } else {
        let grad;
        if (gStyle === 'radial') {
            const maxDim = Math.max(cW, cH);
            grad = ctx.createRadialGradient(cW / 2, cH / 2, 0, cW / 2, cH / 2, maxDim * 0.75);
        } else {
            const angleRad = (angle - 90) * Math.PI / 180;
            const cx = cW / 2, cy = cH / 2;
            const len = Math.sqrt(cW * cW + cH * cH) / 2;
            grad = ctx.createLinearGradient(
                cx - Math.cos(angleRad) * len, cy - Math.sin(angleRad) * len,
                cx + Math.cos(angleRad) * len, cy + Math.sin(angleRad) * len
            );
        }
        grad.addColorStop(0, gStart);
        grad.addColorStop(1, gEnd);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, cW, cH);
    }

    ctx.save();
    ctx.shadowColor   = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur    = shadow * 2.5 * scale;
    ctx.shadowOffsetY = shadow * 1.2 * scale;
    ctx.fillStyle     = '#000';
    roundRectPathBg(ctx, viewportX, viewportY, viewportW, viewportH, cornerRadius);
    ctx.fill();
    ctx.restore();

    const barDrawH = barH * (drawImgW / naturalW);
    ctx.save();
    roundRectPathBg(ctx, viewportX, viewportY, viewportW, viewportH, cornerRadius);
    ctx.clip();
    ctx.drawImage(bitmap, drawImgX, drawImgY + barDrawH, drawImgW, drawImgH - barDrawH);
    if (barDrawH > 0) drawBrowserChrome(ctx, viewportX, viewportY, viewportW, barDrawH, frame);
    ctx.restore();

    if (scaledFrameR > 0) ctx.restore();
}

// Bar height in source-image pixels so it scales with the screenshot; 28px floor keeps small captures legible.
function browserBarHeight(frame, naturalW) {
    return frame === 'none' ? 0 : Math.max(28, Math.round(naturalW * 0.04));
}

function drawBrowserChrome(ctx, x, y, w, h, frame) {
    const cy = y + (h / 2);
    const pillH = h * 0.56;
    let pillX = x + (h * 0.5);
    let pillEnd = x + w - (h * 0.5);
    ctx.fillStyle = '#e8eaed';
    ctx.fillRect(x, y, w, h);
    if (frame === 'mac') {
        const r = h * 0.14;
        ['#ff5f57', '#febc2e', '#28c840'].forEach((color, i) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x + (h * 0.55) + (i * r * 2.7), cy, r, 0, Math.PI * 2);
            ctx.fill();
        });
        pillX = x + (h * 1.9);
    } else {
        const g = h * 0.2;
        let gx = x + w - (h * 0.6);
        ctx.strokeStyle = '#3c4043';
        ctx.lineWidth = Math.max(1, h * 0.035);
        ctx.beginPath();
        ctx.moveTo(gx - (g / 2), cy - (g / 2));
        ctx.lineTo(gx + (g / 2), cy + (g / 2));
        ctx.moveTo(gx + (g / 2), cy - (g / 2));
        ctx.lineTo(gx - (g / 2), cy + (g / 2));
        ctx.stroke();
        gx -= h * 0.7;
        ctx.strokeRect(gx - (g / 2), cy - (g / 2), g, g);
        gx -= h * 0.7;
        ctx.beginPath();
        ctx.moveTo(gx - (g / 2), cy);
        ctx.lineTo(gx + (g / 2), cy);
        ctx.stroke();
        pillEnd = gx - (g / 2) - (h * 0.45);
    }
    ctx.fillStyle = '#ffffff';
    roundRectPathBg(ctx, pillX, cy - (pillH / 2), Math.max(0, pillEnd - pillX), pillH, pillH / 2);
    ctx.fill();
}

self.fsQuickCopyCanvas = { cropAndRenderToDataUrl, writeImageToClipboardViaTab };
