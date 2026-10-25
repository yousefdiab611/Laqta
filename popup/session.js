(function () {
    const STORAGE_KEY = 'captureSession';
    const MAX_FRAMES = 8;

    const els = {
        section: document.getElementById('capture-session'),
        actions: document.querySelector('.actions'),
        startBtn: document.getElementById('btn-capture-steps'),
        captureBtn: document.getElementById('session-capture-btn'),
        captureLabel: document.getElementById('session-capture-label'),
        finishBtn: document.getElementById('session-finish-btn'),
        cancelBtn: document.getElementById('session-cancel-btn'),
        count: document.getElementById('session-count'),
        thumbs: document.getElementById('session-thumbs'),
        hint: document.getElementById('session-hint'),
        errorMsg: document.getElementById('error-msg'),
    };

    function getSession() {
        return new Promise((resolve) => {
            try {
                chrome.storage.session.get([STORAGE_KEY], (result) => {
                    resolve(result && result[STORAGE_KEY] ? result[STORAGE_KEY] : null);
                });
            } catch {
                resolve(null);
            }
        });
    }

    function setSession(session) {
        return new Promise((resolve) => {
            try {
                if (session === null) {
                    chrome.storage.session.remove([STORAGE_KEY], () => resolve());
                } else {
                    chrome.storage.session.set({ [STORAGE_KEY]: session }, () => resolve());
                }
            } catch {
                resolve();
            }
        });
    }

    function trackEvent(name, params = {}) {
        try {
            chrome.runtime.sendMessage({ type: 'ANALYTICS_TRACK_EVENT', eventName: name, params });
        } catch {
            // Analytics never block interactions.
        }
    }

    // Reads the user's currently-bound shortcut (if any) for the session-aware capture commands.
    // Returns a printable label like "Ctrl+Shift+S" or null if no shortcut is set. Both
    // capture-tab and capture-selection are session-aware (background.js), so prefer whichever
    // the user has actually bound.
    function getSessionShortcutLabel() {
        return new Promise((resolve) => {
            try {
                if (!chrome.commands || typeof chrome.commands.getAll !== 'function') {
                    resolve(null);
                    return;
                }
                chrome.commands.getAll((commands) => {
                    const list = commands || [];
                    // Prefer the dedicated session shortcut — it's purpose-built for this flow.
                    const dedicated = list.find((c) => c.name === 'capture-session-step' && c.shortcut);
                    resolve(dedicated ? dedicated.shortcut : null);
                });
            } catch {
                resolve(null);
            }
        });
    }

    // Toggle session card visibility via inline style.display — the [hidden] attribute
    // doesn't work here because .capture-session has a `display: flex` rule in session.css
    // that wins over the UA [hidden]{display:none} at equal specificity (see
    // feedback_popup_script_patterns memory).
    function showSessionUI(session) {
        if (els.actions) els.actions.style.display = 'none';
        els.section.style.display = 'flex';
        renderSession(session);
    }

    function hideSessionUI() {
        els.section.style.display = 'none';
        if (els.actions) els.actions.style.display = '';
    }

    let shortcutLabel = null;
    function renderSession(session) {
        const frames = (session && session.dataUrls) || [];
        const count = frames.length;

        els.count.textContent = count === 1 ? '1 frame' : `${count} frames`;
        els.finishBtn.disabled = count < 2;

        const reachedMax = count >= MAX_FRAMES;
        if (reachedMax) {
            els.captureLabel.textContent = 'Max frames reached';
        } else if (count === 0) {
            els.captureLabel.textContent = 'Drag to capture step 1';
        } else {
            els.captureLabel.textContent = `Drag to capture step ${count + 1}`;
        }
        els.captureBtn.disabled = reachedMax;

        els.thumbs.innerHTML = '';
        frames.forEach((dataUrl, i) => {
            const thumb = document.createElement('div');
            thumb.className = 'session-thumb';

            const num = document.createElement('span');
            num.className = 'session-thumb-num';
            num.textContent = String(i + 1);

            const img = document.createElement('img');
            img.src = dataUrl;
            img.alt = `Frame ${i + 1}`;

            const remove = document.createElement('button');
            remove.className = 'session-thumb-remove';
            remove.type = 'button';
            remove.setAttribute('aria-label', `Remove frame ${i + 1}`);
            remove.dataset.idx = String(i);
            remove.textContent = '×';

            thumb.appendChild(num);
            thumb.appendChild(img);
            thumb.appendChild(remove);
            els.thumbs.appendChild(thumb);
        });

        const shortcutTip = shortcutLabel
            ? ` Tip: press ${shortcutLabel} to capture another step without opening the popup.`
            : ' Tip: set a keyboard shortcut at chrome://extensions/shortcuts to capture steps faster.';
        if (reachedMax) {
            els.hint.textContent = `Maximum of ${MAX_FRAMES} steps reached. Tap Finish to open the collage editor.`;
        } else if (count === 0) {
            els.hint.textContent = 'Drag a rectangle around the part of the page that shows the step. Press Esc to cancel.';
        } else if (count === 1) {
            els.hint.textContent = `Frame 1 saved. Navigate to step 2 and capture again.${shortcutTip}`;
        } else {
            els.hint.textContent = `${count} steps captured. Add another or tap Finish.${shortcutTip}`;
        }
    }

    // Triggers the area-select overlay via the background. The popup closes immediately so the
    // overlay can show on the underlying tab — there's no way to keep both visible at once.
    async function triggerCapture(isFirstStep) {
        if (isFirstStep) {
            trackEvent('capture_session_started', { source: 'popup' });
            // Mark session active *before* the overlay so the keyboard shortcut path treats this
            // tab as session-aware even if the user cancels their first selection.
            const existing = await getSession();
            if (!existing || !existing.active) {
                await setSession({ active: true, dataUrls: [], createdAt: Date.now() });
            }
        }
        try {
            chrome.runtime.sendMessage({ type: 'POPUP_CAPTURE_STEP' });
        } catch {
            // sendMessage failures are silent — closing the popup still hands off to background.
        }
        window.close();
    }

    function finishSession() {
        getSession().then((session) => {
            const frames = (session && session.dataUrls) || [];
            if (frames.length < 2) return;
            trackEvent('capture_session_finished', { source: 'popup', frame_count: frames.length });
            chrome.runtime.sendMessage({ type: 'POPUP_OPEN_COLLAGE', dataUrls: frames, source: 'capture_session' }, () => {
                setSession(null).then(() => window.close());
            });
        });
    }

    async function cancelSession() {
        trackEvent('capture_session_cancelled', { source: 'popup' });
        await setSession(null);
        hideSessionUI();
    }

    async function removeFrame(idx) {
        const session = await getSession();
        if (!session) return;
        const frames = ((session.dataUrls) || []).slice();
        frames.splice(idx, 1);
        // If the user removed the last frame, end the session entirely.
        const next = frames.length === 0 ? null : Object.assign({}, session, { dataUrls: frames });
        await setSession(next);
        trackEvent('capture_session_frame_removed', { source: 'popup', frame_index: idx + 1, frame_count: frames.length });
        if (next) {
            renderSession(next);
        } else {
            hideSessionUI();
        }
    }

    if (els.startBtn) {
        els.startBtn.addEventListener('click', () => triggerCapture(true));
    }
    if (els.captureBtn) els.captureBtn.addEventListener('click', () => triggerCapture(false));
    if (els.finishBtn) els.finishBtn.addEventListener('click', finishSession);
    if (els.cancelBtn) els.cancelBtn.addEventListener('click', cancelSession);
    if (els.thumbs) {
        els.thumbs.addEventListener('click', (e) => {
            const target = e.target;
            if (!(target && target.closest)) return;
            const removeBtn = target.closest('.session-thumb-remove');
            if (!removeBtn) return;
            const idx = parseInt(removeBtn.dataset.idx, 10);
            if (Number.isInteger(idx)) removeFrame(idx);
        });
    }

    // On popup open: resolve the user's shortcut (best-effort) in parallel with the session
    // restore so the hint can reference it. The shortcut may not be set — handled gracefully.
    Promise.all([getSession(), getSessionShortcutLabel()]).then(([session, label]) => {
        shortcutLabel = label;
        if (session && session.active) {
            const frameCount = Array.isArray(session.dataUrls) ? session.dataUrls.length : 0;
            trackEvent('capture_session_resumed', { source: 'popup', frame_count: frameCount });
            showSessionUI(session);
        }
    });
})();
