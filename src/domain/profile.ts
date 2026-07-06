export interface CategoryStatistic {
  name: string;
  bytes: number;
  files: number;
}

export interface ProfileStatistics {
  totalDownloaded: number;
  completedBytes: number;
  failedBytes: number;
  cancelledBytes: number;
  minimumDiskWritten: number;
  diskRead: number;
  completedDownloads: number;
  activeDownloads: number;
  failedDownloads: number;
  averageSpeed: number;
  bestDay: string | null;
  bestDayBytes: number;
  categories: CategoryStatistic[];
  diskReadAvailable: boolean;
}
