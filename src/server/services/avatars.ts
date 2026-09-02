import "server-only";

import { randomBytes } from "node:crypto";
import { mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const FILE_NAME = /^[a-f0-9]{32}\.(?:jpg|png|webp)$/;

export class AvatarValidationError extends Error {}

export function uploadsDirectory(): string {
  return resolve(process.env.UPLOADS_DIR?.trim() || "/config/uploads");
}

function insideUploads(filename: string): string {
  if (!FILE_NAME.test(filename) || basename(filename) !== filename) {
    throw new AvatarValidationError("Invalid avatar path.");
  }
  const root = uploadsDirectory();
  const candidate = resolve(root, filename);
  if (!candidate.startsWith(`${root}${sep}`)) throw new AvatarValidationError("Invalid avatar path.");
  return candidate;
}

function imageExtension(bytes: Uint8Array): "jpg" | "png" | "webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "png";
  if (
    bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
  ) return "webp";
  return null;
}

export interface StagedAvatar {
  filename: string;
  publicPath: string;
}

/** Validate bytes, then publish a randomly named file with exclusive creation. */
export async function storeAvatar(file: File): Promise<StagedAvatar> {
  if (file.size === 0) throw new AvatarValidationError("Choose a non-empty image.");
  if (file.size > MAX_AVATAR_BYTES) throw new AvatarValidationError("Avatar images must be 2 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_AVATAR_BYTES) throw new AvatarValidationError("Avatar images must be 2 MB or smaller.");
  const extension = imageExtension(bytes);
  if (!extension) throw new AvatarValidationError("Use a JPEG, PNG, or WebP image.");

  const root = uploadsDirectory();
  await mkdir(root, { recursive: true, mode: 0o750 });
  const filename = `${randomBytes(16).toString("hex")}.${extension}`;
  const finalPath = insideUploads(filename);
  const temporary = `${finalPath}.tmp-${randomBytes(8).toString("hex")}`;
  const handle = await open(temporary, "wx", 0o640);
  try {
    await writeFile(handle, bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, finalPath);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return { filename, publicPath: `/api/avatars/${filename}` };
}

export function filenameFromAvatarPath(publicPath: string | null): string | null {
  if (!publicPath) return null;
  const prefix = "/api/avatars/";
  if (!publicPath.startsWith(prefix)) return null;
  const filename = publicPath.slice(prefix.length);
  return FILE_NAME.test(filename) ? filename : null;
}

export async function removeAvatarFile(publicPath: string | null): Promise<void> {
  const filename = filenameFromAvatarPath(publicPath);
  if (!filename) return;
  await unlink(insideUploads(filename)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export async function readAvatarFile(filename: string): Promise<Buffer> {
  const handle = await open(insideUploads(filename), "r");
  try {
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
