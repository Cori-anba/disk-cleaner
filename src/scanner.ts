// ============================================================================
// Scanner — Recursively walks the filesystem, applying Rule Zero filters,
// returning a structured list of ScannedFile entries ready for classification.
// This module is READ-ONLY — it never modifies the filesystem.
// ============================================================================

import path from 'node:path';
import { ScannedFile, CleanCategory } from './types.js';
import { PlatformImpl } from './platform/interface.js';
import { isForbiddenPath, isForbiddenExtension } from './safety-rules.js';
import {
  STALE_LOG_DAYS,
  MAX_SCAN_DEPTH,
  SCAN_PROGRESS_BATCH,
  BROWSER_CACHE_DIRS,
} from './constants.js';

export interface ScanOptions {
  includeBrowserCache: boolean;
  includeWindowsUpdate: boolean;
  onProgress?: (filesScanned: number) => void;
}

/**
 * Main entry point: scan a user-specified path for junk files.
 * @param scopePath — e.g. "C:" or "C:\\Users\\..."
 * @param platform — platform implementation
 * @param isAdmin — whether the process has admin rights
 */
export async function scanDisk(
  scopePath: string,
  platform: PlatformImpl,
  isAdmin: boolean,
  options: ScanOptions,
): Promise<ScannedFile[]> {
  const results: ScannedFile[] = [];

  // Determine the categories to scan
  const categories: CleanCategory[] = ['temp_files', 'recycle_bin', 'error_reports', 'log_files'];

  if (options.includeBrowserCache) {
    categories.push('browser_cache');
  }
  if (options.includeWindowsUpdate) {
    categories.push('windows_update', 'delivery_optimization', 'prefetch');
  }

  // For each category, resolve its concrete paths and scan them
  for (const category of categories) {
    const categoryPaths = platform.resolveCategoryPaths(category);
    for (const catPath of categoryPaths) {
      if (!catPath) continue;

      // Cat path must be within user scope
      if (!catPath.toLowerCase().startsWith(scopePath.toLowerCase())) continue;

      // Must not be a forbidden path itself
      if (isForbiddenPath(catPath)) continue;

      // Some paths need admin — skip if not admin
      if (!isAdmin && needsAdmin(catPath)) continue;

      const files = await scanDirectory(
        catPath,
        category,
        platform,
        scopePath,
        0,
      );
      results.push(...files);

      if (options.onProgress) {
        options.onProgress(results.length);
      }
    }
  }

  return results;
}

/**
 * Check if a path requires admin rights to read (system-protected locations).
 */
function needsAdmin(dirPath: string): boolean {
  const lower = dirPath.toLowerCase();
  return (
    lower.includes('\\windows\\softwaredistribution') ||
    lower.includes('\\deliveryoptimization') ||
    lower.includes('\\prefetch') ||
    lower.includes('\\$recycle.bin') ||
    lower.includes('\\servicing\\') ||
    lower.includes('\\system32\\')
  );
}

/**
 * Recursively scan a directory, collecting ScannedFile entries.
 */
async function scanDirectory(
  dirPath: string,
  category: CleanCategory,
  platform: PlatformImpl,
  scope: string,
  depth: number,
): Promise<ScannedFile[]> {
  if (depth > MAX_SCAN_DEPTH) return [];

  // Rule Zero check: never enter forbidden directories
  if (isForbiddenPath(dirPath)) return [];

  const results: ScannedFile[] = [];
  let entries: string[];

  try {
    entries = await platform.readDir(dirPath);
  } catch {
    return []; // Permission denied or non-existent — skip silently
  }

  for (const entryPath of entries) {
    // Rule Zero: skip forbidden paths
    if (isForbiddenPath(entryPath)) continue;

    const info = await platform.getFileInfo(entryPath);
    if (!info) continue;

    if (info.isDirectory) {
      // For browser cache, drill into known cache subdirectories
      if (category === 'browser_cache') {
        const baseName = path.basename(entryPath);
        if (BROWSER_CACHE_DIRS.some((d) => baseName.toLowerCase() === d.toLowerCase())) {
          // Scan into cache dir but don't recurse further
          const cacheFiles = await scanFlat(entryPath, category, platform, scope);
          results.push(...cacheFiles);
          continue;
        }
        // Also check for User Data / Default / Profile dirs
        if (baseName === 'User Data' || baseName === 'UserData') {
          const subResults = await scanDirectory(entryPath, category, platform, scope, depth + 1);
          results.push(...subResults);
          continue;
        }
        const baseNameLower = baseName.toLowerCase();
        if (baseNameLower === 'default' || baseNameLower.startsWith('profile')) {
          const subResults = await scanDirectory(entryPath, category, platform, scope, depth + 1);
          results.push(...subResults);
          continue;
        }
        // Skip other directories in browser paths
        continue;
      }

      // For other categories, recurse into subdirectories
      const subResults = await scanDirectory(entryPath, category, platform, scope, depth + 1);
      results.push(...subResults);
    } else {
      // It's a file — check if it qualifies
      if (!isQualifyingFile(entryPath, category, info)) continue;
      if (isForbiddenExtension(entryPath)) continue;

      results.push({
        path: entryPath,
        size: info.size,
        category,
        lastAccessed: info.atime,
        lastModified: info.mtime,
        group: 'AUTO', // Classifier will refine this later
      });
    }
  }

  return results;
}

/**
 * Scan a directory flat (no recursion), collecting all files.
 */
async function scanFlat(
  dirPath: string,
  category: CleanCategory,
  platform: PlatformImpl,
  scope: string,
): Promise<ScannedFile[]> {
  if (isForbiddenPath(dirPath)) return [];

  const results: ScannedFile[] = [];
  let entries: string[];

  try {
    entries = await platform.readDir(dirPath);
  } catch {
    return [];
  }

  for (const entryPath of entries) {
    if (isForbiddenPath(entryPath)) continue;
    const info = await platform.getFileInfo(entryPath);
    if (!info || info.isDirectory) continue;
    if (isForbiddenExtension(entryPath)) continue;

    results.push({
      path: entryPath,
      size: info.size,
      category,
      lastAccessed: info.atime,
      lastModified: info.mtime,
      group: 'AUTO',
    });
  }

  return results;
}

/**
 * Determine if a specific file qualifies as junk under its category.
 */
function isQualifyingFile(
  filePath: string,
  category: CleanCategory,
  info: { size: number; mtime: Date; atime: Date; isDirectory: boolean },
): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath).toLowerCase();

  switch (category) {
    case 'temp_files':
      // .tmp, .temp, files starting with ~, .bak, .old, .log, .etl
      return (
        ext === '.tmp' ||
        ext === '.temp' ||
        ext === '.bak' ||
        ext === '.old' ||
        ext === '.etl' ||
        ext === '.log' ||
        ext === '.dmp' ||
        name.startsWith('~') ||
        name.endsWith('.tmp')
      );

    case 'browser_cache':
      // Everything inside browser cache dirs is safe to clean
      return true;

    case 'windows_update':
      // Everything inside SoftwareDistribution\Download is safe
      return true;

    case 'delivery_optimization':
      // Everything inside DeliveryOptimization cache is safe
      return true;

    case 'prefetch':
      // Only .pf files in Prefetch
      return ext === '.pf';

    case 'recycle_bin':
      // Everything inside $Recycle.Bin
      return true;

    case 'error_reports':
      // .wer, .hdmp, .mdmp files
      return ext === '.wer' || ext === '.hdmp' || ext === '.mdmp';

    case 'log_files':
      // .log files older than STALE_LOG_DAYS in Temp dirs only
      if (ext !== '.log') return false;
      const cutoff = Date.now() - STALE_LOG_DAYS * 24 * 60 * 60 * 1000;
      return info.mtime.getTime() < cutoff;

    default:
      return false;
  }
}
