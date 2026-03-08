/**
 * Minimal spinner for async CLI operations.
 */

const FRAMES = ["   ", ".  ", ".. ", "..."];

export function createSpinner(message: string) {
  let i = 0;
  let id: ReturnType<typeof setInterval> | null = null;

  return {
    start() {
      process.stdout.write(`  ${message}${FRAMES[0]}`);
      id = setInterval(() => {
        i = (i + 1) % FRAMES.length;
        process.stdout.write(`\r  ${message}${FRAMES[i]}`);
      }, 250);
    },
    stop(final?: string) {
      if (id) clearInterval(id);
      process.stdout.write(`\r  ${final || message}${"".padEnd(10)}\n`);
    },
  };
}
