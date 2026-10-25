const fields = {
    enabled: document.getElementById('enabled'),
    logo: document.getElementById('logo'),
    text: document.getElementById('text'),
    position: document.getElementById('position'),
    size: document.getElementById('size'),
    opacity: document.getElementById('opacity')
};
const watermark = document.getElementById('watermark');
const status = document.getElementById('status');
let logoDataUrl = '';

function resizedLogo(file) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        const objectUrl = URL.createObjectURL(file);
        image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Could not read logo.')); };
        image.onload = () => {
            const scale = Math.min(1, 512 / Math.max(image.width, image.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.width * scale));
            canvas.height = Math.max(1, Math.round(image.height * scale));
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(objectUrl);
            resolve(canvas.toDataURL('image/png'));
        };
        image.src = objectUrl;
    });
}

function updatePreview() {
    document.getElementById('size-output').textContent = `${fields.size.value}%`;
    document.getElementById('opacity-output').textContent = `${fields.opacity.value}%`;
    watermark.style.opacity = Number(fields.opacity.value) / 100;
    watermark.style.width = `${fields.size.value}%`;
    watermark.textContent = logoDataUrl ? '' : (fields.text.value || 'Your brand');
    watermark.style.background = logoDataUrl ? `url(${logoDataUrl}) center/contain no-repeat` : 'none';
    watermark.style.inset = 'auto';
    watermark.style[fields.position.value.includes('top') ? 'top' : 'bottom'] = '16px';
    watermark.style[fields.position.value.includes('left') ? 'left' : 'right'] = '16px';
}

async function loadSettings() {
    await self.fsPersonalBrandKitReady;
    chrome.storage.local.get(['brandKit'], ({ brandKit }) => {
        if (!brandKit) return updatePreview();
        fields.enabled.checked = Boolean(brandKit.enabled);
        fields.text.value = brandKit.text || '';
        fields.position.value = brandKit.position || 'bottom-right';
        fields.size.value = brandKit.size || 12;
        fields.opacity.value = Math.round((brandKit.opacity || .85) * 100);
        logoDataUrl = brandKit.logoDataUrl || '';
        updatePreview();
    });
}

fields.logo.addEventListener('change', async () => {
    const file = fields.logo.files[0];
    if (!file) return;
    try {
        logoDataUrl = await resizedLogo(file);
        updatePreview();
    } catch (error) {
        status.textContent = error.message || 'Could not load logo.';
    }
});

document.getElementById('remove-logo').addEventListener('click', () => {
    logoDataUrl = '';
    fields.logo.value = '';
    updatePreview();
});

[fields.text, fields.position, fields.size, fields.opacity].forEach((field) => {
    field.addEventListener('input', updatePreview);
});

document.getElementById('save').addEventListener('click', () => {
    const brandKit = {
        enabled: fields.enabled.checked,
        logoDataUrl,
        text: fields.text.value.trim(),
        position: fields.position.value,
        size: Number(fields.size.value),
        opacity: Number(fields.opacity.value) / 100
    };
    chrome.storage.local.set({ brandKit }, () => { status.textContent = 'Brand Kit saved locally.'; });
});

loadSettings().catch((error) => { status.textContent = error.message; });
