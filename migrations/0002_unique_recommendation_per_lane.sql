UPDATE "SavedArtist"
SET "savedFromRecommendationRunId" = (
  SELECT survivor."id"
  FROM "RecommendationRun" AS discarded
  JOIN "RecommendationRun" AS survivor
    ON survivor."analysisRunId" = discarded."analysisRunId"
    AND survivor."selectedLane" = discarded."selectedLane"
  WHERE discarded."id" = "SavedArtist"."savedFromRecommendationRunId"
  ORDER BY survivor."createdAt" DESC, survivor."id" DESC
  LIMIT 1
)
WHERE "savedFromRecommendationRunId" IN (
  SELECT discarded."id"
  FROM "RecommendationRun" AS discarded
  WHERE EXISTS (
    SELECT 1
    FROM "RecommendationRun" AS newer
    WHERE newer."analysisRunId" = discarded."analysisRunId"
      AND newer."selectedLane" = discarded."selectedLane"
      AND (
        newer."createdAt" > discarded."createdAt"
        OR (
          newer."createdAt" = discarded."createdAt"
          AND newer."id" > discarded."id"
        )
      )
  )
);

DELETE FROM "RecommendationRun"
WHERE EXISTS (
  SELECT 1
  FROM "RecommendationRun" AS newer
  WHERE newer."analysisRunId" = "RecommendationRun"."analysisRunId"
    AND newer."selectedLane" = "RecommendationRun"."selectedLane"
    AND (
      newer."createdAt" > "RecommendationRun"."createdAt"
      OR (
        newer."createdAt" = "RecommendationRun"."createdAt"
        AND newer."id" > "RecommendationRun"."id"
      )
    )
);

CREATE UNIQUE INDEX "RecommendationRun_analysisRunId_selectedLane_key"
ON "RecommendationRun"("analysisRunId", "selectedLane");
