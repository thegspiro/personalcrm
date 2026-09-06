import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser, hashSessionToken, SESSION_COOKIE } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { findVisibleAvatarContact } from "@/server/queries/avatars";
import { isAvatarFilename, readAvatarFile } from "@/server/services/avatars";

export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Every refusal looks the same: whether a file exists is itself a disclosure. */
function notFound() {
  return new NextResponse(null, { status: 404 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;
  if (!isAvatarFilename(filename)) return notFound();

  const user = await getCurrentUser();
  if (!user) return notFound();

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const contact = await findVisibleAvatarContact(prisma, {
    ownerId: user.id,
    publicPath: `/api/avatars/${filename}`,
    sessionTokenHash: token ? hashSessionToken(token) : null,
  });
  if (!contact) return notFound();

  try {
    const bytes = await readAvatarFile(filename);
    const extension = filename.slice(filename.lastIndexOf(".") + 1);
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new NextResponse(body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": CONTENT_TYPES[extension] ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return notFound();
  }
}
