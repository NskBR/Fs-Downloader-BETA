export interface MetricsSnapshot {
  totalBytes: number;
  completedBytes: number;
  cancelledBytes: number;
  failedBytes: number;
  extractedBytes: number;
  ssdWrittenBytes: number;
  completedCount: number;
  totalDurationMs: number;
}
