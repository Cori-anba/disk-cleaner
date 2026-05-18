// ============================================================================
// Classifier Tests
// ============================================================================

import { describe, it, expect } from 'vitest';
import { classify, classifySummary } from '../src/classifier.js';
import type { ScannedFile, DuplicateGroup } from '../src/types.js';

function makeFile(overrides: Partial<ScannedFile> = {}): ScannedFile {
  return {
    path: 'C:\\Temp\\file.tmp',
    size: 1024,
    category: 'temp_files',
    lastAccessed: new Date(),
    lastModified: new Date(),
    group: 'AUTO',
    ...overrides,
  };
}

describe('classify', () => {
  it('classifies normal temp files as AUTO', () => {
    const files = [makeFile({ path: 'C:\\Temp\\file.tmp', size: 1024 })];
    const result = classify(files, []);
    expect(result[0].group).toBe('AUTO');
  });

  it('classifies duplicate files as CONFIRM', () => {
    const dupFile = makeFile({ path: 'C:\\Temp\\dup.tmp', size: 1024 });
    const files = [dupFile];
    const duplicates: DuplicateGroup[] = [
      {
        files: [dupFile, { ...dupFile, path: 'C:\\Other\\dup.tmp' }],
        hash: 'abc123',
        totalSize: 2048,
      },
    ];
    const result = classify(files, duplicates);
    expect(result[0].group).toBe('CONFIRM');
  });

  it('classifies large old files as CONFIRM', () => {
    const oldDate = new Date();
    oldDate.setFullYear(oldDate.getFullYear() - 1); // 1 year ago
    const largeFile = makeFile({
      path: 'C:\\Temp\\big_old.iso',
      size: 600 * 1024 * 1024, // 600 MB
      lastAccessed: oldDate,
    });
    const result = classify([largeFile], []);
    expect(result[0].group).toBe('CONFIRM');
  });

  it('keeps large recent temp files as AUTO (not installer/archive)', () => {
    const largeFile = makeFile({
      path: 'C:\\Temp\\big_new.tmp',
      size: 600 * 1024 * 1024, // 600 MB
      lastAccessed: new Date(), // just now
    });
    const result = classify([largeFile], []);
    expect(result[0].group).toBe('AUTO');
  });

  it('classifies root-level crash dumps as CONFIRM', () => {
    const dumpFile = makeFile({
      path: 'C:\\memory.dmp',
      size: 2 * 1024 * 1024 * 1024, // 2 GB
      category: 'temp_files',
    });
    const result = classify([dumpFile], []);
    expect(result[0].group).toBe('CONFIRM');
  });

  it('classifies >1GB files as CONFIRM regardless of age', () => {
    const hugeFile = makeFile({
      path: 'C:\\Temp\\huge_file.tmp',
      size: 2 * 1024 * 1024 * 1024, // 2 GB
      lastAccessed: new Date(), // recent
    });
    const result = classify([hugeFile], []);
    expect(result[0].group).toBe('CONFIRM');
  });
});

describe('classifySummary', () => {
  it('counts AUTO and CONFIRM correctly', () => {
    const files = [
      makeFile({ path: 'a.tmp', size: 100, group: 'AUTO' }),
      makeFile({ path: 'b.tmp', size: 200, group: 'AUTO' }),
      makeFile({ path: 'c.tmp', size: 300, group: 'CONFIRM' }),
    ];
    const summary = classifySummary(files);
    expect(summary.autoCount).toBe(2);
    expect(summary.autoSize).toBe(300);
    expect(summary.confirmCount).toBe(1);
    expect(summary.confirmSize).toBe(300);
  });
});
