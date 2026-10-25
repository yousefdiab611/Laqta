const status = document.getElementById('status');
const printPages = document.getElementById('print-pages');

function imageFromFile(file) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        const objectUrl = URL.createObjectURL(file);
        image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image); };
        image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error(`Could not read ${file.name}.`)); };
        image.src = objectUrl;
    });
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.getElementById('pdf-export').addEventListener('click', async () => {
    const files = Array.from(document.getElementById('pdf-files').files);
    if (!files.length) return void (status.textContent = 'Choose at least one image.');
    const pages = files.map((file) => {
        const page = document.createElement('div');
        page.className = 'print-page';
        const image = document.createElement('img');
        image.src = URL.createObjectURL(file);
        page.appendChild(image);
        return page;
    });
    printPages.replaceChildren(...pages);
    await Promise.all(Array.from(printPages.querySelectorAll('img')).map((image) => image.decode()));
    status.textContent = 'Choose “Save as PDF” in the print dialog.';
    window.print();
});

async function gifFrames(files) {
    const images = await Promise.all(files.map(imageFromFile));
    const width = Math.min(640, images[0].naturalWidth);
    const height = Math.round(width * images[0].naturalHeight / images[0].naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    return {
        width,
        height,
        frames: images.map((image) => {
            context.fillStyle = '#000';
            context.fillRect(0, 0, width, height);
            context.drawImage(image, 0, 0, width, height);
            return context.getImageData(0, 0, width, height);
        })
    };
}

document.getElementById('gif-export').addEventListener('click', async (event) => {
    const files = Array.from(document.getElementById('gif-files').files);
    if (files.length < 2) return void (status.textContent = 'Choose at least two images.');
    event.currentTarget.disabled = true;
    status.textContent = 'Creating GIF locally…';
    try {
        const animation = await gifFrames(files);
        const delay = Number(document.getElementById('gif-delay').value);
        const blob = fsGifEncoder.encodeGif(animation.frames, animation.width, animation.height, delay);
        downloadBlob(blob, 'laqta-animation.gif');
        status.textContent = 'GIF created.';
    } catch (error) {
        status.textContent = error.message || 'GIF export failed.';
    } finally {
        event.currentTarget.disabled = false;
    }
});

function stoppedRecorder(recorder) {
    return new Promise((resolve) => recorder.addEventListener('stop', resolve, { once: true }));
}

function loadedVideo(video) {
    return new Promise((resolve, reject) => {
        video.addEventListener('loadedmetadata', resolve, { once: true });
        video.addEventListener('error', () => reject(new Error('Could not read this video.')), { once: true });
    });
}

async function mp4Blob(file, mimeType) {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);
    const metadataReady = loadedVideo(video);
    let recorder;
    video.src = objectUrl;
    try {
        await metadataReady;
        if (typeof video.captureStream !== 'function') throw new Error('Video conversion is not supported.');
        recorder = new MediaRecorder(video.captureStream(), { mimeType });
        const chunks = [];
        recorder.addEventListener('dataavailable', (record) => { if (record.data.size) chunks.push(record.data); });
        recorder.start(1000);
        await video.play();
        await new Promise((resolve) => video.addEventListener('ended', resolve, { once: true }));
        const recorderStopped = stoppedRecorder(recorder);
        recorder.stop();
        await recorderStopped;
        return new Blob(chunks, { type: mimeType });
    } finally {
        if (recorder && recorder.state !== 'inactive') recorder.stop();
        video.src = '';
        URL.revokeObjectURL(objectUrl);
    }
}

document.getElementById('mp4-export').addEventListener('click', async (event) => {
    const file = document.getElementById('video-file').files[0];
    if (!file) return void (status.textContent = 'Choose a video first.');
    const mimeType = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4']
        .find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) return void (status.textContent = 'MP4 export is not supported by this Chrome version.');
    event.currentTarget.disabled = true;
    status.textContent = 'Converting video in real time…';
    try {
        downloadBlob(await mp4Blob(file, mimeType), 'laqta-video.mp4');
        status.textContent = 'MP4 created.';
    } catch (error) {
        status.textContent = error.message || 'MP4 export failed.';
    } finally {
        event.currentTarget.disabled = false;
    }
});
