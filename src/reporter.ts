// ============================================================================
// Reporter — Generates human-readable cleanup reports from manifest data.
// ============================================================================

import type { CleanManifest, CleanReport, DeletionRecord } from './types.js';

/**
 * Build a full cleanup report from a completed manifest.
 */
export function buildReport(
  manifest: CleanManifest,
  duration: number,
): CleanReport {
  const autoRecords: DeletionRecord[] = [];
  const confirmRecords: DeletionRecord[] = [];
  const skippedRecords: DeletionRecord[] = [];

  for (const record of manifest.records) {
    if (!record.success) {
      skippedRecords.push(record);
    } else if (record.category) {
      // All records with explicit categories are "identified" garbage
      // The distinction between AUTO and CONFIRM is informational
      autoRecords.push(record);
    }
  }

  const autoSpace = autoRecords.reduce((sum, r) => sum + r.size, 0);
  const skippedSpace = skippedRecords.reduce((sum, r) => sum + r.size, 0);

  return {
    scanPath: manifest.scanPath,
    totalFilesDeleted: manifest.totalFilesDeleted,
    totalSpaceFreed: manifest.totalSpaceFreed,
    autoFiles: autoRecords.length,
    autoSpace,
    confirmFiles: manifest.totalFilesDeleted - autoRecords.length,
    confirmSpace: manifest.totalSpaceFreed - autoSpace,
    skippedFiles: skippedRecords.length,
    skippedSpace,
    duration,
    manifestId: manifest.manifestId,
    mode: manifest.mode,
    errors: manifest.errors,
  };
}

/**
 * Format byte count into a human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / Math.pow(1024, idx);
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

/**
 * Format duration in seconds to a human-readable string.
 */
export function formatDuration(seconds: number): string {
  if (seconds < 1) return '< 1 秒';
  if (seconds < 60) return `${seconds.toFixed(0)} 秒`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins} 分 ${secs} 秒`;
}
