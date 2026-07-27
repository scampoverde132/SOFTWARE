/**
 * PlanTakeoff pre-app bootstrap.
 * Load disk-backed Jobs, Command Center, productivity/finalization/change orders,
 * daily logs/client updates, then the unchanged PDF implementation.
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
  document.write('<script src="js/client-updates.js"><\/script>');
  document.write('<script src="js/pdf-loader-core.js"><\/script>');
})();
