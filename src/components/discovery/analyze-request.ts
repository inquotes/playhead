import type { AnalyzeDiscoveryRequest } from "@/lib/discovery-contracts";
import type { RangeOptionId } from "./types";

type CustomRange = {
  startYear: number | null;
  startMonth: number | null;
  endYear: number | null;
  endMonth: number | null;
};

export function buildAnalyzeRequest(params: {
  preset: RangeOptionId;
  customRange: CustomRange;
  targetUsername: string | null;
}): AnalyzeDiscoveryRequest {
  const target = params.targetUsername
    ? { targetUsername: params.targetUsername }
    : {};

  if (params.preset !== "custom") {
    return { preset: params.preset, ...target };
  }

  const { startYear, startMonth, endYear, endMonth } = params.customRange;
  if (!startYear || !startMonth || !endYear || !endMonth) {
    throw new Error("Please choose a valid start and end month.");
  }

  const startKey = startYear * 100 + startMonth;
  const endKey = endYear * 100 + endMonth;
  if (startKey > endKey) {
    throw new Error("Please choose a valid start and end month.");
  }

  return {
    preset: "custom",
    from: Math.floor(Date.UTC(startYear, startMonth - 1, 1, 0, 0, 0) / 1000),
    to: Math.floor(Date.UTC(endYear, endMonth, 0, 23, 59, 59) / 1000),
    ...target,
  };
}
