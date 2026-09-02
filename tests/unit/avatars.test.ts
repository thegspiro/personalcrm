import { access, mkdtemp, readdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AvatarConfigurationError,
  AvatarValidationError,
  MAX_AVATAR_BYTES,
  filenameFromAvatarPath,
  isAvatarFilename,
  readAvatarFile,
  removeAvatarFile,
  storeAvatar,
} from "@/server/services/avatars";
import { JPEG_MINIMAL, PNG_SIGNATURE_ONLY, PNG_TRANSPARENT, PNG_TRUNCATED, WEBP_MINIMAL } from "../fixtures/images";

/**
 * The service writes through fs/promises, so a write that fails mid-way —
 * the full-volume case — is simulated there rather than by filling a disk.
 */
const disk = vi.hoisted(() => ({ failWrites: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: (...args: Parameters<typeof actual.writeFile>) =>
      disk.failWrites
        ? Promise.reject(Object.assign(new Error("no space left on device"), { code: "ENOSPC" }))
        : actual.writeFile(...args),
  };
});

describe("avatar storage", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "personalcrm-avatars-"));
    process.env.UPLOADS_DIR = directory;
    disk.failWrites = false;
  });

  afterEach(async () => {
    delete process.env.UPLOADS_DIR;
    await rm(directory, { recursive: true, force: true });
  });

  it("uses content structure and a server-controlled persistent filename", async () => {
    const stored = await storeAvatar(new File([PNG_TRANSPARENT], "../../profile.exe", { type: "text/plain" }));

    expect(stored.filename).toMatch(/^[a-f0-9]{32}\.png$/);
    expect(stored.publicPath).toBe(`/api/avatars/${stored.filename}`);
    expect(new Uint8Array(await readFile(join(directory, stored.filename)))).toEqual(PNG_TRANSPARENT);
  });

  it("names the file by what the bytes are, whatever the upload claimed", async () => {
    expect((await storeAvatar(new File([JPEG_MINIMAL], "avatar.png", { type: "image/png" }))).filename).toMatch(/\.jpg$/);
    expect((await storeAvatar(new File([WEBP_MINIMAL], "avatar.jpg", { type: "image/jpeg" }))).filename).toMatch(/\.webp$/);
  });

  it("rejects invalid content even when headers and extension claim it is an image", async () => {
    await expect(
      storeAvatar(new File(["not an image"], "avatar.png", { type: "image/png" })),
    ).rejects.toThrow("Use a JPEG, PNG, or WebP image.");
  });

  it("rejects a file that only begins like an image, so a corrupt upload never replaces a good one", async () => {
    await expect(storeAvatar(new File([PNG_SIGNATURE_ONLY], "avatar.png"))).rejects.toThrow("incomplete or damaged");
    await expect(storeAvatar(new File([PNG_TRUNCATED], "avatar.png"))).rejects.toThrow("incomplete or damaged");
    expect(await readdir(directory)).toEqual([]);
  });

  it("rejects oversized files", async () => {
    await expect(
      storeAvatar(new File([new Uint8Array(MAX_AVATAR_BYTES + 1)], "large.png")),
    ).rejects.toThrow("2 MB or smaller");
  });

  it("refuses traversal and arbitrary database paths", async () => {
    expect(filenameFromAvatarPath("/api/avatars/../../secrets.json")).toBeNull();
    expect(isAvatarFilename("../secrets.json")).toBe(false);
    await expect(readAvatarFile("../secrets.json")).rejects.toThrow("Invalid avatar path");
  });

  it("refuses an uploads directory beneath anything Next serves", async () => {
    // public/ at the site root, and the build output under /_next/static.
    for (const inside of ["./public/uploads", "public", join(process.cwd(), "public", "avatars"), "./.next/static/avatars", ".next"]) {
      process.env.UPLOADS_DIR = inside;
      await expect(storeAvatar(new File([PNG_TRANSPARENT], "avatar.png"))).rejects.toBeInstanceOf(AvatarConfigurationError);
      await expect(readAvatarFile("0".repeat(32) + ".png")).rejects.toBeInstanceOf(AvatarConfigurationError);
    }
    // A sibling that merely starts with the same letters is fine.
    process.env.UPLOADS_DIR = join(directory, "publicity");
    await expect(storeAvatar(new File([PNG_TRANSPARENT], "avatar.png"))).resolves.toBeTruthy();
  });

  it("follows symlinks before deciding a directory is outside public/", async () => {
    // A link at an ancestor points the lexically innocent path into the
    // public tree; comparing without following it would write a private
    // photo where the static file server hands it to anyone.
    await symlink(join(process.cwd(), "public"), join(directory, "pub"));
    const inside = join(directory, "pub", `avatars-${Date.now().toString(36)}`);
    process.env.UPLOADS_DIR = inside;
    await expect(storeAvatar(new File([PNG_TRANSPARENT], "avatar.png"))).rejects.toBeInstanceOf(AvatarConfigurationError);
    await expect(readAvatarFile("0".repeat(32) + ".png")).rejects.toBeInstanceOf(AvatarConfigurationError);
    // Refused before anything was created on the far side of the link.
    await expect(access(inside)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("leaves nothing behind when the write itself fails", async () => {
    disk.failWrites = true;
    await expect(storeAvatar(new File([PNG_TRANSPARENT], "avatar.png"))).rejects.toThrow("no space left");
    expect(await readdir(directory)).toEqual([]);
  });

  it("removes stored avatars and tolerates an already absent file", async () => {
    const stored = await storeAvatar(new File([PNG_TRANSPARENT], "avatar.png"));
    await removeAvatarFile(stored.publicPath);
    await removeAvatarFile(stored.publicPath);
    await expect(readAvatarFile(stored.filename)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reads a stored avatar after a later request, matching volume persistence semantics", async () => {
    const stored = await storeAvatar(new File([PNG_TRANSPARENT], "avatar.png"));
    expect(new Uint8Array(await readAvatarFile(stored.filename))).toEqual(PNG_TRANSPARENT);
  });

  it("does not let a validation error stand in for a misconfiguration", () => {
    expect(new AvatarValidationError("x")).not.toBeInstanceOf(AvatarConfigurationError);
  });
});
