/**
 * What `@/server/startup` becomes in the edge bundle.
 *
 * `src/middleware.ts` runs on the edge runtime, which makes Next compile
 * `instrumentation.ts` for that runtime as well. The guard there already stops
 * the boot tasks running on edge, but webpack still resolves the import to
 * build a chunk — and the real module reaches nodemailer, node-cron and
 * bcryptjs, none of which can be bundled where `node:net` and `node:crypto`
 * do not exist.
 *
 * Substituted by a `NormalModuleReplacementPlugin` in `next.config.ts`. If this
 * is ever actually called, the guard in `instrumentation.ts` has been removed
 * and the boot tasks are silently not running, so it says so rather than
 * resolving quietly.
 */
export async function runStartupTasks(): Promise<void> {
  throw new Error(
    "runStartupTasks was called on the edge runtime, where it cannot work. " +
      "The NEXT_RUNTIME guard in src/instrumentation.ts is what normally prevents this.",
  );
}
