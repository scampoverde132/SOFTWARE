/**
 * PlanTakeoff pre-app bootstrap.
 * Load disk-backed Jobs, Command Center, productivity/finalization, then PDF support.
 */
(function () {
  document.write('<script src="js/job-model.js"><\/script>');
  document.write('<script src="js/command-center.js"><\/script>');
  document.write('<script src="js/productivity.js"><\/script>');
  document.write('<script src="js/finalization.js"><\/script>');
  document.write('<script src="js/pdf-loader-core.js"><\/script>');
})();
