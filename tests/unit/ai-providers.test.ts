import { describe, expect, it } from "vitest";
import { extractJson, providerById, PROVIDERS } from "@/server/ai/providers";

/**
 * The provider-neutral layer.
 *
 * Reading a reply is the part most likely to bite: a smaller self-hosted model
 * wraps its JSON in prose or fences far more often than a hosted one, and
 * being forgiving here is the difference between "it works" and "it never
 * seems to do anything".
 */
describe("extractJson", () => {
  it("reads a bare object", () => {
    expect(extractJson('{"title":"Coffee"}')).toEqual({ title: "Coffee" });
  });

  it("reads one wrapped in a code fence", () => {
    expect(extractJson('```json\n{"title":"Coffee"}\n```')).toEqual({ title: "Coffee" });
    expect(extractJson('```\n{"title":"Coffee"}\n```')).toEqual({ title: "Coffee" });
  });

  it("reads one buried in prose", () => {
    const reply = 'Sure! Here is the result:\n\n{"title":"Coffee","notes":null}\n\nHope that helps.';
    expect(extractJson(reply)).toEqual({ title: "Coffee", notes: null });
  });

  it("handles nested objects when digging it out of prose", () => {
    const reply = 'Result: {"a":{"b":1},"c":[1,2]} done';
    expect(extractJson(reply)).toEqual({ a: { b: 1 }, c: [1, 2] });
  });

  it("returns null rather than throwing on nonsense", () => {
    expect(extractJson("I'm not going to do that")).toBeNull();
    expect(extractJson("")).toBeNull();
    expect(extractJson("   ")).toBeNull();
    expect(extractJson("{ this is not json }")).toBeNull();
  });

  it("does not accept a bare array or string as the answer", () => {
    // The caller expects an object; anything else is a failed reading, and a
    // failed reading must fall back to the local parse.
    expect(extractJson("[1,2,3]")).toBeNull();
    expect(extractJson('"just a string"')).toBeNull();
  });
});

describe("providers", () => {
  it("offers a self-hosted option alongside the hosted ones", () => {
    const ids = PROVIDERS.map((provider) => provider.id);
    expect(ids).toContain("openai");
    expect(ids).toContain("anthropic");
    expect(ids).toContain("google");
    expect(ids).toContain("custom");
  });

  it("only lets you edit the endpoint where that makes sense", () => {
    // Pointing "OpenAI" at an arbitrary host would be a footgun; a self-hosted
    // endpoint is nothing but its address.
    expect(providerById("openai")?.baseUrlEditable).toBe(false);
    expect(providerById("custom")?.baseUrlEditable).toBe(true);
  });

  it("does not demand a key for a self-hosted endpoint", () => {
    // A box on your own network often has no auth at all.
    expect(providerById("custom")?.keyRequired).toBe(false);
    expect(providerById("openai")?.keyRequired).toBe(true);
  });

  it("speaks the OpenAI dialect to everything except Anthropic", () => {
    for (const provider of PROVIDERS) {
      expect(provider.dialect).toBe(provider.id === "anthropic" ? "anthropic" : "openai");
    }
  });

  it("gives every provider a model suggestion to start from", () => {
    for (const provider of PROVIDERS) {
      expect(provider.suggestedModels.length, provider.id).toBeGreaterThan(0);
      expect(provider.defaultBaseUrl, provider.id).toMatch(/^https?:\/\//);
    }
  });

  it("returns null for something it does not know", () => {
    expect(providerById("nonsense")).toBeNull();
  });
});
