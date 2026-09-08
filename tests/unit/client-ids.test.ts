import { afterEach, describe, expect, it, vi } from "vitest";
import { clientRowId } from "@/lib/client-ids";

describe("client row ids", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is unique across calls", () => {
    const ids = new Set(Array.from({ length: 500 }, () => clientRowId()));
    expect(ids.size).toBe(500);
  });

  /**
   * The reason this helper exists. `crypto.randomUUID` is exposed only in a
   * secure context, and this project's own documented deployment — an Unraid
   * WebUI on `http://[IP]:3000` — is not one. Calling it while rendering an
   * editor threw before the form appeared, on exactly the self-hosted setups
   * the app is built for.
   */
  it("still returns an id where randomUUID is not exposed", () => {
    vi.stubGlobal("crypto", {});
    const ids = new Set(Array.from({ length: 500 }, () => clientRowId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^row-/);
  });

  it("survives crypto being absent altogether", () => {
    vi.stubGlobal("crypto", undefined);
    expect(clientRowId()).toMatch(/^row-/);
  });
});
