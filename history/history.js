const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const clearButton = document.getElementById('clear');

function openButton(capture) {
    const button = document.createElement('button');
    button.textContent = 'Open';
    button.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'OPEN_HISTORY_CAPTURE', dataUrl: capture.dataUrl });
    });
    return button;
}

function deleteButton(captureId, card) {
    const button = document.createElement('button');
    button.className = 'delete';
    button.textContent = 'Delete';
    button.addEventListener('click', async () => {
        await fsCaptureHistory.deleteCapture(captureId);
        card.remove();
        empty.hidden = grid.childElementCount > 0;
    });
    return button;
}

function captureCard(capture) {
    const card = document.createElement('article');
    card.className = 'capture';
    const image = document.createElement('img');
    image.src = capture.dataUrl;
    image.alt = 'Saved screenshot';
    const footer = document.createElement('footer');
    const time = document.createElement('time');
    time.textContent = new Date(capture.createdAt).toLocaleString();
    const buttons = document.createElement('div');
    buttons.className = 'buttons';
    buttons.append(openButton(capture), deleteButton(capture.id, card));
    footer.append(time, buttons);
    card.append(image, footer);
    return card;
}

async function loadHistory() {
    const captures = await fsCaptureHistory.listCaptures();
    grid.replaceChildren(...captures.map(captureCard));
    empty.hidden = captures.length > 0;
}

clearButton.addEventListener('click', async () => {
    if (!confirm('Delete all locally saved captures?')) return;
    await fsCaptureHistory.clearHistory();
    await loadHistory();
});

loadHistory().catch((error) => {
    empty.hidden = false;
    empty.textContent = error.message || 'Could not load capture history.';
});
