/**
 * Startup work, run once when the server process boots.
 *
 * Schema changes are applied before this by the container's init-migrate step;
 * this handles the things that need application code rather than SQL.
 */
export async function register() {
  // Next also loads this in the edge runtime, where none of it applies.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { runStartupTasks } = await import("@/server/startup");
  await runStartupTasks();
}
