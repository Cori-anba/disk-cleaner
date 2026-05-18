// ============================================================================
// Duplicate Detector — Identifies duplicate and near-duplicate files using
// content hashing (xxHash / SHA-256 fallback) and filename similarity.
// ============================================================================

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { ScannedFile, DuplicateGroup } from './types.js';
import { SIMILARITY_THRESHOLD } from './constants.js';

/**
 * Detect exact-duplicate files by content hash.
 * Only hashes files that share the same size (quick filter before hashing).
 */
export async function detectDuplicates(
  files: ScannedFile[],
  onProgress?: (processed: number, total: number) => void,
): Promise<DuplicateGroup[]> {
  // Group by file size first (files with different sizes can't be duplicates)
  const bySize = new Map<number, ScannedFile[]>();
  for (const file of files) {
    const existing = bySize.get(file.size) || [];
    existing.push(file);
    bySize.set(file.size, existing);
  }

  // Only process size groups with more than one file
  const candidates: ScannedFile[][] = [];
  for (const [, group] of bySize) {
    if (group.length > 1) {
      candidates.push(group);
    }
  }

  // Hash candidate groups
  const byHash = new Map<string, ScannedFile[]>();
  let processed = 0;
  const totalHashes = candidates.reduce((sum, g) => sum + g.length, 0);

  for (const group of candidates) {
    for (const file of group) {
      try {
        const hash = await hashFileChunked(file.path);
        file.hash = hash;
        const existing = byHash.get(hash) || [];
        existing.push(file);
        byHash.set(hash, existing);
      } catch {
        // File may be locked or inaccessible — skip
      }
      processed++;
      if (onProgress && processed % 10 === 0) {
        onProgress(processed, totalHashes);
      }
    }
  }

  // Build duplicate groups (only groups with 2+ files)
  const duplicateGroups: DuplicateGroup[] = [];
  for (const [hash, fileGroup] of byHash) {
    if (fileGroup.length > 1) {
      duplicateGroups.push({
        files: fileGroup,
        hash,
        totalSize: fileGroup.reduce((sum, f) => sum + f.size, 0),
      });
    }
  }

  // Sort by total size descending (biggest waste first)
  duplicateGroups.sort((a, b) => b.totalSize - a.totalSize);

  return duplicateGroups;
}

/**
 * Hash a file using streaming reads (memory efficient for large files).
 * Uses SHA-256 for reliability. Reads only the first 64KB for very large files,
 * then the full file to confirm.
 */
async function hashFileChunked(filePath: string): Promise<string> {
  // For files < 10 MB, hash the entire content
  // For files >= 10 MB, hash the first + last 64KB (fast heuristic)
  // But to be safe with data integrity, we hash everything
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });

    stream.on('data', (chunk: string | Buffer) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Detect near-duplicate files by filename similarity (Levenshtein ratio).
 * Used as a secondary signal — exact duplicates are handled by hash.
 */
export function detectSimilarByName(
  files: ScannedFile[],
): Array<{ fileA: ScannedFile; fileB: ScannedFile; similarity: number }> {
  const results: Array<{ fileA: ScannedFile; fileB: ScannedFile; similarity: number }> = [];

  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const nameA = path.basename(files[i].path).toLowerCase();
      const nameB = path.basename(files[j].path).toLowerCase();

      const sim = levenshteinRatio(nameA, nameB);
      // Same size + similar name = likely duplicate
      if (sim >= SIMILARITY_THRESHOLD && files[i].size === files[j].size) {
        results.push({ fileA: files[i], fileB: files[j], similarity: sim });
      }
    }
  }

  return results;
}

/**
 * Compute the Levenshtein similarity ratio (0-1) between two strings.
 */
function levenshteinRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshteinDistance(a, b);
  return (maxLen - dist) / maxLen;
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1,     // deletion
        );
      }
    }
  }

  return matrix[a.length][b.length];
}
