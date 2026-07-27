/**
 * PlanTakeoff pre-app bootstrap.
 * Load disk-backed Jobs, Command Center, estimating/finalization/job lifecycle,
 * release settings/hardening, client updates, then the unchanged PDF core.
 */
(function () {
  document.write('<script src="js/job-model.js"><\/script>');
  document.write('<script src="js/command-center.js"><\/script>');
  document.write('<script src="js/productivity.js"><\/script>');
  document.write('<script src="js/finalization.js"><\/script>');
  document.write('<script src="js/change-order.js"><\/script>');
  document.write('<script src="js/change-order-disk.js"><\/script>');
  document.write('<script src="js/daily-logs.js"><\/script>');
  document.write('<script src="js/daily-logs-local-date.js"><\/script>');
  document.write('<script src="js/settings.js"><\/script>');
  document.write('<script src="js/settings-model-defaults.js"><\/script>');
  document.write('<script src="js/hardening.js"><\/script>');
  document.write('<script src="js/client-updates.js"><\/script>');
  document.write('<script src="js/pdf-loader-core.js"><\/script>');
})();
