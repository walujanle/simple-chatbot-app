const RECENT_PATTERN =
  /\b(today|latest|recent|currently|current|news|this week|hari ini|terbaru|terkini|sekarang|minggu ini)\b/i;

export function formulateSearchQuery(input: string): { query: string; timeFilter?: "d" | "w" } {
  const query = input
    .replace(/\b(please|tolong|mohon)\b/gi, " ")
    .replace(/\b(search|browse|look up|cari|carikan|web|internet|di)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  const normalized = query || input.trim().slice(0, 240);
  const recent = RECENT_PATTERN.test(input);
  return { query: normalized, ...(recent ? { timeFilter: /today|hari ini/i.test(input) ? "d" : "w" } : {}) };
}
