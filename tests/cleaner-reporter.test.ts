// ============================================================================
// Cleaner & Reporter Tests
// ============================================================================

import { describe, it, expect } from 'vitest';
import { canDelete } from '../src/safety-rules.js';
import { buildReport, formatBytes, formatDuration } from '../src/reporter.js';
import type { CleanManifest, CleanCategory, CleanMode } from '../src/types.js';

describe('canDelete integration-like scenarios', () => {
  const scope = 'C:\\';
  const category: CleanCategory = 'temp_files';

  it('allows deleting a .tmp file in Temp', () => {
    expect(canDelete('C:\\Windows\\Temp\\abc.tmp', category, scope, true)).toBe(true);
  });

  it('allows deleting a .log file in user Temp', () => {
    expect(canDelete('C:\\Users\\jane\\AppData\\Local\\Temp\\debug.log', 'log_files', scope, true)).toBe(true);
  });

  it('blocks deleting any .exe even in Temp', () => {
    expect(canDelete('C:\\Windows\\Temp\\tool.exe', category, scope, true)).toBe(false);
  });

  it('blocks deleting from Documents even with .tmp extension', () => {
    expect(canDelete('C:\\Users\\jane\\Documents\\backup.tmp', category, scope, true)).toBe(false);
  });

  it('blocks deleting from AppData Roaming (non-cache)', () => {
    expect(canDelete('C:\\Users\\jane\\AppData\\Roaming\\SomeApp\\data.tmp', category, scope, true)).toBe(false);
  });

  it('blocks deleting from ProgramData Microsoft', () => {
    expect(canDelete('C:\\ProgramData\\Microsoft\\Windows\\config.tmp', category, scope, true)).toBe(false);
  });

  it('blocks unconfirmed files even if all other checks pass', () => {
    expect(canDelete('C:\\Windows\\Temp\\abc.tmp', category, scope, false)).toBe(false);
  });

  it('respects scope boundary even for safe file types', () => {
    expect(canDelete('D:\\Temp\\abc.tmp', category, 'C:\\', true)).toBe(false);
  });
});

describe('buildReport', () => {
  it('builds a correct report from manifest', () => {
    const manifest: CleanManifest = {
      manifestId: 'test-001',
      scanId: 'scan-001',
      createdAt: new Date().toISOString(),
      mode: 'recycle_then_empty',
      scanPath: 'C:\\',
      records: [
        { path: 'C:\\Temp\\a.tmp', size: 100, category: 'temp_files', deletedAt: new Date().toISOString(), success: true },
        { path: 'C:\\Temp\\b.tmp', size: 200, category: 'temp_files', deletedAt: new Date().toISOString(), success: true },
        { path: 'C:\\Temp\\c.tmp', size: 300, category: 'temp_files', deletedAt: new Date().toISOString(), success: false, error: 'locked' },
        { path: 'C:\\Temp\\d.log', size: 150, category: 'log_files', deletedAt: new Date().toISOString(), success: true },
      ],
      totalFilesDeleted: 3,
      totalSpaceFreed: 450,
      skippedFiles: 1,
      errors: ['C:\\Temp\\c.tmp: locked'],
      complete: true,
    };

    const report = buildReport(manifest, 12.5);

    expect(report.totalFilesDeleted).toBe(3);
    expect(report.totalSpaceFreed).toBe(450);
    expect(report.skippedFiles).toBe(1);
    expect(report.skippedSpace).toBe(300);
    expect(report.duration).toBe(12.5);
    expect(report.manifestId).toBe('test-001');
    expect(report.mode).toBe('recycle_then_empty');
    expect(report.errors).toHaveLength(1);
  });

  it('handles empty manifest', () => {
    const manifest: CleanManifest = {
      manifestId: 'empty',
      scanId: 'scan-empty',
      createdAt: new Date().toISOString(),
      mode: 'permanent',
      scanPath: 'C:\\',
      records: [],
      totalFilesDeleted: 0,
      totalSpaceFreed: 0,
      skippedFiles: 0,
      errors: [],
      complete: true,
    };
    const report = buildReport(manifest, 0);
    expect(report.totalFilesDeleted).toBe(0);
    expect(report.totalSpaceFreed).toBe(0);
  });
});

describe('formatBytes', () => {
  it('formats 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('formats gigabytes', () => {
    expect(formatBytes(3.5 * 1024 * 1024 * 1024)).toBe('3.5 GB');
  });
});

describe('formatDuration', () => {
  it('handles sub-second duration', () => {
    expect(formatDuration(0.5)).toBe('< 1 秒');
  });

  it('formats seconds', () => {
    expect(formatDuration(30)).toBe('30 秒');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(95)).toBe('1 分 35 秒');
  });
});
