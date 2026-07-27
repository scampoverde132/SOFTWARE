/** Side-by-side WL PT TOOL product branding. */
(function () {
  'use strict';

  const APP_NAME = 'WL PT TOOL';

  function replaceText(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (node.parentElement?.closest('script,style,textarea,input')) continue;
      if (node.nodeValue?.includes('PlanTakeoff')) {
        node.nodeValue = node.nodeValue.replaceAll('PlanTakeoff', APP_NAME);
      }
    }
  }

  function applyBrand() {
    document.title = `${APP_NAME} — WL Painting`;
    const mark = document.querySelector('.brand-mark');
    if (mark) mark.textContent = 'WL';
    const name = document.querySelector('.brand > span:not([style])');
    if (name) name.textContent = APP_NAME;
    const version = document.querySelector('.brand > span[style]');
    if (version) version.textContent = 'Hybrid Suite';
    replaceText(document.querySelector('.app-header'));
    replaceText(document.getElementById('ptSettingsModal'));
    replaceText(document.getElementById('ptShortcutModal'));
    replaceText(document.getElementById('ptToastStack'));
  }

  window.WLPTIdentity = Object.freeze({ appName: APP_NAME, applyBrand });
  document.addEventListener('DOMContentLoaded', applyBrand);
  window.addEventListener('pt:settings-loaded', applyBrand);
  window.addEventListener('pt:settings-saved', applyBrand);

  const observer = new MutationObserver(() => applyBrand());
  const startObserver = () => {
    if (!document.body) return;
    observer.observe(document.body, { childList: true, subtree: true });
    applyBrand();
  };
  if (document.body) startObserver();
  else document.addEventListener('DOMContentLoaded', startObserver, { once: true });
})();
