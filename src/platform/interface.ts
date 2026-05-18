// ============================================================================
// Cross-platform abstraction interface
// All platform-specific implementations must satisfy this interface.
// ============================================================================

import { ScannedFile, CleanCategory, CleanMode } from '../types.js';

export interface PlatformImpl {
  /** Human-readable platform name */
  readonly name: string;

  /** Check if the current process has administrator / root privileges */
  isAdmin(): boolean;

  /** Return a list of known temp directories for this platform */
  getTempPaths(): string[];

  /** Return a list of known browser cache root directories (Chromium-based) */
  getBrowserCachePaths(): string[];

  /** Return the Windows Update / SoftwareDistribution download path */
  getWindowsUpdateCachePath(): string | null;

  /** Return the Delivery Optimization cache path */
  getDeliveryOptimizationPath(): string | null;

  /** Return the Prefetch directory path */
  getPrefetchPath(): string | null;

  /** Return the Recycle Bin / Trash path root */
  getRecycleBinPath(): string | null;

  /** Return known error-report / crash-dump paths */
  getErrorReportPaths(): string[];

  /** Read the listing of a directory (non-recursive) */
  readDir(dirPath: string): Promise<string[]>;

  /** Get file stats (size, mtime, atime) */
  getFileInfo(filePath: string): Promise<{
    size: number;
    mtime: Date;
    atime: Date;
    isDirectory: boolean;
  } | null>;

  /**
   * Move a file or directory to the OS recycle-bin / trash.
   * MUST be synchronous internally (caller awaits).
   */
  moveToRecycleBin(targetPath: string): Promise<void>;

  /**
   * Permanently delete a file or directory.
   */
  permanentDelete(targetPath: string): Promise<void>;

  /**
   * Empty the recycle bin / trash for the files we just moved there.
   * Called in "recycle_then_empty" mode.
   */
  emptyRecycleBin(): Promise<void>;

  /**
   * Resolve a clean category into concrete filesystem paths.
   * Returns empty array for categories that don't apply on this platform.
   */
  resolveCategoryPaths(category: CleanCategory): string[];
}
