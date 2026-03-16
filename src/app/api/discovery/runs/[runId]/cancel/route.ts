import { NextResponse } from "next/server";
import { getCurrentUserAccount } from "@/server/auth";
import { requestDiscoveryRunCancellation } from "@/server/agent/jobs";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

type Params = {
  params: Promise<{ runId: string }>;
};

export async function POST(_request: Request, context: Params) {
  try {
    const { runId } = await context.params;
    const session = await getOrCreateVisitorSession();
    const userAccount = await getCurrentUserAccount();

    if (!userAccount) {
      const response = NextResponse.json({ ok: false, message: "Connect Last.fm before managing runs." }, { status: 401 });
      return attachVisitorCookie(response, session);
    }

    const result = await requestDiscoveryRunCancellation({
      runId,
      visitorSessionId: session.sessionId,
      userAccountId: userAccount.id,
    });

    const response = NextResponse.json(result, { status: result.status });
    return attachVisitorCookie(response, session);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to cancel run.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
