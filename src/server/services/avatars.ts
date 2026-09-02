import "server-only";

import { randomBytes } from "node:crypto";
import { mkdir, open, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { inspectImage } from "@/lib/image-format";

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const FILE_NAME = /^[a-f0-9]{32}\.(?:jpg|png|webp)$/;
const PUBLIC_PREFIX = "/api/avatars/";

/** The upload was refused for a reason the person can act on. */
export class AvatarValidationError extends Error {}

/** The installation is misconfigured; nothing about the upload would help. */
export class AvatarConfigurationError extends Error {}

/** A name this server generated, and nothing else, is worth looking up. */
export function isAvatarFilename(filename: string): boolean {
  return FILE_NAME.test(filename);
}

/**
 * The path with every symlink followed, for a path that need not exist yet:
 * the deepest ancestor that does exist is canonicalised and the rest is
 * joined back on. Nothing is created along the way.
 */
async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) return path;
    return join(await canonical(parent), basename(path));
  }
}

/**
 * The directories Next serves as static files, relative to the working
 * directory: `public/` at the site root, and the build output, whose
 * `static/` subtree is served under `/_next/static`. The whole build
 * directory is refused rather than just that subtree; nothing that is not
 * ours to write belongs anywhere in it.
 */
const SERVED_ROOTS = ["public", ".next"];

/**
 * Where avatar bytes live. Never under a directory Next serves: everything
 * there is handed to anyone who knows the name, without the session, owner
 * or privacy-lock checks the avatar route exists to apply — immediately in
 * development, and after the next restart in production. The documentation
 * says so; this is what makes it true.
 *
 * Compared after following symlinks on both sides, and before anything is
 * created: a lexical comparison would pass `/config/uploads` while a link at
 * `/config` pointed it straight into the public tree.
 */
export async function uploadsDirectory(): Promise<string> {
  const root = await canonical(resolve(process.env.UPLOADS_DIR?.trim() || "/config/uploads"));
  for (const name of SERVED_ROOTS) {
    const served = await canonical(resolve(process.cwd(), name));
    if (root === served || root.startsWith(`${served}${sep}`)) {
      throw new AvatarConfigurationError(
        `UPLOADS_DIR must not be inside ${served}: files there are served without any access check.`,
      );
    }
  }
  return root;
}

async function insideUploads(filename: string): Promise<string> {
  if (!FILE_NAME.test(filename) || basename(filename) !== filename) {
    throw new AvatarValidationError("Invalid avatar path.");
  }
  const root = await uploadsDirectory();
  const candidate = resolve(root, filename);
  if (!candidate.startsWith(`${root}${sep}`)) throw new AvatarValidationError("Invalid avatar path.");
  return candidate;
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
  if (bytes.byteLength === 0) throw new AvatarValidationError("Choose a non-empty image.");
  if (bytes.byteLength > MAX_AVATAR_BYTES) throw new AvatarValidationError("Avatar images must be 2 MB or smaller.");
  const image = inspectImage(bytes);
  if (!image.ok) {
    throw new AvatarValidationError(
      image.reason === "unrecognised"
        ? "Use a JPEG, PNG, or WebP image."
        : "That image is incomplete or damaged. Try exporting it again.",
    );
  }

  const root = await uploadsDirectory();
  await mkdir(root, { recursive: true, mode: 0o750 });
  const filename = `${randomBytes(16).toString("hex")}.${image.format}`;
  const finalPath = await insideUploads(filename);
  const temporary = `${finalPath}.tmp-${randomBytes(8).toString("hex")}`;
  const handle = await open(temporary, "wx", 0o640);
  try {
    try {
      await writeFile(handle, bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, finalPath);
  } catch (error) {
    // Whatever failed once the file was open — a full volume as readily as a
    // failed rename — nothing half-written stays behind to fill it further.
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return { filename, publicPath: `${PUBLIC_PREFIX}${filename}` };
}

export function filenameFromAvatarPath(publicPath: string | null): string | null {
  if (!publicPath) return null;
  if (!publicPath.startsWith(PUBLIC_PREFIX)) return null;
  const filename = publicPath.slice(PUBLIC_PREFIX.length);
  return FILE_NAME.test(filename) ? filename : null;
}

export async function removeAvatarFile(publicPath: string | null): Promise<void> {
  const filename = filenameFromAvatarPath(publicPath);
  if (!filename) return;
  await unlink(await insideUploads(filename)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export async function readAvatarFile(filename: string): Promise<Buffer> {
  const handle = await open(await insideUploads(filename), "r");
  try {
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
