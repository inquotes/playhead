"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type UpdateNowResponse = {
  ok: boolean;
  message?: string;
};

export function UpdateNowButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function updateNow() {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/profile/update-now", { method: "POST" });
      const data = (await response.json()) as UpdateNowResponse;
      if (!response.ok || data.ok === false) {
        throw new Error(data.message ?? "Failed to refresh profile data.");
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh profile data.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mp-update-now-wrap">
      <button className="mp-button mp-button-ghost mp-button-compact" onClick={() => void updateNow()} disabled={busy}>
        {busy ? "Updating..." : "Update now"}
      </button>
      {error && <p className="mp-inline-error">{error}</p>}
    </div>
  );
}
