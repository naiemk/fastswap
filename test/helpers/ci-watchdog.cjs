/** Unref'd so it cannot keep Mocha alive; still fires while other handles hang. */
if (process.env.CI) {
  const maxMs = Number(process.env.FASTSWAP_TEST_MAX_MS ?? 8 * 60 * 1000);
  const started = Date.now();
  const timer = setInterval(() => {
    if (Date.now() - started > maxMs) {
      console.error(`[ci-watchdog] tests still running after ${maxMs}ms — exiting`);
      process.exit(1);
    }
  }, 5_000);
  timer.unref();
}
