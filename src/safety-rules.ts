// ============================================================================
// Rule Zero — Hard-coded safety rules. LLM CANNOT modify these.
// Every deletion MUST pass the four-AND check in canDelete().
// ============================================================================

import { CleanCategory } from './types.js';

// ---------------------------------------------------------------------------
// Layer 1 — Forbidden paths (regular expressions, matched case-insensitive)
// ---------------------------------------------------------------------------

const FORBIDDEN_PATHS: RegExp[] = [
  // Windows system directories
  /^[A-Z]:\\Windows\\System32/i,
  /^[A-Z]:\\Windows\\SysWOW64/i,
  /^[A-Z]:\\Windows\\System/i,
  /^[A-Z]:\\Windows\\WinSxS/i,
  /^[A-Z]:\\Windows\\Boot/i,
  /^[A-Z]:\\Windows\\Fonts/i,
  /^[A-Z]:\\Windows\\INF/i,
  /^[A-Z]:\\Windows\\Installer/i,
  /^[A-Z]:\\Windows\\servicing/i,

  // Program installations
  /^[A-Z]:\\Program Files/i,
  /^[A-Z]:\\Program Files \(x86\)/i,

  // User data (Documents, Desktop, media, cloud)
  /^[A-Z]:\\Users\\.+\\Documents/i,
  /^[A-Z]:\\Users\\.+\\Desktop/i,
  /^[A-Z]:\\Users\\.+\\Pictures/i,
  /^[A-Z]:\\Users\\.+\\Music/i,
  /^[A-Z]:\\Users\\.+\\Videos/i,
  /^[A-Z]:\\Users\\.+\\OneDrive/i,
  /^[A-Z]:\\Users\\.+\\Dropbox/i,
  /^[A-Z]:\\Users\\.+\\Google Drive/i,

  // Sensitive config
  /^[A-Z]:\\Users\\.+\\.ssh/i,
  /^[A-Z]:\\Users\\.+\\.gnupg/i,
  /^[A-Z]:\\Users\\.+\\.gitconfig/i,
  /^[A-Z]:\\Users\\.+\\.npmrc/i,
  /^[A-Z]:\\Users\\.+\\.aws/i,
  /^[A-Z]:\\Users\\.+\\.azure/i,
  /^[A-Z]:\\Users\\.+\\.kube/i,

  // AppData Roaming — entirely forbidden (browser caches live in Local, not Roaming)
  /^[A-Z]:\\Users\\.+\\AppData\\Roaming/i,

  // ProgramData\Microsoft — forbidden except WER error reports (see EXEMPT_PATTERNS)
  /^[A-Z]:\\ProgramData\\Microsoft/i,

  // AppData Local — sensitive subdirectories only (Temp is explicitly allowed)
  /^[A-Z]:\\Users\\.+\\AppData\\Local\\Microsoft\\Windows\\History/i,
  /^[A-Z]:\\Users\\.+\\AppData\\Local\\Microsoft\\Windows\\INetCache\\Low/i,
  /^[A-Z]:\\Users\\.+\\AppData\\Local\\Microsoft\\Credentials/i,
  /^[A-Z]:\\Users\\.+\\AppData\\Local\\Microsoft\\TokenBroker/i,
  /^[A-Z]:\\Users\\.+\\AppData\\Local\\Microsoft\\Vault/i,
  /^[A-Z]:\\Users\\.+\\AppData\\Local\\Packages/i,

  // Boot / recovery
  /^[A-Z]:\\Boot/i,
  /^[A-Z]:\\Recovery/i,
  /^[A-Z]:\\EFI/i,
  /^[A-Z]:\\System Volume Information/i,

  // Registry hives
  /\\SYSTEM32\\config\\[A-Z]+$/i,
  /\\.reg$/i,
];

/**
 * Paths that would be caught by FORBIDDEN_PATHS but are explicitly allowed
 * because they contain known-safe junk data. Checked AFTER forbidden patterns.
 */
const EXEMPT_PATTERNS: RegExp[] = [
  // Windows Error Reporting (crash dumps = safe to clean)
  /^[A-Z]:\\ProgramData\\Microsoft\\Windows\\WER/i,
  /^[A-Z]:\\Users\\.+\\AppData\\Local\\Microsoft\\Windows\\WER/i,

  // Browser cache directories within AppData\Local (Chromium-based)
  /^[A-Z]:\\Users\\.+\\AppData\\Local\\(?:Google\\Chrome|Microsoft\\Edge|BraveSoftware\\Brave-Browser|Opera Software\\Opera|Vivaldi\\Vivaldi)\\User Data/i,

  // Temp directories (explicitly allowed within Local)
  /^[A-Z]:\\Users\\.+\\AppData\\Local\\Temp/i,
  /^[A-Z]:\\Windows\\Temp/i,

  // Delivery Optimization (within system paths)
  /^[A-Z]:\\Windows\\ServiceProfiles\\NetworkService\\AppData\\Local\\Microsoft\\Windows\\DeliveryOptimization/i,

  // SoftwareDistribution download cache
  /^[A-Z]:\\Windows\\SoftwareDistribution\\Download/i,

  // Prefetch
  /^[A-Z]:\\Windows\\Prefetch/i,

  // Recycle Bin
  /^[A-Z]:\\\$Recycle\.Bin/i,
];

// ---------------------------------------------------------------------------
// Layer 2 — Forbidden file extensions (system / executable files)
// ---------------------------------------------------------------------------

const FORBIDDEN_EXTENSIONS: ReadonlySet<string> = new Set([
  '.exe', '.dll', '.sys', '.drv', '.msi', '.msu', '.msp',
  '.com', '.bat', '.cmd', '.ps1', '.psm1', '.psd1',
  '.vbs', '.vbe', '.js', '.wsf', '.wsh', '.hta',
  '.reg', '.inf', '.cab', '.ocx', '.ax',
  '.cpl', '.scr', '.efi', '.fon', '.otf',
  '.mui', '.mun', '.cat', '.manifest',
  '.evtx', '.pol',
]);

// ---------------------------------------------------------------------------
// Layer 3 — Allowed clean categories (whitelist)
// ---------------------------------------------------------------------------

const ALLOWED_CATEGORIES: ReadonlySet<CleanCategory> = new Set([
  'temp_files',
  'browser_cache',
  'windows_update',
  'delivery_optimization',
  'prefetch',
  'recycle_bin',
  'error_reports',
  'log_files',
]);

// ---------------------------------------------------------------------------
// Exported check functions
// ---------------------------------------------------------------------------

/**
 * Check if a path is within the user-specified scope.
 * e.g. scope="C:" means path must start with "C:" or "c:".
 */
export function isWithinScope(filePath: string, scope: string): boolean {
  const normalizedPath = filePath.toLowerCase();
  const normalizedScope = scope.toLowerCase();
  return normalizedPath.startsWith(normalizedScope);
}

/** Check if a path matches any forbidden-pattern rule, after exemptions. */
export function isForbiddenPath(filePath: string): boolean {
  // First, check if the path is in an explicitly-allowed exemption
  if (EXEMPT_PATTERNS.some((pattern) => pattern.test(filePath))) {
    return false;
  }

  // Then check against all forbidden patterns
  return FORBIDDEN_PATHS.some((pattern) => pattern.test(filePath));
}

/** Check if a file extension is system-critical and must not be deleted. */
export function isForbiddenExtension(filePath: string): boolean {
  const ext = filePath.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  if (!ext) return false;
  return FORBIDDEN_EXTENSIONS.has(ext);
}

/** Check if a category is in the allowed whitelist. */
export function isAllowedCategory(category: CleanCategory): boolean {
  return ALLOWED_CATEGORIES.has(category);
}

/**
 * THE four-AND gate.  All four conditions must be true for a file to be
 * eligible for deletion.  This is called inside cleaner.ts for every
 * individual delete operation — it is the hard safety boundary.
 */
export function canDelete(
  filePath: string,
  category: CleanCategory,
  scope: string,
  confirmed: boolean,
): boolean {
  // 1. Path must be within the user-specified scope
  if (!isWithinScope(filePath, scope)) return false;

  // 2. Path must NOT be in the forbidden list
  if (isForbiddenPath(filePath)) return false;

  // 3. Extension must NOT be forbidden
  if (isForbiddenExtension(filePath)) return false;

  // 4. Category must be in the allowed whitelist
  if (!isAllowedCategory(category)) return false;

  // 5. File must be explicitly confirmed by the user
  if (!confirmed) return false;

  return true;
}

/** Expose a read-only copy of forbidden paths for debugging / tests. */
export function getForbiddenPaths(): readonly RegExp[] {
  return FORBIDDEN_PATHS;
}

/** Expose a read-only copy of forbidden extensions for debugging / tests. */
export function getForbiddenExtensions(): ReadonlySet<string> {
  return FORBIDDEN_EXTENSIONS;
}

/** Expose allowed categories for debugging / tests. */
export function getAllowedCategories(): ReadonlySet<CleanCategory> {
  return ALLOWED_CATEGORIES;
}
