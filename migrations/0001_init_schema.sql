-- CreateTable
CREATE TABLE "VisitorSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userAccountId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VisitorSession_userAccountId_fkey" FOREIGN KEY ("userAccountId") REFERENCES "UserAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lastfmUsername" TEXT NOT NULL,
    "lastfmSessionKey" TEXT,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "lastLoginAt" DATETIME,
    "loginCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userAccountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "lastActiveAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthSession_userAccountId_fkey" FOREIGN KEY ("userAccountId") REFERENCES "UserAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnalysisRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "visitorSessionId" TEXT NOT NULL,
    "userAccountId" TEXT,
    "targetLastfmUsername" TEXT,
    "rangeStart" INTEGER NOT NULL,
    "rangeEnd" INTEGER NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "artistsJson" JSONB NOT NULL,
    "tracksJson" JSONB NOT NULL,
    "heardArtistsJson" JSONB NOT NULL,
    "lanesJson" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnalysisRun_visitorSessionId_fkey" FOREIGN KEY ("visitorSessionId") REFERENCES "VisitorSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AnalysisRun_userAccountId_fkey" FOREIGN KEY ("userAccountId") REFERENCES "UserAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecommendationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "visitorSessionId" TEXT NOT NULL,
    "userAccountId" TEXT,
    "targetLastfmUsername" TEXT,
    "analysisRunId" TEXT NOT NULL,
    "selectedLane" TEXT NOT NULL,
    "newOnly" BOOLEAN NOT NULL DEFAULT false,
    "resultsJson" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecommendationRun_visitorSessionId_fkey" FOREIGN KEY ("visitorSessionId") REFERENCES "VisitorSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RecommendationRun_userAccountId_fkey" FOREIGN KEY ("userAccountId") REFERENCES "UserAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RecommendationRun_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "AnalysisRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "visitorSessionId" TEXT NOT NULL,
    "userAccountId" TEXT,
    "targetLastfmUsername" TEXT,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "requestJson" JSONB NOT NULL,
    "resultJson" JSONB,
    "errorMessage" TEXT,
    "toolCallsUsed" INTEGER NOT NULL DEFAULT 0,
    "maxToolCalls" INTEGER NOT NULL DEFAULT 10,
    "timeoutMs" INTEGER NOT NULL,
    "terminationReason" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentRun_visitorSessionId_fkey" FOREIGN KEY ("visitorSessionId") REFERENCES "VisitorSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentRun_userAccountId_fkey" FOREIGN KEY ("userAccountId") REFERENCES "UserAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentRunEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentRunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LastfmApiCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cacheKey" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "paramsJson" JSONB NOT NULL,
    "dataJson" JSONB NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "lastAccessedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SavedArtist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userAccountId" TEXT NOT NULL,
    "artistName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "savedFromRecommendationRunId" TEXT,
    "savedFromAnalysisRunId" TEXT,
    "savedFromLaneId" TEXT,
    "savedFromTargetUsername" TEXT,
    "knownPlaycountAtSave" INTEGER,
    "knownArtistAtSave" BOOLEAN,
    "recommendationContextJson" JSONB,
    "savedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SavedArtist_userAccountId_fkey" FOREIGN KEY ("userAccountId") REFERENCES "UserAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserWeeklyListeningState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userAccountId" TEXT NOT NULL,
    "lastfmUsername" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "weeksDiscovered" INTEGER NOT NULL DEFAULT 0,
    "weeksProcessed" INTEGER NOT NULL DEFAULT 0,
    "newestWeekStart" INTEGER,
    "oldestWeekStart" INTEGER,
    "lastProcessedWeekStart" INTEGER,
    "lastProcessedWeekEnd" INTEGER,
    "recentYearReadyAt" DATETIME,
    "fullHistoryReadyAt" DATETIME,
    "lastAttemptAt" DATETIME,
    "lastSuccessAt" DATETIME,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserWeeklyListeningState_userAccountId_fkey" FOREIGN KEY ("userAccountId") REFERENCES "UserAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserWeeklyArtistPlaycount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userAccountId" TEXT NOT NULL,
    "weekStart" INTEGER NOT NULL,
    "weekEnd" INTEGER NOT NULL,
    "artistName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "playcount" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserWeeklyArtistPlaycount_userAccountId_fkey" FOREIGN KEY ("userAccountId") REFERENCES "UserAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserWeeklyIngestedWeek" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userAccountId" TEXT NOT NULL,
    "weekStart" INTEGER NOT NULL,
    "weekEnd" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'done',
    "artistCount" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "lastAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserWeeklyIngestedWeek_userAccountId_fkey" FOREIGN KEY ("userAccountId") REFERENCES "UserAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserWeeklyBackfillJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userAccountId" TEXT NOT NULL,
    "lastfmUsername" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "nextRunAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockToken" TEXT,
    "lockExpiresAt" DATETIME,
    "lastHeartbeatAt" DATETIME,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserWeeklyBackfillJob_userAccountId_fkey" FOREIGN KEY ("userAccountId") REFERENCES "UserAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserKnownArtistRollup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userAccountId" TEXT NOT NULL,
    "artistName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "playcount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserKnownArtistRollup_userAccountId_fkey" FOREIGN KEY ("userAccountId") REFERENCES "UserAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserRecentTailState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userAccountId" TEXT NOT NULL,
    "lastfmUsername" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "latestWeeklyBoundary" INTEGER,
    "tailFrom" INTEGER,
    "tailTo" INTEGER,
    "artistCount" INTEGER NOT NULL DEFAULT 0,
    "lastPullStartedAt" DATETIME,
    "lastPullCompletedAt" DATETIME,
    "lastErrorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserRecentTailState_userAccountId_fkey" FOREIGN KEY ("userAccountId") REFERENCES "UserAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserRecentTailArtistCount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userAccountId" TEXT NOT NULL,
    "artistName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "playcount" INTEGER NOT NULL,
    "tailFrom" INTEGER NOT NULL,
    "tailTo" INTEGER NOT NULL,
    "pulledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserRecentTailArtistCount_userAccountId_fkey" FOREIGN KEY ("userAccountId") REFERENCES "UserAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserDataPullLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userAccountId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'success',
    "windowFrom" INTEGER,
    "windowTo" INTEGER,
    "recordCount" INTEGER,
    "errorMessage" TEXT,
    "pulledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserDataPullLog_userAccountId_fkey" FOREIGN KEY ("userAccountId") REFERENCES "UserAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "UserAccount_lastfmUsername_key" ON "UserAccount"("lastfmUsername");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userAccountId_idx" ON "AuthSession"("userAccountId");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- CreateIndex
CREATE INDEX "AnalysisRun_userAccountId_createdAt_idx" ON "AnalysisRun"("userAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "AnalysisRun_targetLastfmUsername_createdAt_idx" ON "AnalysisRun"("targetLastfmUsername", "createdAt");

-- CreateIndex
CREATE INDEX "RecommendationRun_analysisRunId_createdAt_idx" ON "RecommendationRun"("analysisRunId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_userAccountId_createdAt_idx" ON "AgentRun"("userAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRunEvent_runId_seq_idx" ON "AgentRunEvent"("runId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "LastfmApiCache_cacheKey_key" ON "LastfmApiCache"("cacheKey");

-- CreateIndex
CREATE INDEX "LastfmApiCache_scope_method_idx" ON "LastfmApiCache"("scope", "method");

-- CreateIndex
CREATE INDEX "LastfmApiCache_expiresAt_idx" ON "LastfmApiCache"("expiresAt");

-- CreateIndex
CREATE INDEX "SavedArtist_userAccountId_savedAt_idx" ON "SavedArtist"("userAccountId", "savedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedArtist_userAccountId_normalizedName_key" ON "SavedArtist"("userAccountId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "UserWeeklyListeningState_userAccountId_key" ON "UserWeeklyListeningState"("userAccountId");

-- CreateIndex
CREATE INDEX "UserWeeklyArtistPlaycount_userAccountId_weekStart_idx" ON "UserWeeklyArtistPlaycount"("userAccountId", "weekStart");

-- CreateIndex
CREATE INDEX "UserWeeklyArtistPlaycount_userAccountId_normalizedName_idx" ON "UserWeeklyArtistPlaycount"("userAccountId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "UserWeeklyArtistPlaycount_userAccountId_weekStart_weekEnd_normalizedName_key" ON "UserWeeklyArtistPlaycount"("userAccountId", "weekStart", "weekEnd", "normalizedName");

-- CreateIndex
CREATE INDEX "UserWeeklyIngestedWeek_userAccountId_status_idx" ON "UserWeeklyIngestedWeek"("userAccountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "UserWeeklyIngestedWeek_userAccountId_weekStart_weekEnd_key" ON "UserWeeklyIngestedWeek"("userAccountId", "weekStart", "weekEnd");

-- CreateIndex
CREATE UNIQUE INDEX "UserWeeklyBackfillJob_userAccountId_key" ON "UserWeeklyBackfillJob"("userAccountId");

-- CreateIndex
CREATE INDEX "UserWeeklyBackfillJob_status_nextRunAt_idx" ON "UserWeeklyBackfillJob"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "UserWeeklyBackfillJob_lockExpiresAt_idx" ON "UserWeeklyBackfillJob"("lockExpiresAt");

-- CreateIndex
CREATE INDEX "UserKnownArtistRollup_userAccountId_playcount_idx" ON "UserKnownArtistRollup"("userAccountId", "playcount");

-- CreateIndex
CREATE UNIQUE INDEX "UserKnownArtistRollup_userAccountId_normalizedName_key" ON "UserKnownArtistRollup"("userAccountId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "UserRecentTailState_userAccountId_key" ON "UserRecentTailState"("userAccountId");

-- CreateIndex
CREATE INDEX "UserRecentTailArtistCount_userAccountId_playcount_idx" ON "UserRecentTailArtistCount"("userAccountId", "playcount");

-- CreateIndex
CREATE UNIQUE INDEX "UserRecentTailArtistCount_userAccountId_normalizedName_key" ON "UserRecentTailArtistCount"("userAccountId", "normalizedName");

-- CreateIndex
CREATE INDEX "UserDataPullLog_userAccountId_pulledAt_idx" ON "UserDataPullLog"("userAccountId", "pulledAt");

-- CreateIndex
CREATE INDEX "UserDataPullLog_userAccountId_source_pulledAt_idx" ON "UserDataPullLog"("userAccountId", "source", "pulledAt");
