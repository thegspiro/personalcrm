import { z } from "zod";

/**
 * The links on a dating profile — where you met them, where they post.
 *
 * The column has existed since the first migration and `docs/data-model.md`
 * has described its shape all along; nothing ever read or wrote it. So the
 * validation runs on the way *out* as well as in: whatever is already in the
 * column arrived there without ever passing a check.
 */

/**
 * Only `http:` and `https:`, and this is the security half of the feature
 * rather than tidiness. These values are rendered as an anchor's `href`, and a
 * stored `javascript:` URL is a self-XSS that survives every reload — React
 * escapes text, not schemes.
 */
function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export const profileLinkSchema = z.object({
  label: z.string().trim().min(1).max(80),
  url: z
    .string()
    .trim()
    .max(500)
    .refine(isHttpUrl, { message: "Links must start with http:// or https://." }),
});

export const profileLinksSchema = z.array(profileLinkSchema).max(20);

export type ProfileLink = z.infer<typeof profileLinkSchema>;

/** JSON columns accept any shape; keep malformed values out of the UI. */
export function readProfileLinks(value: unknown): ProfileLink[] {
  const parsed = profileLinksSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}
