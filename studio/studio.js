'use strict';

const element = (id) => document.getElementById(id);
const canvas = element('canvas');
const context = canvas.getContext('2d');
const images = [];
let selected = 0;
let rendering = Promise.resolve();
let renderVersion = 0;
let ocrBusy = false;

function notify(message) {
    element('status').textContent = message;
}

function loadImage(source) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Could not read this image. Choose PNG, JPEG or WebP.'));
        image.src = source;
    });
}

async function addImage(source, name) {
    if (images.length >= 12) throw new Error('Use up to 12 images per composition.');
    const image = await loadImage(source);
    if (image.width * image.height > 40000000) throw new Error('Image too large. Use an image under 40 megapixels.');
    images.push({ image, source, name, caption: '', arrow: false, arrowX: 65, arrowY: 35 });
    selected = images.length - 1;
    renderImageList();
    requestRender();
}

function button(label, action, disabled = false) {
    const control = document.createElement('button');
    control.type = 'button';
    control.textContent = label;
    control.disabled = disabled;
    control.addEventListener('click', action);
    return control;
}

function renderImageList() {
    const rows = images.map((item, index) => {
        const row = document.createElement('div');
        row.className = 'image-row' + (index === selected ? ' selected' : '');
        const top = document.createElement('div');
        top.className = 'image-top';
        const thumbnail = document.createElement('img');
        thumbnail.src = item.source;
        thumbnail.alt = '';
        const choose = button(index + 1 + '. ' + item.name, () => {
            selected = index;
            renderImageList();
            requestRender();
        });
        choose.setAttribute('aria-pressed', String(selected === index));
        top.append(thumbnail, choose);
        const caption = document.createElement('input');
        caption.placeholder = 'Describe this step';
        caption.maxLength = 120;
        caption.value = item.caption;
        caption.setAttribute('aria-label', 'Caption for image ' + (index + 1));
        caption.addEventListener('input', () => {
            item.caption = caption.value;
            requestRender();
        });
        const actions = document.createElement('div');
        actions.className = 'image-actions';
        function move(offset) {
            const target = index + offset;
            [images[index], images[target]] = [images[target], images[index]];
            selected = target;
            renderImageList();
            requestRender();
        }
        const arrow = button(item.arrow ? 'Arrow ✓' : 'Add arrow', () => {
            item.arrow = !item.arrow;
            renderImageList();
            requestRender();
        });
        arrow.setAttribute('aria-pressed', String(item.arrow));
        actions.append(
            button('Move up', () => move(-1), index === 0),
            button('Move down', () => move(1), index === images.length - 1),
            arrow,
            button('Remove', () => {
                URL.revokeObjectURL(item.source);
                images.splice(index, 1);
                selected = Math.max(0, Math.min(selected, images.length - 1));
                renderImageList();
                requestRender();
            }),
        );
        row.append(top, caption, actions);
        if (item.arrow) {
            ['X', 'Y'].forEach((axis) => {
                const label = document.createElement('label');
                label.textContent = 'Arrow target ' + axis + ' (%)';
                const input = document.createElement('input');
                input.type = 'range';
                input.min = '5';
                input.max = '95';
                input.value = item['arrow' + axis];
                input.addEventListener('input', () => {
                    item['arrow' + axis] = Number(input.value);
                    requestRender();
                });
                label.append(input);
                row.append(label);
            });
        }
        return row;
    });
    element('images').replaceChildren(...rows);
    element('ocr').disabled = !images.length || ocrBusy;
}

function fitImage(image, x, y, width, height) {
    const ratio = Math.min(width / image.width, height / image.height);
    context.drawImage(
        image,
        x + (width - image.width * ratio) / 2,
        y + (height - image.height * ratio) / 2,
        image.width * ratio,
        image.height * ratio,
    );
}

function drawText(text, x, y, maxWidth) {
    // Keep user copy inside its allocated box, including long unbroken strings.
    let fitted = text;
    while (fitted.length && context.measureText(fitted).width > maxWidth) fitted = fitted.slice(0, -1);
    context.fillText(fitted === text ? text : fitted.slice(0, -1) + '…', x, y);
}

function drawArrow(x, y, width, height, scale, item) {
    const endX = x + (width * item.arrowX) / 100;
    const endY = y + (height * item.arrowY) / 100;
    const startX = endX + (item.arrowX > 50 ? -1 : 1) * width * 0.22;
    const startY = endY + (item.arrowY > 50 ? -1 : 1) * height * 0.25;
    const angle = Math.atan2(endY - startY, endX - startX);
    context.save();
    context.strokeStyle = '#fa4925';
    context.fillStyle = '#fa4925';
    context.lineWidth = 5 * scale;
    context.beginPath();
    context.moveTo(startX, startY);
    context.lineTo(endX, endY);
    context.stroke();
    context.beginPath();
    context.moveTo(endX, endY);
    context.lineTo(endX - 20 * scale * Math.cos(angle - 0.5), endY - 20 * scale * Math.sin(angle - 0.5));
    context.lineTo(endX - 20 * scale * Math.cos(angle + 0.5), endY - 20 * scale * Math.sin(angle + 0.5));
    context.closePath();
    context.fill();
    context.restore();
}

async function applyWatermark() {
    if (!element('watermark').checked || !globalThis.chrome?.storage) return;
    const { brandKit } = await chrome.storage.local.get('brandKit');
    if (!brandKit?.enabled) return;
    const margin = canvas.width * 0.025;
    const width = (canvas.width * Math.min(40, Math.max(4, Number(brandKit.size) || 12))) / 100;
    let logo;
    if (brandKit.logoDataUrl) logo = await loadImage(brandKit.logoDataUrl);
    context.save();
    context.globalAlpha = Math.min(1, Math.max(0, brandKit.opacity ?? 0.85));
    context.font = '700 ' + Math.round(canvas.width * 0.02) + 'px system-ui';
    const actualWidth = logo
        ? Math.min(width, (canvas.height / 4) * logo.width / logo.height)
        : Math.min(context.measureText(brandKit.text || '').width, canvas.width - margin * 2);
    const height = logo ? (actualWidth * logo.height) / logo.width : canvas.width * 0.025;
    const x = brandKit.position?.includes('right') ? canvas.width - actualWidth - margin : margin;
    const y = brandKit.position?.includes('top') ? margin : canvas.height - height - margin;
    if (logo) context.drawImage(logo, x, y, actualWidth, height);
    else {
        context.fillStyle = '#fff';
        context.shadowColor = '#000';
        context.shadowBlur = 5;
        context.textBaseline = 'top';
        context.fillText(brandKit.text || '', x, y, actualWidth || 1);
    }
    context.restore();
}

async function render() {
    const mode = element('mode').value;
    const template = element('template').value;
    element('compare-controls').hidden = mode !== 'compare';
    element('mode-hint').textContent =
        mode === 'steps'
            ? 'Images become numbered steps. Add captions, reorder them, and toggle an arrow on each screenshot.'
            : mode === 'compare'
              ? 'Add at least two images. Reorder them to choose Before and After.'
              : 'Select an image to make it the main screenshot.';
    element('quality').disabled = element('format').value === 'image/png';
    element('quality-value').textContent =
        element('format').value === 'image/png' ? 'Lossless' : element('quality').value + '%';
    element('reveal-value').textContent = element('reveal').value + '%';
    element('download').disabled = true;
    if (!images.length) {
        canvas.style.display = 'none';
        element('empty').hidden = false;
        element('dimensions').textContent = 'Choose an image to start';
        return;
    }
    element('empty').hidden = true;
    canvas.style.display = 'block';
    const width = Math.round(Number(element('width').value));
    if (!Number.isFinite(width) || width < 320 || width > 4096)
        throw new Error('Choose an output width from 320 to 4096 pixels.');
    const scale = width / 1600;
    const padding = 80 * scale;
    const titleHeight = element('title').value.trim() ? 90 * scale : 0;
    const available = width - padding * 2;
    const image = images[selected].image;
    let bodyHeight = Math.max(220 * scale, Math.min((available * image.height) / image.width, 1800 * scale));
    if (mode === 'steps') bodyHeight = images.length * (540 * scale) - 30 * scale;
    if (mode === 'compare') bodyHeight = 850 * scale;
    if (template === 'social' && mode === 'frame') bodyHeight = width - padding * 2 - titleHeight;
    if (template === 'presentation' && mode === 'frame') bodyHeight = (width * 9) / 16 - padding * 2 - titleHeight;
    const height = Math.round(bodyHeight + padding * 2 + titleHeight);
    if (height > 16000 || width * height > 32000000)
        throw new Error('Composition too large. Reduce width or number of steps.');
    canvas.width = width;
    canvas.height = height;
    context.fillStyle = { clean: '#f0eee6', social: '#f46a4c', product: '#171c2a', presentation: '#dbe8ff' }[template];
    context.fillRect(0, 0, width, height);
    context.textBaseline = 'top';
    const ink = template === 'product' ? '#fff' : '#252522';
    context.fillStyle = ink;
    context.font = '700 ' + 40 * scale + 'px system-ui';
    drawText(element('title').value, padding, padding, available);
    const top = padding + titleHeight;
    if (mode === 'frame') {
        context.fillStyle = template === 'product' ? '#292f40' : '#fff';
        context.beginPath();
        context.roundRect(padding, top, available, bodyHeight, 18 * scale);
        context.fill();
        fitImage(image, padding + 20 * scale, top + 45 * scale, available - 40 * scale, bodyHeight - 65 * scale);
        ['#ff6258', '#ffbf49', '#37c96a'].forEach((color, index) => {
            context.fillStyle = color;
            context.beginPath();
            context.arc(padding + (25 + index * 22) * scale, top + 23 * scale, 6 * scale, 0, Math.PI * 2);
            context.fill();
        });
    } else if (mode === 'steps') {
        images.forEach((item, index) => {
            const y = top + index * 540 * scale;
            context.fillStyle = template === 'product' ? '#292f40' : '#fff';
            context.fillRect(padding, y, available, 510 * scale);
            fitImage(item.image, padding + 20 * scale, y + 15 * scale, available - 40 * scale, 405 * scale);
            if (item.arrow)
                drawArrow(padding + 20 * scale, y + 15 * scale, available - 40 * scale, 405 * scale, scale, item);
            context.fillStyle = '#df401b';
            context.beginPath();
            context.arc(padding + 40 * scale, y + 460 * scale, 23 * scale, 0, Math.PI * 2);
            context.fill();
            context.fillStyle = '#fff';
            context.font = '700 ' + 24 * scale + 'px system-ui';
            context.fillText(String(index + 1), padding + (index < 9 ? 33 : 26) * scale, y + 443 * scale);
            context.fillStyle = ink;
            context.font = '500 ' + 26 * scale + 'px system-ui';
            drawText(
                item.caption || 'Step ' + (index + 1),
                padding + 80 * scale,
                y + 442 * scale,
                available - 100 * scale,
            );
        });
    } else {
        if (images.length < 2) throw new Error('Add two images for a Before & After comparison.');
        context.fillStyle = template === 'product' ? '#292f40' : '#fff';
        context.fillRect(padding, top, available, bodyHeight);
        const imageTop = top + 65 * scale;
        const imageHeight = bodyHeight - 85 * scale;
        if (element('compare-style').value === 'side') {
            const half = available / 2;
            fitImage(images[0].image, padding + 10 * scale, imageTop, half - 20 * scale, imageHeight);
            fitImage(images[1].image, padding + half + 10 * scale, imageTop, half - 20 * scale, imageHeight);
        } else {
            fitImage(images[0].image, padding, imageTop, available, imageHeight);
            const reveal = (available * Number(element('reveal').value)) / 100;
            context.save();
            context.beginPath();
            context.rect(padding, imageTop, reveal, imageHeight);
            context.clip();
            context.fillRect(padding, imageTop, available, imageHeight);
            fitImage(images[1].image, padding, imageTop, available, imageHeight);
            context.restore();
            context.strokeStyle = '#df401b';
            context.lineWidth = 4 * scale;
            context.beginPath();
            context.moveTo(padding + reveal, imageTop);
            context.lineTo(padding + reveal, imageTop + imageHeight);
            context.stroke();
        }
        context.fillStyle = ink;
        context.font = '700 ' + 26 * scale + 'px system-ui';
        const slider = element('compare-style').value === 'slider';
        context.fillText(slider ? 'After' : 'Before', padding + 20 * scale, top + 20 * scale);
        context.fillText(slider ? 'Before' : 'After', padding + available / 2 + 20 * scale, top + 20 * scale);
    }
    await applyWatermark();
    element('dimensions').textContent = width + ' × ' + height + ' px';
    element('download').disabled = false;
}

function requestRender() {
    const version = ++renderVersion;
    element('download').disabled = true;
    rendering = rendering.then(async () => {
        if (version !== renderVersion) return;
        try {
            await render();
        } catch (error) {
            notify(error.message);
            element('download').disabled = true;
        }
    });
    return rendering;
}

element('files').addEventListener('change', async (event) => {
    for (const file of event.target.files) {
        const source = URL.createObjectURL(file);
        try {
            await addImage(source, file.name);
        } catch (error) {
            URL.revokeObjectURL(source);
            notify(error.message);
        }
    }
    event.target.value = '';
});

['mode', 'template', 'title', 'compare-style', 'reveal', 'width', 'format', 'quality', 'watermark'].forEach((id) => {
    element(id).addEventListener('input', requestRender);
});
globalThis.chrome?.storage?.onChanged.addListener((changes) => {
    if (changes.brandKit) requestRender();
});

element('download').addEventListener('click', async () => {
    await rendering;
    if (element('download').disabled) return;
    const type = element('format').value;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, Number(element('quality').value) / 100));
    if (!blob) return notify('Export failed. Try a smaller width.');
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download =
        'laqta-' +
        element('mode').value +
        '.' +
        ({ 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' }[blob.type] || 'png');
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    element('file-size').textContent = (blob.size / 1024).toFixed(1) + ' KB · ' + canvas.width + ' × ' + canvas.height;
    notify('Image exported.');
});

element('ocr').addEventListener('click', async () => {
    if (!images.length || ocrBusy) return;
    const source = images[selected].source;
    ocrBusy = true;
    element('ocr').disabled = true;
    let worker;
    try {
        notify('Preparing local text recognition…');
        const vendor = new URL('vendor/', location.href).href;
        worker = await Tesseract.createWorker(element('language').value, 1, {
            workerPath: vendor + 'worker.min.js',
            corePath: vendor,
            langPath: vendor.replace(/\/$/, ''),
            workerBlobURL: false,
            logger: (progress) => notify(progress.status + ' · ' + Math.round((progress.progress || 0) * 100) + '%'),
        });
        const { data } = await worker.recognize(source);
        element('text').value = data.text;
        element('copy').disabled = !data.text.trim();
        notify(
            data.text.trim()
                ? 'Text extracted. Review it before copying.'
                : 'No text found. Try a sharper image or another language.',
        );
    } catch (error) {
        notify('Text recognition failed: ' + error.message);
    } finally {
        if (worker) await worker.terminate();
        ocrBusy = false;
        element('ocr').disabled = !images.length;
    }
});
element('text').addEventListener('input', () => {
    element('copy').disabled = !element('text').value.trim();
});
element('copy').addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(element('text').value);
        notify('Text copied.');
    } catch {
        element('text').select();
        notify('Select and copy the text with Ctrl+C or Command+C.');
    }
});
async function initialize() {
    await self.fsPersonalBrandKitReady;
    if (globalThis.chrome?.storage) {
        const { studioCapture } = await chrome.storage.local.get('studioCapture');
        if (studioCapture) {
            await chrome.storage.local.remove('studioCapture');
            await addImage(studioCapture, 'Captured screenshot');
        }
    }
    requestRender();
}
initialize().catch((error) => notify(error.message));
