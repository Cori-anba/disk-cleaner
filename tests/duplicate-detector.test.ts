// ============================================================================
// Duplicate Detector Tests
// ============================================================================

import { describe, it, expect } from 'vitest';
import { detectSimilarByName } from '../src/duplicate-detector.js';
import type { ScannedFile } from '../src/types.js';

function makeFile(path: string, size: number): ScannedFile {
  return {
    path,
    size,
    category: 'temp_files',
    lastAccessed: new Date(),
    lastModified: new Date(),
    group: 'AUTO',
  };
}

describe('detectSimilarByName', () => {
  it('detects identical filenames', () => {
    const files = [
      makeFile('C:\\A\\report.pdf', 1024),
      makeFile('C:\\B\\report.pdf', 1024),
    ];
    const results = detectSimilarByName(files);
    expect(results.length).toBe(1);
    expect(results[0].similarity).toBe(1);
  });

  it('detects very similar filenames', () => {
    const files = [
      makeFile('C:\\A\\report_v1.pdf', 1024),
      makeFile('C:\\B\\report_v2.pdf', 1024),
    ];
    const results = detectSimilarByName(files);
    expect(results.length).toBe(1);
    expect(results[0].similarity).toBeGreaterThan(0.85);
  });

  it('does not match files of different sizes', () => {
    const files = [
      makeFile('C:\\A\\report.pdf', 1024),
      makeFile('C:\\B\\report.pdf', 2048), // different size
    ];
    const results = detectSimilarByName(files);
    expect(results.length).toBe(0);
  });

  it('does not match very different filenames', () => {
    const files = [
      makeFile('C:\\A\\report.pdf', 1024),
      makeFile('C:\\B\\budget.xlsx', 1024),
    ];
    const results = detectSimilarByName(files);
    expect(results.length).toBe(0);
  });

  it('handles empty input', () => {
    const results = detectSimilarByName([]);
    expect(results.length).toBe(0);
  });

  it('handles single file', () => {
    const results = detectSimilarByName([makeFile('C:\\A\\file.tmp', 100)]);
    expect(results.length).toBe(0);
  });
});
