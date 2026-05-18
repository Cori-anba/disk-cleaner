// ============================================================================
// Shared type definitions for disk-cleaner-mcp
// ============================================================================

/** Categories of cleanable junk files */
export type CleanCategory =
  | 'temp_files'
  | 'browser_cache'
  | 'windows_update'
  | 'delivery_optimization'
  | 'prefetch'
  | 'recycle_bin'
  | 'error_reports'
  | 'log_files';

/** Deletion mode for execute_clean */
export type CleanMode = 'recycle_bin' | 'permanent' | 'recycle_then_empty';

/** Classification bucket assigned by the Classifier */
export type ClassificationGroup = 'AUTO' | 'CONFIRM';

/** Risk level for display purposes */
export type RiskLevel = 'low' | 'medium' | 'high';

/** A single scanned file entry */
export interface ScannedFile {
  path: string;
  size: number; // bytes
  category: CleanCategory;
  lastAccessed?: Date;
  lastModified?: Date;
  hash?: string; // populated during duplicate detection
  group: ClassificationGroup; // assigned by classifier
}

/** A group of duplicate files sharing the same content hash */
export interface DuplicateGroup {
  files: ScannedFile[];
  hash: string;
  totalSize: number;
}

/** Result returned by scan_disk tool */
export interface ScanResult {
  scanId: string;
  path: string;
  timestamp: string;
  totalFiles: number;
  totalSize: number;
  autoCount: number;
  autoSize: number;
  confirmCount: number;
  confirmSize: number;
  duplicateGroups: DuplicateGroup[];
}

/** A single item in a clean plan */
export interface CleanPlanItem {
  path: string;
  size: number;
  category: CleanCategory;
  riskLevel: RiskLevel;
  group: ClassificationGroup;
  reason: string;
}

/** Structured clean plan returned by get_clean_plan */
export interface CleanPlan {
  scanId: string;
  autoItems: CleanPlanItem[];
  confirmItems: CleanPlanItem[];
  autoTotalSize: number;
  confirmTotalSize: number;
  duplicateGroups: DuplicateGroup[];
}

/** Record of a single file deletion */
export interface DeletionRecord {
  path: string;
  size: number;
  hash?: string;
  category: CleanCategory;
  deletedAt: string;
  success: boolean;
  error?: string;
}

/** Persistent manifest for recovery and reporting */
export interface CleanManifest {
  manifestId: string;
  scanId: string;
  createdAt: string;
  mode: CleanMode;
  scanPath: string;
  records: DeletionRecord[];
  totalFilesDeleted: number;
  totalSpaceFreed: number;
  skippedFiles: number;
  errors: string[];
  complete: boolean;
}

/** Confirmed items passed to execute_clean */
export interface ConfirmedItem {
  path: string;
  size: number;
  category: CleanCategory;
  group: ClassificationGroup;
}

/** Final report returned by get_clean_report */
export interface CleanReport {
  scanPath: string;
  totalFilesDeleted: number;
  totalSpaceFreed: number;
  autoFiles: number;
  autoSpace: number;
  confirmFiles: number;
  confirmSpace: number;
  skippedFiles: number;
  skippedSpace: number;
  duration: number;
  manifestId: string;
  mode: CleanMode;
  errors: string[];
}

/** Summary entry for listManifests() */
export interface ManifestSummary {
  manifestId: string;
  createdAt: string;
  scanPath: string;
  totalSpaceFreed: number;
  totalFilesDeleted: number;
  mode: CleanMode;
  complete: boolean;
}
