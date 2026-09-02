import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { getPrivacyState } from "@/server/privacy/lock";
import { readAvatarFile } from "@/server/services/avatars";

export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse(null, { status: 404 });

  const { filename } = await params;
  const publicPath = `/api/avatars/${filename}`;
  const privacy = await getPrivacyState();
  const contact = await prisma.contact.findFirst({
    where: {
      ownerId: user.id,
      avatarPath: publicPath,
      ...(privacy.enabled && !privacy.unlocked ? { isPrivate: false } : {}),
    },
    select: { id: true },
  });
  if (!contact) return new NextResponse(null, { status: 404 });

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
    return new NextResponse(null, { status: 404 });
  }
}
