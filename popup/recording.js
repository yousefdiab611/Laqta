(function () {
    const btnRecord = document.getElementById('btn-record');
    const desc = document.getElementById('recording-desc');
    const timer = document.getElementById('recording-timer');
    const errorMsg = document.getElementById('error-msg');

    if (!btnRecord || !desc || !timer) return;

    let state = 'idle';
    let recordingId = null;
    let startedAt = 0;
    let timerId = null;
    let closeAfterStartId = null;

    function showError(message) {
        if (!errorMsg) return;
        errorMsg.textContent = message;
        errorMsg.classList.remove('notice');
        errorMsg.classList.add('visible');
    }

    function showNotice(message) {
        if (!errorMsg) return;
        errorMsg.textContent = message;
        errorMsg.classList.add('notice', 'visible');
    }

    function clearAutoClose() {
        if (!closeAfterStartId) return;
        clearTimeout(closeAfterStartId);
        closeAfterStartId = null;
    }

    function formatElapsed(ms) {
        const total = Math.max(0, Math.floor(ms / 1000));
        const minutes = String(Math.floor(total / 60)).padStart(2, '0');
        const seconds = String(total % 60).padStart(2, '0');
        return `${minutes}:${seconds}`;
    }

    function stopTimer() {
        if (timerId) clearInterval(timerId);
        timerId = null;
    }

    function startTimer() {
        stopTimer();
        timer.hidden = false;
        timer.textContent = '00:00';
        timerId = setInterval(() => {
            timer.textContent = formatElapsed(Date.now() - startedAt);
        }, 500);
    }

    function setState(nextState) {
        state = nextState;
        btnRecord.classList.toggle('loading', nextState === 'starting' || nextState === 'stopping');
        btnRecord.classList.toggle('recording-active', nextState === 'recording');
        btnRecord.classList.toggle('recording-stopping', nextState === 'stopping');
        if (nextState === 'recording') {
            btnRecord.querySelector('.action-title').textContent = 'إيقاف وتعديل';
            desc.textContent = 'أوقف التسجيل وافتحه في المحرر';
            return;
        }
        btnRecord.querySelector('.action-title').textContent = nextState === 'stopping' ? 'بنجهّز المحرر' : 'ابدأ التسجيل';
        desc.textContent = nextState === 'starting'
            ? 'جاري بدء التسجيل…'
            : (nextState === 'stopping' ? 'جاري تجهيز الفيديو' : 'سجّل فيديو من التبويب الحالي');
        if (nextState === 'idle') {
            stopTimer();
            timer.hidden = true;
        }
    }

    function sendMessage(message) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage(message, (response) => {
                resolve(response || { ok: false });
            });
        });
    }

    function getActiveTab() {
        return new Promise((resolve) => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                resolve((tabs && tabs[0]) || null);
            });
        });
    }

    async function startRecording() {
        clearAutoClose();
        setState('starting');
        const tab = await getActiveTab();
        if (!tab || !Number.isInteger(tab.id)) {
            showError('مفيش تبويب متاح للتسجيل.');
            setState('idle');
            return;
        }

        const response = await sendMessage({
            type: 'RECORDING_START',
            tabId: tab.id,
            title: tab.title || 'لقطة — Laqta recording'
        });

        if (!response.ok) {
            showError(response.error || 'تعذّر بدء التسجيل. جرّب تاني.');
            setState('idle');
            return;
        }

        recordingId = response.recordingId;
        startedAt = Date.now();
        startTimer();
        setState('recording');
        showNotice('بدأ التسجيل. افتح لقطة تاني لما تحب توقفه.');
        closeAfterStartId = setTimeout(() => window.close(), 900);
    }

    async function stopRecording() {
        if (!recordingId) return;
        clearAutoClose();
        setState('stopping');
        const response = await sendMessage({ type: 'RECORDING_STOP', recordingId });
        if (!response.ok) {
            showError(response.error || 'تعذّر إيقاف التسجيل. جرّب تاني.');
            setState('recording');
            return;
        }
        window.close();
    }

    btnRecord.addEventListener('click', () => {
        if (state === 'idle') {
            startRecording();
            return;
        }
        if (state === 'recording') stopRecording();
    });

    sendMessage({ type: 'RECORDING_STATUS' }).then((response) => {
        if (!response.ok || !response.recording) return;
        recordingId = response.recording.recordingId;
        startedAt = response.recording.startedAt || Date.now();
        startTimer();
        setState('recording');
    });
}());
