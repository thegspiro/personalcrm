import "server-only";
import { prisma } from "./client";

export const SETUP_COMPLETED_KEY = "setup.completed";

export async function getAppSetting<T>(key: string): Promise<T | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row ? (row.value as T) : null;
}

export async function setAppSetting(key: string, value: unknown): Promise<void> {
  const json = value as never;
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: json },
    update: { value: json },
  });
}

/**
 * Setup is complete once at least one user exists. The AppSetting row is a fast
 * path so the common case avoids counting users on every request.
 */
export async function isSetupComplete(): Promise<boolean> {
  if (await getAppSetting<boolean>(SETUP_COMPLETED_KEY)) return true;
  const count = await prisma.user.count();
  if (count > 0) {
    await setAppSetting(SETUP_COMPLETED_KEY, true);
    return true;
  }
  return false;
}
