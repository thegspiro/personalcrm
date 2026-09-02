import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AvatarValidationError,
  MAX_AVATAR_BYTES,
  filenameFromAvatarPath,
  readAvatarFile,
  removeAvatarFile,
  storeAvatar,
} from "@/server/services/avatars";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("avatar storage", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "personalcrm-avatars-"));
    process.env.UPLOADS_DIR = directory;
  });

  afterEach(async () => {
    delete process.env.UPLOADS_DIR;
    await rm(directory, { recursive: true, force: true });
  });

  it("uses content signatures and a server-controlled persistent filename", async () => {
    const stored = await storeAvatar(new File([PNG], "../../profile.exe", { type: "text/plain" }));

    expect(stored.filename).toMatch(/^[a-f0-9]{32}\.png$/);
    expect(stored.publicPath).toBe(`/api/avatars/${stored.filename}`);
    expect(new Uint8Array(await readFile(join(directory, stored.filename)))).toEqual(PNG);
  });

  it("rejects invalid content even when headers and extension claim it is an image", async () => {
    await expect(
      storeAvatar(new File(["not an image"], "avatar.png", { type: "image/png" })),
    ).rejects.toBeInstanceOf(AvatarValidationError);
  });

  it("rejects oversized files", async () => {
    await expect(
      storeAvatar(new File([new Uint8Array(MAX_AVATAR_BYTES + 1)], "large.png")),
    ).rejects.toThrow("2 MB or smaller");
  });

  it("refuses traversal and arbitrary database paths", async () => {
    expect(filenameFromAvatarPath("/api/avatars/../../secrets.json")).toBeNull();
    await expect(readAvatarFile("../secrets.json")).rejects.toThrow("Invalid avatar path");
  });

  it("removes stored avatars and tolerates an already absent file", async () => {
    const stored = await storeAvatar(new File([PNG], "avatar.png"));
    await removeAvatarFile(stored.publicPath);
    await removeAvatarFile(stored.publicPath);
    await expect(readAvatarFile(stored.filename)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reads a stored avatar after a later request, matching volume persistence semantics", async () => {
    const stored = await storeAvatar(new File([PNG], "avatar.png"));
    expect(new Uint8Array(await readAvatarFile(stored.filename))).toEqual(PNG);
  });
});
