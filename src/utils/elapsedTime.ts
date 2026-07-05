const timestamp = (value: string): number => {
  const normalized = value.includes("T")
    ? value
    : `${value.replace(" ", "T")}Z`;
  return new Date(normalized).getTime();
};

export function elapsedSeconds(createdAt: string, completedAt: string | null) {
  if (!completedAt) return null;
  const elapsed = Math.floor(
    (timestamp(completedAt) - timestamp(createdAt)) / 1000,
  );
  return Number.isFinite(elapsed) ? Math.max(0, elapsed) : null;
}

export function formatElapsed(seconds: number | null): string {
  if (seconds === null) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  if (hours) return `${hours}h ${minutes}min ${remaining}s`;
  if (minutes) return `${minutes}min ${remaining}s`;
  return `${remaining}s`;
}
