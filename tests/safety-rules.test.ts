// ============================================================================
// Safety Rules Tests
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  isWithinScope,
  isForbiddenPath,
  isForbiddenExtension,
  isAllowedCategory,
  canDelete,
} from '../src/safety-rules.js';
import type { CleanCategory } from '../src/types.js';

describe('isWithinScope', () => {
  it('accepts paths within the scope', () => {
    expect(isWithinScope('C:\\Temp\\file.tmp', 'C:\\')).toBe(true);
    expect(isWithinScope('C:\\Windows\\Temp\\file.tmp', 'C:\\')).toBe(true);
    expect(isWithinScope('C:\\Users\\test\\file.tmp', 'C:\\Users\\test')).toBe(true);
  });

  it('rejects paths outside the scope', () => {
    expect(isWithinScope('D:\\file.tmp', 'C:\\')).toBe(false);
    expect(isWithinScope('C:\\Users\\other\\file.tmp', 'C:\\Users\\test')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isWithinScope('c:\\temp\\file.tmp', 'C:\\Temp')).toBe(true);
  });
});

describe('isForbiddenPath', () => {
  it('blocks System32', () => {
    expect(isForbiddenPath('C:\\Windows\\System32\\cmd.exe')).toBe(true);
  });

  it('blocks Program Files', () => {
    expect(isForbiddenPath('C:\\Program Files\\MyApp\\app.exe')).toBe(true);
    expect(isForbiddenPath('C:\\Program Files (x86)\\MyApp\\app.exe')).toBe(true);
  });

  it('blocks user Documents, Desktop, Pictures', () => {
    expect(isForbiddenPath('C:\\Users\\john\\Documents\\resume.docx')).toBe(true);
    expect(isForbiddenPath('C:\\Users\\john\\Desktop\\shortcut.lnk')).toBe(true);
    expect(isForbiddenPath('C:\\Users\\john\\Pictures\\photo.jpg')).toBe(true);
  });

  it('blocks .ssh and .aws', () => {
    expect(isForbiddenPath('C:\\Users\\john\\.ssh\\id_rsa')).toBe(true);
    expect(isForbiddenPath('C:\\Users\\john\\.aws\\credentials')).toBe(true);
  });

  it('allows Windows Temp', () => {
    expect(isForbiddenPath('C:\\Windows\\Temp\\file.tmp')).toBe(false);
  });

  it('allows user %TEMP%', () => {
    expect(isForbiddenPath('C:\\Users\\john\\AppData\\Local\\Temp\\file.tmp')).toBe(false);
  });

  it('blocks Recovery and EFI partitions', () => {
    expect(isForbiddenPath('C:\\Recovery\\winre.wim')).toBe(true);
    expect(isForbiddenPath('C:\\EFI\\Boot\\bootx64.efi')).toBe(true);
    expect(isForbiddenPath('C:\\System Volume Information\\tracking.log')).toBe(true);
  });
});

describe('isForbiddenExtension', () => {
  it('blocks .exe, .dll, .sys', () => {
    expect(isForbiddenExtension('setup.exe')).toBe(true);
    expect(isForbiddenExtension('kernel32.dll')).toBe(true);
    expect(isForbiddenExtension('driver.sys')).toBe(true);
  });

  it('blocks script files', () => {
    expect(isForbiddenExtension('script.bat')).toBe(true);
    expect(isForbiddenExtension('script.ps1')).toBe(true);
    expect(isForbiddenExtension('script.vbs')).toBe(true);
  });

  it('allows temp and log files', () => {
    expect(isForbiddenExtension('file.tmp')).toBe(false);
    expect(isForbiddenExtension('file.log')).toBe(false);
    expect(isForbiddenExtension('file.bak')).toBe(false);
  });
});

describe('isAllowedCategory', () => {
  it('accepts whitelisted categories', () => {
    expect(isAllowedCategory('temp_files')).toBe(true);
    expect(isAllowedCategory('browser_cache')).toBe(true);
    expect(isAllowedCategory('windows_update')).toBe(true);
    expect(isAllowedCategory('delivery_optimization')).toBe(true);
    expect(isAllowedCategory('prefetch')).toBe(true);
    expect(isAllowedCategory('recycle_bin')).toBe(true);
    expect(isAllowedCategory('error_reports')).toBe(true);
    expect(isAllowedCategory('log_files')).toBe(true);
  });

  it('rejects unknown category', () => {
    expect(isAllowedCategory('user_documents' as CleanCategory)).toBe(false);
  });
});

describe('canDelete — four-AND gate', () => {
  const scope = 'C:\\';
  const category: CleanCategory = 'temp_files';

  it('returns true when all conditions pass', () => {
    expect(canDelete('C:\\Temp\\file.tmp', category, scope, true)).toBe(true);
  });

  it('returns false when outside scope', () => {
    expect(canDelete('D:\\Temp\\file.tmp', category, 'C:\\', true)).toBe(false);
  });

  it('returns false when path is forbidden', () => {
    expect(canDelete('C:\\Windows\\System32\\file.tmp', category, scope, true)).toBe(false);
  });

  it('returns false when extension is forbidden', () => {
    expect(canDelete('C:\\Temp\\malware.exe', category, scope, true)).toBe(false);
  });

  it('returns false when category is not allowed', () => {
    expect(canDelete('C:\\Temp\\file.tmp', 'user_documents' as CleanCategory, scope, true)).toBe(false);
  });

  it('returns false when not confirmed by user', () => {
    expect(canDelete('C:\\Temp\\file.tmp', category, scope, false)).toBe(false);
  });

  it('blocks deletion even if only one condition fails', () => {
    // Path is valid, category valid, confirmed — but extension is .exe
    expect(canDelete('C:\\Temp\\setup.exe', category, scope, true)).toBe(false);

    // Path is valid, extension valid, confirmed — but category is unknown
    expect(canDelete('C:\\Temp\\file.tmp', 'unknown' as CleanCategory, scope, true)).toBe(false);

    // Everything valid — but not confirmed
    expect(canDelete('C:\\Temp\\file.tmp', category, scope, false)).toBe(false);
  });
});
