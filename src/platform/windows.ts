// ============================================================================
// Windows platform implementation
// ============================================================================

import { execSync, execFile } from 'node:child_process';
import { promises as fs, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { PlatformImpl } from './interface.js';
import { CleanCategory } from '../types.js';
import { BROWSER_CACHE_DIRS, BROWSER_NAMES } from '../constants.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Check if a file is locked by another process.
 * Tries to open the file with write access — if it fails, the file is locked.
 * Returns false for directories and already-deleted files.
 */
async function isFileLocked(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) return false; // directories handled differently
    // Try opening the file for write access briefly
    const handle = await fs.open(filePath, 'r+');
    await handle.close();
    return false;
  } catch {
    return true; // can't open = locked or missing
  }
}

function runPowerShell(script: string, timeoutMs = 30_000): string {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  // Use -NoProfile -NonInteractive -EncodedCommand for safe argument passing
  return execSync(
    `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
    { timeout: timeoutMs, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
  );
}

async function runPowerShellAsync(script: string, timeoutMs = 30_000): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const execFileAsync = promisify(execFile);
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { timeout: timeoutMs, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
  );
  return stdout;
}

function expandEnv(winPath: string): string {
  // Expand %VAR% style environment variables in a Windows path
  return winPath.replace(/%([^%]+)%/g, (_, name) => process.env[name] || `%${name}%`);
}

const userProfile = os.homedir();
const localAppData = process.env.LOCALAPPDATA || path.join(userProfile, 'AppData', 'Local');
const programData = process.env.PROGRAMDATA || 'C:\\ProgramData';
const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';

// ---------------------------------------------------------------------------
// Platform implementation
// ---------------------------------------------------------------------------

export const windowsPlatform: PlatformImpl = {
  name: 'Windows',

  // ---- Permissions -------------------------------------------------------

  isAdmin(): boolean {
    try {
      execSync('net session', { stdio: 'ignore', timeout: 3000 });
      return true;
    } catch {
      // Fallback: check via PowerShell
      try {
        const result = execSync(
          'powershell.exe -NoProfile -NonInteractive -Command "[bool](([System.Security.Principal.WindowsIdentity]::GetCurrent()).Groups -match \\"S-1-5-32-544\\")"',
          { encoding: 'utf-8', timeout: 5000 },
        );
        return result.trim().toLowerCase() === 'true';
      } catch {
        return false;
      }
    }
  },

  // ---- Known paths -------------------------------------------------------

  getTempPaths(): string[] {
    const paths: string[] = [];
    const userTemp = process.env.TEMP || process.env.TMP || path.join(localAppData, 'Temp');
    const systemTemp = path.join(systemRoot, 'Temp');
    if (userTemp) paths.push(userTemp);
    paths.push(systemTemp);
    return paths;
  },

  getBrowserCachePaths(): string[] {
    const candidates: string[] = [];
    // Chromium-based browsers store cache under User Data/<Profile>/<CacheDir>
    for (const browser of BROWSER_NAMES) {
      const browserDir = path.join(localAppData, browser);
      candidates.push(browserDir);
    }
    return candidates;
  },

  getWindowsUpdateCachePath(): string | null {
    return path.join(systemRoot, 'SoftwareDistribution', 'Download');
  },

  getDeliveryOptimizationPath(): string | null {
    return path.join(
      systemRoot,
      'ServiceProfiles',
      'NetworkService',
      'AppData',
      'Local',
      'Microsoft',
      'Windows',
      'DeliveryOptimization',
    );
  },

  getPrefetchPath(): string | null {
    return path.join(systemRoot, 'Prefetch');
  },

  getRecycleBinPath(): string | null {
    // $Recycle.Bin exists on each drive root
    return null; // Handled specially — each drive letter gets its own
  },

  getErrorReportPaths(): string[] {
    return [
      path.join(programData, 'Microsoft', 'Windows', 'WER'),
      path.join(localAppData, 'Microsoft', 'Windows', 'WER'),
    ];
  },

  // ---- File system operations -------------------------------------------

  async readDir(dirPath: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(dirPath);
      return entries.map((e) => path.join(dirPath, e));
    } catch {
      return [];
    }
  },

  async getFileInfo(filePath: string): Promise<{
    size: number;
    mtime: Date;
    atime: Date;
    isDirectory: boolean;
  } | null> {
    try {
      const stat = await fs.stat(filePath);
      return {
        size: stat.size,
        mtime: stat.mtime,
        atime: stat.atime,
        isDirectory: stat.isDirectory(),
      };
    } catch {
      return null;
    }
  },

  // ---- Deletion ----------------------------------------------------------

  async moveToRecycleBin(targetPath: string): Promise<void> {
    // Silently skip if file is locked — no dialogs, no user prompts
    if (await isFileLocked(targetPath)) {
      throw new Error('FILE_LOCKED');
    }

    const psScript = `
$ErrorActionPreference = 'Stop'
$path = '${targetPath.replace(/'/g, "''")}'
$shell = New-Object -ComObject Shell.Application
$item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
$folder = $shell.Namespace($item.Directory.FullName)
$file = $folder.ParseName($item.Name)
if ($file) {
    $file.InvokeVerb('delete')
} else {
    throw "Cannot parse item: $path"
}
`;
    // 10-second timeout per file — if COM hangs, we skip
    await runPowerShellAsync(psScript, 10_000);
  },

  async permanentDelete(targetPath: string): Promise<void> {
    // Silently skip if file is locked
    if (await isFileLocked(targetPath)) {
      throw new Error('FILE_LOCKED');
    }

    const info = await fs.stat(targetPath);
    if (info.isDirectory()) {
      await fs.rm(targetPath, { recursive: true, force: true });
    } else {
      await fs.unlink(targetPath);
    }
  },

  async emptyRecycleBin(): Promise<void> {
    // Uses SHEmptyRecycleBin via PowerShell COM
    const psScript = `
$shell = New-Object -ComObject Shell.Application
$recycleBin = $shell.Namespace(0xA)
if ($recycleBin) {
    $items = $recycleBin.Items()
    if ($items) {
        for ($i = $items.Count - 1; $i -ge 0; $i--) {
            $item = $items.Item($i)
            # Only delete items with recoverable paths (skip permanent-delete items)
            try { Remove-Item -LiteralPath $item.Path -Force -ErrorAction Stop } catch { }
        }
    }
}
`;
    await runPowerShellAsync(psScript, 60_000);
  },

  // ---- Category → concrete paths ----------------------------------------

  resolveCategoryPaths(category: CleanCategory): string[] {
    switch (category) {
      case 'temp_files':
        return this.getTempPaths();
      case 'browser_cache':
        return this.getBrowserCachePaths().filter((p) => {
          try { return statSync(p).isDirectory(); } catch { return false; }
        });
      case 'windows_update': {
        const p = this.getWindowsUpdateCachePath();
        return p ? [p] : [];
      }
      case 'delivery_optimization': {
        const p = this.getDeliveryOptimizationPath();
        return p ? [p] : [];
      }
      case 'prefetch': {
        const p = this.getPrefetchPath();
        return p ? [p] : [];
      }
      case 'recycle_bin':
        return ['C:\\$Recycle.Bin']; // primary drive
      case 'error_reports':
        return this.getErrorReportPaths();
      case 'log_files':
        return this.getTempPaths(); // only scan Temp for logs
      default:
        return [];
    }
  },
};
