"use client";

import { useState } from "react";

export function LogoutButton() {
  const [busy, setBusy] = useState(false);

  async function onLogout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
    } finally {
      window.location.href = "/";
    }
  }

  return (
    <button className="mp-button mp-button-primary" onClick={onLogout} disabled={busy}>
      {busy ? "Logging out..." : "Log Out"}
    </button>
  );
}
