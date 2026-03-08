export type RangePreset = "7d" | "1m" | "6m" | "1y" | "custom";

function formatMonthYear(timestampSec: number): string {
  const date = new Date(timestampSec * 1000);
  return date.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

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

    const start = formatMonthYear(input.from);
    const end = formatMonthYear(input.to);
    const label = start === end ? start : `${start} to ${end}`;

    return { from: input.from, to: input.to, label };
  }

  const day = 86400;
  const map: Record<Exclude<RangePreset, "custom">, { seconds: number; label: string }> = {
    "7d": { seconds: day * 7, label: "Last 7 days" },
    "1m": { seconds: day * 30, label: "Last month" },
    "6m": { seconds: day * 182, label: "Last 6 months" },
    "1y": { seconds: day * 365, label: "Last year" },
  };

  const selected = map[input.preset as Exclude<RangePreset, "custom">];
  return {
    from: now - selected.seconds,
    to: now,
    label: selected.label,
  };
}
