(function () {
    'use strict';
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
    function selectTab(tab) {
        tabs.forEach((item) => {
            const selected = item === tab;
            item.setAttribute('aria-selected', String(selected));
            item.tabIndex = selected ? 0 : -1;
            document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
        });
        document.querySelector('.main-content').scrollTop = 0;
    }
    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => selectTab(tab));
        tab.addEventListener('keydown', (event) => {
            let target;
            if (event.key === 'ArrowLeft') target = tabs[(index + 1) % tabs.length];
            if (event.key === 'ArrowRight') target = tabs[(index - 1 + tabs.length) % tabs.length];
            if (event.key === 'Home') target = tabs[0];
            if (event.key === 'End') target = tabs[tabs.length - 1];
            if (!target) return;
            event.preventDefault();
            selectTab(target);
            target.focus();
        });
    });
    // Bring an ongoing recording into view when the popup is reopened.
    const recording = document.getElementById('btn-record');
    new MutationObserver(() => {
        if (recording.classList.contains('recording-active')) selectTab(document.getElementById('tab-video'));
    }).observe(recording, { attributes: true, attributeFilter: ['class'] });
})();
