import { NextResponse } from "next/server";
import { getCurrentUserAccount } from "@/server/auth";
import { prisma } from "@/server/db";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

type Params = {
  params: Promise<{ savedArtistId: string }>;
};

export async function DELETE(_: Request, context: Params) {
  try {
    const [visitorContext, user] = await Promise.all([getOrCreateVisitorSession(), getCurrentUserAccount()]);
    if (!user) {
      const response = NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
      return attachVisitorCookie(response, visitorContext);
    }

    const { savedArtistId } = await context.params;

    const deleted = await prisma.savedArtist.deleteMany({
      where: {
        id: savedArtistId,
        userAccountId: user.id,
      },
    });

    if (deleted.count === 0) {
      const response = NextResponse.json({ ok: false, message: "Saved artist not found." }, { status: 404 });
      return attachVisitorCookie(response, visitorContext);
    }

    const response = NextResponse.json({ ok: true });
    return attachVisitorCookie(response, visitorContext);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to remove saved artist.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
