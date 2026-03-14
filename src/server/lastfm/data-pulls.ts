import { prisma } from "@/server/db";

export async function recordDataPull(params: {
  userAccountId: string;
  source: "weekly_backfill" | "recent_tail";
  status: "success" | "failed";
  windowFrom?: number | null;
  windowTo?: number | null;
  recordCount?: number | null;
  errorMessage?: string | null;
}): Promise<void> {
  await prisma.userDataPullLog.create({
    data: {
      userAccountId: params.userAccountId,
      source: params.source,
      status: params.status,
      windowFrom: params.windowFrom ?? null,
      windowTo: params.windowTo ?? null,
      recordCount: params.recordCount ?? null,
      errorMessage: params.errorMessage ?? null,
      pulledAt: new Date(),
    },
  });
}
