const btnTab = document.getElementById('btn-tab');
const btnScreen = document.getElementById('btn-screen');
const btnCopyScreen = document.getElementById('btn-copy-screen');
const btnShortcuts = document.getElementById('btn-shortcuts');
const btnArea = document.getElementById('btn-area');
const btnPrivate = document.getElementById('btn-private');
const btnUpload = document.getElementById('btn-upload');
const btnCollage = document.getElementById('btn-collage');
const fileInput = document.getElementById('file-input');
const collageInput = document.getElementById('collage-input');
const errorMsg = document.getElementById('error-msg');
const quickModeToggle = document.getElementById('quick-mode-toggle');
const quickModeRow = document.getElementById('quick-mode-row');
const btnFullPage = document.getElementById('btn-fullpage');
const btnHistory = document.getElementById('btn-history');
const btnBrand = document.getElementById('btn-brand');
const btnExportTools = document.getElementById('btn-export-tools');
const btnTabDesc  = btnTab.querySelector('.action-desc');
const btnAreaDesc = btnArea.querySelector('.action-desc');
const btnFullPageDesc = btnFullPage.querySelector('.action-desc');

const TAB_DESC_DEFAULT  = 'صوّر اللي قدامك، وظبّطه بطريقتك';
const TAB_DESC_QUICK    = 'لقطتك بإعداداتك، جاهزة للصق';
const AREA_DESC_DEFAULT = 'حدّد المساحة بنفسك';
const AREA_DESC_QUICK   = 'حدّد الجزء وانسخه بإعداداتك';

// Keep in sync with src/background/selectionOverlay.js (different runtimes, no shared module possible).
const NON_SCRIPTABLE_URL_PREFIXES = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'view-source:', 'https://chromewebstore.google.com'];

let activeTabIsScriptable = true;
function trackEvent(eventName, params = {}) {
    try {
        chrome.runtime.sendMessage({ type: 'ANALYTICS_TRACK_EVENT', eventName, params });
    } catch {
        // Analytics should never interrupt popup interactions.
    }
}
trackEvent('popup_opened', { source: 'popup' });

// Drop-off signal: if the popup is opened and dismissed without starting any
// capture/upload/collage/record action, emit one best-effort event so the
// install→first-capture funnel leak is measurable. Delivery during popup
// teardown is best-effort (the service worker may be waking), so counts are
// directional, not exact.
let actionTaken = false;
let dropOffReported = false;
const actionsContainer = document.querySelector('.actions');
if (actionsContainer) {
    actionsContainer.addEventListener('click', (e) => {
        if (e.target.closest('.action-btn')) actionTaken = true;
    }, true);
}
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && !actionTaken && !dropOffReported) {
        dropOffReported = true;
        trackEvent('popup_closed_no_action', { source: 'popup' });
    }
});

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs && tabs[0] && tabs[0].url;
    if (typeof url !== 'string') return;
    if (NON_SCRIPTABLE_URL_PREFIXES.some((p) => url.startsWith(p))) {
        activeTabIsScriptable = false;
        btnArea.classList.add('disabled-soft');
        if (btnAreaDesc) btnAreaDesc.textContent = 'غير متاح في الصفحة دي';
        btnPrivate.classList.add('disabled-soft');
        btnFullPage.classList.add('disabled-soft');
        if (btnFullPageDesc) btnFullPageDesc.textContent = 'غير متاح في الصفحة دي';
    }
});

function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.add('visible');
}

function setLoading(btn) {
    btn.classList.add('loading');
}

function setQuickModeUi(enabled) {
    quickModeToggle.checked = enabled;
    quickModeRow.classList.toggle('active', enabled);
    if (btnTabDesc)  btnTabDesc.textContent  = enabled ? TAB_DESC_QUICK  : TAB_DESC_DEFAULT;
    if (btnAreaDesc) btnAreaDesc.textContent = enabled ? AREA_DESC_QUICK : AREA_DESC_DEFAULT;
}

// Load persisted quick copy preference, verified against actual permission state.
chrome.storage.local.get(['quickCopyMode'], (result) => {
    if (result.quickCopyMode) {
        chrome.permissions.contains({ permissions: ['clipboardWrite'] }, (granted) => {
            if (!granted) {
                // Stale stored value — permission was revoked or never granted.
                chrome.storage.local.set({ quickCopyMode: false });
                setQuickModeUi(false);
            } else {
                setQuickModeUi(true);
            }
        });
    } else {
        setQuickModeUi(false);
    }
});

quickModeToggle.addEventListener('change', () => {
    const enabled = quickModeToggle.checked;
    trackEvent('quick_copy_toggle_changed', { enabled, source: 'popup' });
    trackEvent(enabled ? 'quick_copy_enabled' : 'quick_copy_disabled', { source: 'popup' });
    if (!enabled) {
        setQuickModeUi(false);
        chrome.storage.local.set({ quickCopyMode: false });
        return;
    }
    setQuickModeUi(true);
    chrome.storage.local.set({ quickCopyMode: true });
    // Request clipboard access the first time the user enables Quick Copy.
    chrome.permissions.request({ permissions: ['clipboardWrite'] }, (granted) => {
        if (granted) {
            setQuickModeUi(true);
            chrome.storage.local.set({ quickCopyMode: true });
        } else {
            setQuickModeUi(false);
            chrome.storage.local.set({ quickCopyMode: false });
            // Separates "never tried it" from "tried it and the Chrome dialog stopped them".
            trackEvent('quick_copy_disabled', { source: 'popup', reason: 'permission_denied' });
            showError('النسخ السريع محتاج إذن الوصول للحافظة. جرّب تفعيله تاني.');
        }
    });
});

btnShortcuts.addEventListener('click', () => {
    actionTaken = true;
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    window.close();
});

btnHistory.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('history/index.html') });
    window.close();
});

btnBrand.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('brand-kit/index.html') });
    window.close();
});

btnExportTools.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('export-tools/index.html') });
    window.close();
});

btnTab.addEventListener('click', () => {
    if (quickModeToggle.checked) {
        handleQuickCopy();
    } else {
        setLoading(btnTab);
        chrome.runtime.sendMessage({ type: 'POPUP_CAPTURE_TAB' }, () => {
            window.close();
        });
    }
});

btnScreen.addEventListener('click', () => {
    setLoading(btnScreen);
    chrome.runtime.sendMessage({ type: 'POPUP_CAPTURE_SCREEN' }, (response) => {
        if (!response || !response.ok) {
            btnScreen.classList.remove('loading');
            showError(response?.error || 'تعذّر فتح تصوير النافذة. جرّب تاني.');
            return;
        }
        window.close();
    });
});

btnCopyScreen.addEventListener('click', () => {
    chrome.permissions.request({ permissions: ['clipboardWrite'] }, (granted) => {
        if (!granted) {
            showError('اسمح بالوصول للحافظة عشان تقدر تنسخ النافذة.');
            return;
        }
        setLoading(btnCopyScreen);
        chrome.runtime.sendMessage({ type: 'POPUP_COPY_SCREEN' }, (response) => {
            if (!response?.ok) {
                btnCopyScreen.classList.remove('loading');
                showError(response?.error || 'تعذّر فتح تصوير النافذة. جرّب تاني.');
                return;
            }
            window.close();
        });
    });
});

btnArea.addEventListener('click', () => {
    if (!activeTabIsScriptable) {
        trackEvent('select_area_blocked', { source: 'popup', reason: 'non_scriptable_page' });
        showError("تحديد جزء مش متاح في صفحات Chrome الداخلية. افتح موقع عادي أو التقط التبويب.");
        return;
    }
    setLoading(btnArea);
    const msgType = quickModeToggle.checked
        ? 'POPUP_CAPTURE_SELECTION_QUICK_COPY'
        : 'POPUP_CAPTURE_SELECTION';
    chrome.runtime.sendMessage({ type: msgType }, () => {
        window.close();
    });
});

btnPrivate.addEventListener('click', () => {
    if (!activeTabIsScriptable) {
        showError("اللقطة الخاصة مش متاحة في صفحات Chrome الداخلية.");
        return;
    }
    setLoading(btnPrivate);
    chrome.runtime.sendMessage({ type: 'POPUP_CAPTURE_PRIVATE' }, (response) => {
        if (!response?.ok) {
            btnPrivate.classList.remove('loading');
            showError(response?.error || 'تعذّر التقاط الصورة الخاصة. جرّب تاني.');
            return;
        }
        window.close();
    });
});

// Full Page always opens the editor (ignores the Quick copy toggle).
btnFullPage.addEventListener('click', () => {
    if (!activeTabIsScriptable) {
        trackEvent('full_page_blocked', { source: 'popup', reason: 'non_scriptable_page' });
        showError("تصوير الصفحة كاملة مش متاح هنا. افتح موقع عادي أو استخدم التقاط التبويب.");
        return;
    }
    trackEvent('full_page_clicked', { source: 'popup' });
    setLoading(btnFullPage);
    chrome.runtime.sendMessage({ type: 'POPUP_CAPTURE_FULLPAGE' }, () => {
        window.close();
    });
});

btnUpload.addEventListener('click', () => {
    trackEvent('upload_image_clicked', { source: 'popup' });
    fileInput.click();
});

btnCollage.addEventListener('click', () => {
    trackEvent('create_collage_clicked', { source: 'popup' });
    collageInput.click();
});

collageInput.addEventListener('change', () => {
    const files = Array.from(collageInput.files);
    if (!files.length) return;

    const valid = files.filter((f) => {
        if (f.type === 'image/heic' || f.type === 'image/heif') return false;
        if (!f.type.startsWith('image/')) return false;
        if (f.size > 50 * 1024 * 1024) return false;
        return true;
    });

    if (!valid.length) {
        showError('اختار صور بصيغة PNG أو JPG أو WebP.');
        return;
    }

    setLoading(btnCollage);

    let loaded = 0;
    const dataUrls = [];

    valid.forEach((file, i) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            dataUrls[i] = e.target.result;
            loaded++;
            if (loaded === valid.length) {
                chrome.runtime.sendMessage({ type: 'POPUP_OPEN_COLLAGE', dataUrls }, () => {
                    window.close();
                });
            }
        };
        reader.onerror = () => {
            showError('تعذّر قراءة بعض الصور. جرّب اختيارها تاني.');
            btnCollage.classList.remove('loading');
        };
        reader.readAsDataURL(file);
    });
});

fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;

    if (file.type === 'image/heic' || file.type === 'image/heif') {
        showError('صيغة HEIC مش مدعومة حاليًا. حوّل الصورة إلى PNG أو JPG الأول.');
        return;
    }

    if (!file.type.startsWith('image/')) {
        showError('اختار صورة بصيغة PNG أو JPG أو WebP.');
        return;
    }

    if (file.size > 50 * 1024 * 1024) {
        showError('حجم الصورة أكبر من المسموح. الحد الأقصى 50 ميجابايت.');
        return;
    }

    setLoading(btnUpload);

    const reader = new FileReader();
    reader.onload = (e) => {
        const dataUrl = e.target.result;
        const fileType = (file.type || '').split('/')[1] || 'unknown';
        chrome.runtime.sendMessage({ type: 'POPUP_OPEN_WITH_IMAGE', dataUrl, fileType }, () => {
            window.close();
        });
    };
    reader.onerror = () => {
        showError('تعذّر قراءة الصورة. جرّب تاني.');
        btnUpload.classList.remove('loading');
    };
    reader.readAsDataURL(file);
});

// ─── Quick copy ────────────────────────────────────────────────────────────────

function handleQuickCopy() {
    trackEvent('quick_copy_used', { source: 'popup' });
    setLoading(btnTab);
    chrome.runtime.sendMessage({ type: 'POPUP_CAPTURE_TAB_QUICK_COPY' }, (response) => {
        if (!response || !response.ok || !response.screenshotDataUrl) {
            btnTab.classList.remove('loading');
            trackEvent('quick_capture_failed', { source: 'popup', error_type: 'unknown', result: 'failure' });
            trackEvent('capture_failed', { capture_type: 'quick_copy', source: 'popup', error_type: 'unknown', result: 'failure' });
            showError('التصوير ما اكتملش. جرّب تاني.');
            return;
        }
        renderAndCopy(response.screenshotDataUrl, response.settings);
    });
}

function renderAndCopy(screenshotDataUrl, settings) {
    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas');
        drawStyledToCanvas(canvas, img, settings);
        canvas.toBlob((blob) => {
            if (!blob) {
                btnTab.classList.remove('loading');
                showError('تعذّر تجهيز الصورة. جرّب تاني.');
                return;
            }
            navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
                .then(() => {
                    btnTab.classList.remove('loading');
                    trackEvent('quick_capture_completed', { source: 'popup', result: 'success' });
                    trackEvent('quick_copy_success', { source: 'popup', result: 'success' });
                    trackEvent('capture_completed', { capture_type: 'quick_copy', source: 'popup', result: 'success' });
                    chrome.runtime.sendMessage({ type: 'SHOW_QUICK_COPY_TOAST' });
                    showCopiedFeedback();
                })
                .catch(() => {
                    btnTab.classList.remove('loading');
                    trackEvent('quick_copy_failed', { source: 'popup', error_type: 'clipboard', result: 'failure' });
                    trackEvent('quick_capture_failed', { source: 'popup', error_type: 'clipboard', result: 'failure' });
                    trackEvent('capture_failed', { capture_type: 'quick_copy', source: 'popup', error_type: 'clipboard', result: 'failure' });
                    showError('تعذّر النسخ للحافظة. جرّب تاني.');
                });
        }, 'image/png');
    };
    img.onerror = () => {
        btnTab.classList.remove('loading');
        trackEvent('quick_copy_failed', { source: 'popup', error_type: 'unsupported', result: 'failure' });
        trackEvent('quick_capture_failed', { source: 'popup', error_type: 'unsupported', result: 'failure' });
        trackEvent('capture_failed', { capture_type: 'quick_copy', source: 'popup', error_type: 'unsupported', result: 'failure' });
        showError('تعذّر تحميل الصورة. جرّب تاني.');
    };
    img.src = screenshotDataUrl;
}

function showCopiedFeedback() {
    const titleEl = btnTab.querySelector('.action-title');
    const originalTitle = titleEl ? titleEl.textContent : null;
    if (titleEl) titleEl.textContent = 'اتنسخت!';
    setTimeout(() => {
        window.close();
        if (titleEl && originalTitle) titleEl.textContent = originalTitle;
    }, 700);
}

document.getElementById('btn-studio').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('studio/index.html') });
});
document.getElementById('btn-studio-capture').addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try {
        const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
        await chrome.storage.local.set({ studioCapture: dataUrl });
        await chrome.tabs.create({ url: chrome.runtime.getURL('studio/index.html') });
    } catch (error) {
        showError(error.message || 'تعذّر تصوير التبويب. جرّب على موقع عادي.');
        event.currentTarget.disabled = false;
    }
});
