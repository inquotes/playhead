export type RangePreset = "7d" | "1m" | "6m" | "1y" | "summer2025" | "custom";

export function resolveRange(input: {
  preset: RangePreset;
  from?: number;
  to?: number;
}): { from: number; to: number; label: string } {
  const now = Math.floor(Date.now() / 1000);

  if (input.preset === "custom") {
    if (!input.from || !input.to || input.from >= input.to) {
      throw new Error("Invalid custom range.");
    }
    return { from: input.from, to: input.to, label: "Custom range" };
  }

  if (input.preset === "summer2025") {
    const from = Math.floor(new Date("2025-06-01T00:00:00Z").getTime() / 1000);
    const to = Math.floor(new Date("2025-08-31T23:59:59Z").getTime() / 1000);
    return { from, to, label: "Summer 2025" };
  }

  const day = 86400;
  const map: Record<Exclude<RangePreset, "custom" | "summer2025">, { seconds: number; label: string }> = {
    "7d": { seconds: day * 7, label: "Last 7 days" },
    "1m": { seconds: day * 30, label: "Last month" },
    "6m": { seconds: day * 182, label: "Last 6 months" },
    "1y": { seconds: day * 365, label: "Last year" },
  };

  const selected = map[input.preset as Exclude<RangePreset, "custom" | "summer2025">];
  return {
    from: now - selected.seconds,
    to: now,
    label: selected.label,
  };
}
