/** Ensure saved suite estimating defaults are used by every newly created job/condition. */
(function () {
  'use strict';

  let installed = false;
  const clone = (value) => {
    try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); }
  };

  function classify(style, overrides = {}) {
    const role = String(overrides.rateKey || overrides.roomRole || '').toLowerCase();
    const name = String(overrides.name || '').toLowerCase();
    if (role.includes('ceiling') || name.includes('ceiling')) return 'ceilings';
    if (role.includes('door') || name.includes('door')) return 'doors';
    if (role.includes('base') || name.includes('base') || name.includes('shoe')) return 'base';
    if (role.includes('trim') || name.includes('trim') || name.includes('crown') || name.includes('molding')) return 'trim';
    if (role.includes('exterior') || name.includes('exterior') || name.includes('facade')) return 'exterior';
    if (style === 'area' && name.includes('ceiling')) return 'ceilings';
    return 'walls';
  }

  function currentSettings() {
    return window.PTSettings?.get?.() || null;
  }

  function seedProject(project, force = false) {
    const settings = currentSettings();
    if (!project || !settings) return project;
    project.paintingSettings ||= {};
    if (force || project.paintingSettings.wastePct == null) {
      project.paintingSettings.wastePct = Number(settings.defaultWastePct) || 0;
    }
    project.paintingSettings.rates ||= {};
    for (const [key, rate] of Object.entries(settings.rates || {})) {
      if (force || !project.paintingSettings.rates[key]) {
        project.paintingSettings.rates[key] = clone(rate);
      }
    }
    return project;
  }

  function syncModelRates() {
    const M = window.PTModels;
    const settings = currentSettings();
    if (!M || !settings) return;
    M.DEFAULT_WASTE_PCT = settings.defaultWastePct;
    M.DEFAULT_PAINTING_RATES ||= {};
    for (const [key, rate] of Object.entries(settings.rates || {})) {
      M.DEFAULT_PAINTING_RATES[key] = { ...(M.DEFAULT_PAINTING_RATES[key] || {}), ...rate };
    }
  }

  function install() {
    const M = window.PTModels;
    if (!M || installed) return !!M;
    installed = true;
    syncModelRates();

    if (typeof M.createProject === 'function') {
      const original = M.createProject;
      M.createProject = function (...args) {
        return seedProject(original.apply(this, args), true);
      };
    }

    if (typeof M.createCondition === 'function') {
      const original = M.createCondition;
      M.createCondition = function (style = 'linear', overrides = {}) {
        const condition = original.call(this, style, overrides);
        const settings = currentSettings();
        const key = classify(style, overrides);
        condition.rateKey ||= key;
        if (settings && overrides.coverageRate == null && settings.rates?.[key]) {
          condition.coverageRate = Number(settings.rates[key].coverageRate) || condition.coverageRate;
        }
        return condition;
      };
    }

    if (typeof M.normalizePaintingProject === 'function') {
      const original = M.normalizePaintingProject;
      M.normalizePaintingProject = function (project, ...args) {
        seedProject(project, false);
        return original.call(this, project, ...args);
      };
    }
    return true;
  }

  window.addEventListener('pt:settings-loaded', syncModelRates);
  window.addEventListener('pt:settings-saved', syncModelRates);
  document.addEventListener('DOMContentLoaded', () => {
    install();
    let attempts = 0;
    const timer = setInterval(() => {
      install();
      syncModelRates();
      attempts += 1;
      if (installed || attempts > 100) clearInterval(timer);
    }, 100);
  });
  install();
})();
