const shutdownHandlers = [];

export const onShutdown = (fn) => {
  shutdownHandlers.push(fn);
};

const runShutdown = async () => {
  for (const fn of shutdownHandlers) {
    try {
      await fn();
    } catch { /* best effort */ }
  }
};

let shutdownStarted = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    await runShutdown();
    process.exit(0);
  });
}

process.on("beforeExit", async () => {
  if (shutdownStarted) return;
  shutdownStarted = true;
  await runShutdown();
});
