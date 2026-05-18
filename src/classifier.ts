// ============================================================================
// Classifier — Splits scanned files into AUTO (safe, auto-cleanable) and
// CONFIRM (needs user review) groups based on hard-coded rules.
// The LLM is NOT involved in classification decisions.
// ============================================================================

import { ScannedFile, CleanCategory, DuplicateGroup } from './types.js';
import {
  LARGE_FILE_THRESHOLD,
  OLD_FILE_DAYS,
  INSTALLER_EXTENSIONS,
  ARCHIVE_EXTENSIONS,
} from './constants.js';

/**
 * Classify scanned files into AUTO and CONFIRM groups.
 * Returns a new array with group fields set appropriately.
 */
export function classify(
  files: ScannedFile[],
  duplicateGroups: DuplicateGroup[],
): ScannedFile[] {
  // Build set of paths that appear in duplicate groups
  const duplicatePaths = new Set<string>();
  for (const group of duplicateGroups) {
    for (const file of group.files) {
      duplicatePaths.add(file.path.toLowerCase());
    }
  }

  const classified: ScannedFile[] = [];

  for (const file of files) {
    const pathLower = file.path.toLowerCase();

    if (shouldConfirm(file, pathLower, duplicatePaths)) {
      classified.push({ ...file, group: 'CONFIRM' });
    } else {
      classified.push({ ...file, group: 'AUTO' });
    }
  }

  return classified;
}

/**
 * Determine whether a file needs user confirmation before deletion.
 * All logic here is deterministic — no AI involved.
 */
function shouldConfirm(
  file: ScannedFile,
  pathLower: string,
  duplicatePaths: ReadonlySet<string>,
): boolean {
  // 1. Part of a duplicate group
  if (duplicatePaths.has(pathLower)) return true;

  // 2. Very large file (>500 MB) AND old (>6 months since last access)
  if (file.size > LARGE_FILE_THRESHOLD && file.lastAccessed) {
    const ageDays = (Date.now() - file.lastAccessed.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > OLD_FILE_DAYS) return true;
  }

  // 3. Installer / ISO / archive in temp locations or root of user dirs
  const ext = pathLower.match(/\.[a-z0-9]+$/)?.[0] || '';
  if (
    INSTALLER_EXTENSIONS.has(ext) ||
    ARCHIVE_EXTENSIONS.has(ext)
  ) {
    if (
      pathLower.includes('\\downloads\\') ||
      pathLower.includes('\\temp\\') ||
      pathLower.includes('\\desktop\\')
    ) {
      return true;
    }
  }

  // 4. Crash dumps at the root of drives (e.g., C:\memory.dmp)
  if (ext === '.dmp' || ext === '.mdmp') {
    const depth = pathLower.split('\\').length;
    // Root-level or near-root dumps
    if (depth <= 3) return true;
  }

  // 5. Files over 1 GB (regardless of age — big enough to matter)
  if (file.size > 1024 * 1024 * 1024) return true;

  return false;
}

/**
 * Build a summary of the classification for user display.
 */
export function classifySummary(files: ScannedFile[]): {
  autoCount: number;
  autoSize: number;
  confirmCount: number;
  confirmSize: number;
} {
  const auto = files.filter((f) => f.group === 'AUTO');
  const confirm = files.filter((f) => f.group === 'CONFIRM');

  return {
    autoCount: auto.length,
    autoSize: auto.reduce((sum, f) => sum + f.size, 0),
    confirmCount: confirm.length,
    confirmSize: confirm.reduce((sum, f) => sum + f.size, 0),
  };
}
