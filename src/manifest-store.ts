// ============================================================================
// Manifest Store — Persistent JSON-based manifest management.
// Manifests serve as the "undo log" for cleanup operations, enabling both
// recovery and reporting. Each manifest is a single JSON file under
// MANIFEST_DIR with the naming pattern: YYYY-MM-DD-HHmmss-<id>.json
// ============================================================================

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  CleanManifest,
  DeletionRecord,
  CleanMode,
  ManifestSummary,
} from './types.js';
import { MANIFEST_DIR } from './constants.js';

/** In-memory cache of open manifests for batch writing */
const openManifests = new Map<string, CleanManifest>();

/**
 * Create a new manifest and persist it to disk.
 */
export async function createManifest(
  scanId: string,
  mode: CleanMode,
  scanPath: string,
): Promise<string> {
  await ensureManifestDir();

  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const manifestId = `${dateStr}-${scanId.slice(0, 8)}`;

  const manifest: CleanManifest = {
    manifestId,
    scanId,
    createdAt: now.toISOString(),
    mode,
    scanPath,
    records: [],
    totalFilesDeleted: 0,
    totalSpaceFreed: 0,
    skippedFiles: 0,
    errors: [],
    complete: false,
  };

  openManifests.set(manifestId, manifest);
  await flushManifest(manifest);

  return manifestId;
}

/**
 * Record a batch of deletion results into the manifest.
 * Flushes to disk after each batch.
 */
export async function recordDeletions(
  manifestId: string,
  records: DeletionRecord[],
): Promise<void> {
  const manifest = openManifests.get(manifestId);
  if (!manifest) {
    // Try loading from disk
    const loaded = await loadManifest(manifestId);
    if (!loaded) throw new Error(`Manifest not found: ${manifestId}`);
    openManifests.set(manifestId, loaded);
    return recordDeletions(manifestId, records);
  }

  manifest.records.push(...records);

  const successful = records.filter((r) => r.success);
  const space = successful.reduce((sum, r) => sum + r.size, 0);

  manifest.totalFilesDeleted += successful.length;
  manifest.totalSpaceFreed += space;
  manifest.skippedFiles += records.filter((r) => !r.success).length;

  await flushManifest(manifest);
}

/**
 * Record an error that occurred during cleanup.
 */
export async function recordError(
  manifestId: string,
  error: string,
): Promise<void> {
  const manifest = openManifests.get(manifestId);
  if (!manifest) {
    const loaded = await loadManifest(manifestId);
    if (!loaded) return;
    openManifests.set(manifestId, loaded);
    return recordError(manifestId, error);
  }

  manifest.errors.push(error);
  await flushManifest(manifest);
}

/**
 * Mark a manifest as complete and flush it.
 */
export async function finalizeManifest(manifestId: string): Promise<void> {
  const manifest = openManifests.get(manifestId);
  if (!manifest) return;

  manifest.complete = true;
  await flushManifest(manifest);
  openManifests.delete(manifestId);
}

/**
 * Load a manifest by ID.
 */
export async function getManifest(
  manifestId: string,
): Promise<CleanManifest | null> {
  const cached = openManifests.get(manifestId);
  if (cached) return cached;

  return loadManifest(manifestId);
}

/**
 * List all manifests on disk, newest first.
 */
export async function listManifests(): Promise<ManifestSummary[]> {
  await ensureManifestDir();

  let files: string[];
  try {
    files = await fs.readdir(MANIFEST_DIR);
  } catch {
    return [];
  }

  const summaries: ManifestSummary[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    try {
      const content = await fs.readFile(
        path.join(MANIFEST_DIR, file),
        'utf-8',
      );
      const m: CleanManifest = JSON.parse(content);
      summaries.push({
        manifestId: m.manifestId,
        createdAt: m.createdAt,
        scanPath: m.scanPath,
        totalSpaceFreed: m.totalSpaceFreed,
        totalFilesDeleted: m.totalFilesDeleted,
        mode: m.mode,
        complete: m.complete,
      });
    } catch {
      // Skip corrupt manifest files
    }
  }

  summaries.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return summaries;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function ensureManifestDir(): Promise<void> {
  await fs.mkdir(MANIFEST_DIR, { recursive: true });
}

function manifestPath(manifestId: string): string {
  return path.join(MANIFEST_DIR, `${manifestId}.json`);
}

async function flushManifest(manifest: CleanManifest): Promise<void> {
  await ensureManifestDir();
  const json = JSON.stringify(manifest, null, 2);
  await fs.writeFile(manifestPath(manifest.manifestId), json, 'utf-8');
}

async function loadManifest(
  manifestId: string,
): Promise<CleanManifest | null> {
  try {
    const content = await fs.readFile(manifestPath(manifestId), 'utf-8');
    return JSON.parse(content) as CleanManifest;
  } catch {
    return null;
  }
}
