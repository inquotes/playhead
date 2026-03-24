npx wrangler d1 execute playhead-db --remote --command "
SELECT count(1)
FROM UserWeeklyIngestedWeek
WHERE userAccountId = (SELECT id FROM UserAccount WHERE lastfmUsername = 'alexinquotes')"