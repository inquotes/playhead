import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execCb);

async function run() {
  const appOrigin = (process.env.APP_ORIGIN ?? "https://play-head.com").replace(/\/$/, "");
  const sweepUrl = `${appOrigin}/api/internal/jobs/discovery-runs/stale-sweeper`;
  const headers = {};

  if (process.env.QUEUE_PROCESS_SECRET) {
    headers["x-queue-secret"] = process.env.QUEUE_PROCESS_SECRET;
  }

  console.log(`[smoke] Running stale-run sweep: ${sweepUrl}`);
  const sweepResponse = await fetch(sweepUrl, { method: "POST", headers });
  const sweepBody = await sweepResponse.text();

  if (!sweepResponse.ok) {
    throw new Error(`Stale-run sweep failed (${sweepResponse.status}): ${sweepBody}`);
  }

  console.log("[smoke] Sweep response:");
  console.log(sweepBody);

  if (process.env.SKIP_D1_QUERY === "1") {
    console.log("[smoke] Skipping D1 status query (SKIP_D1_QUERY=1).");
    return;
  }

  const sql = "SELECT status, COUNT(*) AS count FROM AgentRun WHERE status IN ('queued','running','cancel_requested') GROUP BY status ORDER BY status;";
  const queryCommand = `npx wrangler d1 execute playhead-db --remote --command \"${sql}\"`;

  console.log("[smoke] Running D1 active-run query...");
  try {
    const { stdout, stderr } = await exec(queryCommand, { cwd: process.cwd() });
    if (stdout.trim()) {
      console.log(stdout.trim());
    }
    if (stderr.trim()) {
      console.log(stderr.trim());
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown D1 query error";
    console.log(`[smoke] D1 query skipped/failed: ${message}`);
    console.log("[smoke] Sweep already completed successfully.");
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : "Discovery smoke check failed.";
  console.error(`[smoke] ${message}`);
  process.exit(1);
});
