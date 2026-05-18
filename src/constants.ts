import path from 'node:path';
import os from 'node:os';

// ============================================================================
// Magic numbers and configuration constants
// ============================================================================

/** Files larger than this (500 MB) and old go to CONFIRM group */
export const LARGE_FILE_THRESHOLD = 500 * 1024 * 1024;

/** Files not accessed in 180 days (6 months) are considered "old" */
export const OLD_FILE_DAYS = 180;

/** Log files older than 30 days are safe to clean */
export const STALE_LOG_DAYS = 30;

/** Filename similarity threshold for near-duplicate detection (Levenshtein ratio) */
export const SIMILARITY_THRESHOLD = 0.85;

/** Directory for persistent manifests */
export const MANIFEST_DIR =
  process.env.DISK_CLEANER_MANIFEST_DIR ||
  path.join(os.homedir(), '.disk-cleaner', 'manifests');

/** Maximum depth for recursive directory scanning */
export const MAX_SCAN_DEPTH = 20;

/** Batch size for file deletion (to yield event loop) */
export const DELETE_BATCH_SIZE = 50;

/** Maximum files to scan before batching report progress */
export const SCAN_PROGRESS_BATCH = 5000;

/** File extensions treated as installers / large downloads (CONFIRM group) */
export const INSTALLER_EXTENSIONS = new Set([
  '.iso', '.vhd', '.vhdx', '.ova', '.ovf',
  '.msi', '.exe', '.pkg', '.dmg', '.appx',
]);

/** File extensions treated as archives (CONFIRM group if large/old) */
export const ARCHIVE_EXTENSIONS = new Set([
  '.zip', '.7z', '.rar', '.tar', '.gz', '.bz2', '.xz',
]);

/** Known browser cache directory names (partial match) */
export const BROWSER_CACHE_DIRS = [
  'Cache', 'Code Cache', 'Service Worker', 'GPUCache',
  'DawnCache', 'ShaderCache',
];

/** Browser names for path matching */
export const BROWSER_NAMES = ['Google', 'Chrome', 'Edge', 'Brave', 'Opera', 'Vivaldi'];
