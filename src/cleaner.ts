// ============================================================================
// Cleaner — Executes file deletion with the hard four-AND safety gate.
// Every single file deletion passes through canDelete() before execution.
// This is the ONLY module that modifies the filesystem.
// ============================================================================

import { ScannedFile, CleanMode, DeletionRecord, ConfirmedItem } from './types.js';
import { PlatformImpl } from './platform/interface.js';
import { canDelete } from './safety-rules.js';
import { createManifest, recordDeletions, recordError, finalizeManifest } from './manifest-store.js';
import { DELETE_BATCH_SIZE } from './constants.js';

export interface CleanResult {
  manifestId: string;
  deleted: number;
  skipped: number;
  spaceFreed: number;
  errors: string[];
}

/**
 * Execute a cleanup operation on the confirmed files.
 *
 * @param scanId — the scan session ID
 * @param confirmedItems — files the user explicitly confirmed for deletion
 * @param mode — recycle_bin | permanent | recycle_then_empty
 * @param scope — user-specified scope path (hard boundary)
 * @param platform — platform implementation
 */
export async function executeClean(
  scanId: string,
  confirmedItems: ConfirmedItem[],
  mode: CleanMode,
  scope: string,
  platform: PlatformImpl,
): Promise<CleanResult> {
  const manifestId = await createManifest(scanId, mode, scope);

  let deleted = 0;
  let skipped = 0;
  let spaceFreed = 0;
  const errors: string[] = [];

  // Process in batches to keep the event loop responsive
  for (let i = 0; i < confirmedItems.length; i += DELETE_BATCH_SIZE) {
    const batch = confirmedItems.slice(i, i + DELETE_BATCH_SIZE);
    const records: DeletionRecord[] = [];

    for (const item of batch) {
      // THE safety gate — four-AND check for every single file
      if (!canDelete(item.path, item.category, scope, true)) {
        records.push({
          path: item.path,
          size: item.size,
          category: item.category,
          deletedAt: new Date().toISOString(),
          success: false,
          error: 'Blocked by safety gate (canDelete returned false)',
        });
        skipped++;
        continue;
      }

      try {
        if (mode === 'permanent') {
          await platform.permanentDelete(item.path);
        } else {
          // recycle_bin and recycle_then_empty both start with recycle bin
          await platform.moveToRecycleBin(item.path);
        }

        records.push({
          path: item.path,
          size: item.size,
          category: item.category,
          deletedAt: new Date().toISOString(),
          success: true,
        });

        deleted++;
        spaceFreed += item.size;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        records.push({
          path: item.path,
          size: item.size,
          category: item.category,
          deletedAt: new Date().toISOString(),
          success: false,
          error: msg,
        });
        errors.push(`${item.path}: ${msg}`);
        skipped++;
      }
    }

    // Write batch to manifest
    await recordDeletions(manifestId, records);
  }

  // For recycle_then_empty mode, clear the recycle bin after all deletions
  if (mode === 'recycle_then_empty') {
    try {
      await platform.emptyRecycleBin();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to empty recycle bin: ${msg}`);
      await recordError(manifestId, `Failed to empty recycle bin: ${msg}`);
    }
  }

  await finalizeManifest(manifestId);

  return {
    manifestId,
    deleted,
    skipped,
    spaceFreed,
    errors,
  };
}
