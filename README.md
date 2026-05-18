# Disk Cleaner MCP

> A safety-first disk cleanup MCP server for AI agents (Claude Code, Codex, Gemini CLI).
> Scans, classifies, and cleans junk files — the agent manages the workflow, but **you** control every deletion.

## Why Disk Cleaner MCP?

Your C drive fills up with temp files, browser caches, Windows Update leftovers, and forgotten downloads. This MCP server gives AI agents the ability to **safely** find and clean these files — but unlike a traditional "cleaner" tool, the decision to delete is always yours.

### Key Principles

- **Explicit invocation only** — zero token cost when not in use. The MCP server only activates when the agent calls its tools.
- **Safety is hard-coded, not prompted** — Rule Zero forbids touching system directories, user documents, and executables. The LLM cannot override these rules.
- **User controls every deletion** — AUTO files can be bulk-approved, CONFIRM files are reviewed one-by-one at the end.
- **Recoverable by default** — files go to the Recycle Bin first, with a manifest tracking every operation.

## Features

- **5 MCP tools**: `scan_disk`, `get_clean_plan`, `execute_clean`, `get_clean_report`, `restore_files`
- **8 junk categories**: temp files, browser cache, Windows Update cache, Delivery Optimization, Prefetch, Recycle Bin, error reports, stale logs
- **Rule Zero safety**: hard-coded forbidden paths, forbidden extensions, and a four-AND deletion gate
- **AUTO / CONFIRM classification**: safe files are cleaned in bulk; large/duplicate/suspicious files await your approval
- **Duplicate detection**: SHA-256 content hashing + filename similarity analysis
- **Persistent manifests**: every deletion logged to `~/.disk-cleaner/manifests/` for recovery and auditing
- **Admin privilege detection**: auto-detects and gracefully degrades when running without admin rights

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18.0.0
- Windows (macOS/Linux support planned for v0.2.0)

### Setup

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/disk-cleaner-mcp.git
cd disk-cleaner-mcp

# Install dependencies
npm install

# Build
npm run build
```

### MCP Configuration

Add to your Claude Code `settings.json` (`~/.claude/settings.json`):

**Development (local clone):**
```json
{
  "mcpServers": {
    "disk-cleaner": {
      "command": "npx",
      "args": ["tsx", "C:\\Users\\YOUR_NAME\\path\\to\\disk-cleaner-mcp\\src\\index.ts"]
    }
  }
}
```

**After npm publish:**
```json
{
  "mcpServers": {
    "disk-cleaner": {
      "command": "npx",
      "args": ["disk-cleaner-mcp"]
    }
  }
}
```

Restart Claude Code after configuration.

## Usage

Start a conversation with Claude Code and say:

> "请调用 disk-cleaner skill，帮我清理一下 C 盘空间"

The agent will:

1. **Ask for authorization** — shows what will be scanned, required permissions, and the cleanup mode
2. **Run scan** → auto-classify files into AUTO (safe) and CONFIRM (needs review)
3. **Execute AUTO cleanup** — cleans temp files, browser cache, Windows Update leftovers, etc.
4. **Present CONFIRM items** — duplicate files, large old installers, crash dumps — one by one for your decision
5. **Show final report** — files deleted, space freed, skipped items, manifest ID

### Example Conversation

```
User: 清理 C 盘

Agent: 我将扫描以下垃圾类型：
       - Windows 临时文件
       - 浏览器缓存 (Chrome, Edge)
       - Windows Update 缓存
       - Delivery Optimization 文件
       - Prefetch
       - 回收站
       
       扫描范围: C:\ (不含系统关键路径)
       清理模式: 删除后清空回收站
       
       是否继续？

User: 确认

Agent: [scans silently...]
       扫描完成。
       AUTO 可安全清理: 387 项, 22.3 GB
       CONFIRM 待确认: 12 项, 8.7 GB
       正在执行 AUTO 清理...

Agent: AUTO 清理完成，已释放 22.3 GB。
       以下 12 项需要你逐一确认：
       
       ① C:\Downloads\ChromeSetup_2024.exe (245 MB, 6个月前)
       [删除] [保留]

       ...

Agent: ✅ 清理完成
       释放空间: 28.1 GB
       Manifest: ~/.disk-cleaner/manifests/2026-05-19-1432.json
```

## Architecture

```
disk-cleaner-mcp/
├── src/
│   ├── index.ts              # MCP Server entry — 5 tool handlers
│   ├── scanner.ts            # Read-only filesystem walker
│   ├── classifier.ts         # AUTO / CONFIRM split (hard rules)
│   ├── cleaner.ts            # Deletion executor + canDelete() gate
│   ├── duplicate-detector.ts # SHA-256 hash + Levenshtein similarity
│   ├── manifest-store.ts     # JSON manifest persistence
│   ├── reporter.ts           # Report generation + formatting
│   ├── safety-rules.ts       # Rule Zero — forbidden paths, extensions, categories
│   ├── types.ts              # Shared TypeScript types
│   ├── constants.ts          # Thresholds and configuration
│   └── platform/
│       ├── interface.ts      # Cross-platform abstraction
│       └── windows.ts        # Windows implementation
└── tests/
    ├── safety-rules.test.ts
    ├── classifier.test.ts
    ├── duplicate-detector.test.ts
    └── cleaner-reporter.test.ts
```

## Safety Design (Rule Zero)

### Four-AND Deletion Gate

Every single file deletion passes through `canDelete()` in `safety-rules.ts`:

```
✅ 1. Path is within user-specified scope
✅ 2. Path is NOT in the forbidden-path list
✅ 3. Extension is NOT a system/executable type
✅ 4. Category is in the allowed-cleanup whitelist
✅ 5. File has been explicitly confirmed by the user
```

All five must pass. The LLM cannot modify these rules.

### Forbidden Paths (never scanned)

- `C:\Windows\System32`, `SysWOW64`, `WinSxS`, `Boot`, `Fonts`
- `C:\Program Files`, `C:\Program Files (x86)`
- User Documents, Desktop, Pictures, Music, Videos
- `.ssh`, `.aws`, `.kube`, `.gnupg` — all sensitive config
- `C:\ProgramData\Microsoft` (except WER error reports)
- `C:\Users\*\AppData\Roaming` (entirely)
- `C:\Recovery`, `C:\EFI`, `C:\System Volume Information`

### Forbidden Extensions (never deleted)

`.exe`, `.dll`, `.sys`, `.msi`, `.bat`, `.ps1`, `.vbs`, `.reg`, and 20+ more.

### Allowed Clean Categories (only these can be cleaned)

| Category | What it covers |
|----------|---------------|
| `temp_files` | `.tmp`, `.temp`, `~*`, `.bak`, `.old` |
| `browser_cache` | Chrome/Edge/Brave/Opera cache dirs |
| `windows_update` | `SoftwareDistribution\Download` |
| `delivery_optimization` | Delivery Optimization cache |
| `prefetch` | `Windows\Prefetch\*.pf` |
| `recycle_bin` | `$Recycle.Bin` contents |
| `error_reports` | Windows WER crash dumps |
| `log_files` | `.log` files older than 30 days in Temp |

## Recovery

Files are moved to the **Recycle Bin** by default (`recycle_then_empty` mode).

1. Open the Recycle Bin on your desktop
2. Sort by date deleted
3. Right-click → Restore

A full manifest is saved to `~/.disk-cleaner/manifests/` with every file path, size, and hash.

> **Warning:** `permanent` mode bypasses the Recycle Bin. Only use this if you're certain.

## Testing

```bash
npm test
```

## Roadmap

- [x] v0.1.0 — Windows support, 5 MCP tools, Rule Zero, AUTO/CONFIRM classification
- [ ] v0.2.0 — macOS support
- [ ] v0.3.0 — Linux support
- [ ] v0.4.0 — npm package publication
- [ ] v0.5.0 — Scheduled scans, custom cleanup profiles

## License

MIT
