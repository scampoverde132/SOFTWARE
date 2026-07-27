/** Keep Daily Logs default dates aligned with the workstation calendar date. */
(function () {
  'use strict';

  function localToday() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function correctDefaultDate() {
    const input = document.getElementById('dailyLogDate');
    if (!input) return;
    const utcToday = new Date().toISOString().slice(0, 10);
    const local = localToday();
    if (!input.value || (input.value === utcToday && utcToday !== local)) input.value = local;
  }

  document.addEventListener('DOMContentLoaded', () => {
    correctDefaultDate();
    document.querySelector('[data-tab="daily-logs"]')?.addEventListener('click', () => setTimeout(correctDefaultDate, 0));
    setInterval(correctDefaultDate, 2000);
  });
  window.addEventListener('pt:daily-log-saved', () => setTimeout(correctDefaultDate, 0));
})();
