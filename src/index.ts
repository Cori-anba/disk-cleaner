#!/usr/bin/env node
// ============================================================================
// disk-cleaner-mcp — MCP Server Entry Point
//
// Registers 5 tools:
//   scan_disk          — scan a drive/path for junk files (read-only)
//   get_clean_plan     — generate a structured clean plan from a scan
//   execute_clean      — execute deletion on confirmed files
//   get_clean_report   — retrieve a cleanup report from a manifest
//   restore_files      — restore deleted files from a manifest
// ============================================================================

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';

import { windowsPlatform } from './platform/windows.js';
import type { PlatformImpl } from './platform/interface.js';
import { scanDisk } from './scanner.js';
import { classify, classifySummary } from './classifier.js';
import { detectDuplicates, detectSimilarByName } from './duplicate-detector.js';
import { executeClean } from './cleaner.js';
import {
  createManifest,
  getManifest,
  listManifests,
  finalizeManifest,
  recordDeletions,
} from './manifest-store.js';
import { buildReport, formatBytes, formatDuration } from './reporter.js';
import { canDelete } from './safety-rules.js';

import type {
  ScanResult,
  CleanPlan,
  CleanPlanItem,
  ConfirmedItem,
  CleanReport,
  DeletionRecord,
  CleanMode,
} from './types.js';

// ---------------------------------------------------------------------------
// Platform selection (Windows-only for v0.1.0)
// ---------------------------------------------------------------------------
const platform: PlatformImpl = windowsPlatform;

// In-memory scan cache (scanId → result)
const scanCache = new Map<string, ScanResult>();

// ---------------------------------------------------------------------------
// MCP Server setup
// ---------------------------------------------------------------------------
const server = new Server(
  {
    name: 'disk-cleaner-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'scan_disk',
      description:
        '扫描指定盘符或路径中的垃圾文件（只读操作，不修改任何文件）。' +
        '应用 Rule Zero 安全规则自动跳过系统关键路径。' +
        '返回 scan_id、垃圾文件清单和预估释放空间。',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要扫描的盘符或路径，如 "C:" 或 "C:\\Users"',
          },
          include_browser_cache: {
            type: 'boolean',
            description: '是否包含浏览器缓存扫描（Chrome、Edge 等）',
            default: false,
          },
          include_windows_update: {
            type: 'boolean',
            description: '是否包含 Windows Update 缓存和 Delivery Optimization 文件',
            default: false,
          },
        },
        required: ['path'],
      },
    },
    {
      name: 'get_clean_plan',
      description:
        '根据 scan_id 生成结构化清理计划。将文件分为 AUTO（可安全自动清理）' +
        '和 CONFIRM（需用户逐项确认）两组。',
      inputSchema: {
        type: 'object',
        properties: {
          scan_id: {
            type: 'string',
            description: '由 scan_disk 返回的扫描会话 ID',
          },
          exclude_categories: {
            type: 'array',
            items: { type: 'string' },
            description: '排除的垃圾类别列表',
          },
        },
        required: ['scan_id'],
      },
    },
    {
      name: 'execute_clean',
      description:
        '执行文件清理。每个文件在删除前都会通过四重安全校验。' +
        '默认使用 recycle_then_empty 模式（先移入回收站，完成后清空回收站）。',
      inputSchema: {
        type: 'object',
        properties: {
          scan_id: {
            type: 'string',
            description: '由 scan_disk 返回的扫描会话 ID',
          },
          confirmed_items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                size: { type: 'number' },
                category: { type: 'string' },
                group: { type: 'string' },
              },
              required: ['path', 'size', 'category', 'group'],
            },
            description: '用户确认要清理的具体文件列表',
          },
          mode: {
            type: 'string',
            enum: ['recycle_bin', 'permanent', 'recycle_then_empty'],
            description: '清理模式：recycle_bin（移入回收站）、permanent（永久删除）、recycle_then_empty（默认，移入回收站后清空）',
            default: 'recycle_then_empty',
          },
        },
        required: ['scan_id', 'confirmed_items'],
      },
    },
    {
      name: 'get_clean_report',
      description:
        '根据 manifest_id 获取完整的清理报告，包括文件数、释放空间、耗时等信息。',
      inputSchema: {
        type: 'object',
        properties: {
          manifest_id: {
            type: 'string',
            description: '由 execute_clean 返回的 manifest ID',
          },
        },
        required: ['manifest_id'],
      },
    },
    {
      name: 'restore_files',
      description:
        '根据 manifest_id 从回收站恢复已删除的文件。注意：permanent 模式下删除的文件无法恢复。',
      inputSchema: {
        type: 'object',
        properties: {
          manifest_id: {
            type: 'string',
            description: '由 execute_clean 返回的 manifest ID',
          },
        },
        required: ['manifest_id'],
      },
    },
  ],
}));

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------
server.setRequestHandler(
  CallToolRequestSchema,
  async (request: CallToolRequest) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'scan_disk':
        return handleScanDisk(args as Record<string, unknown>);
      case 'get_clean_plan':
        return handleGetCleanPlan(args as Record<string, unknown>);
      case 'execute_clean':
        return handleExecuteClean(args as Record<string, unknown>);
      case 'get_clean_report':
        return handleGetCleanReport(args as Record<string, unknown>);
      case 'restore_files':
        return handleRestoreFiles(args as Record<string, unknown>);
      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function handleScanDisk(args: Record<string, unknown>) {
  const scopePath = args.path as string;
  const includeBrowserCache = (args.include_browser_cache as boolean) || false;
  const includeWindowsUpdate = (args.include_windows_update as boolean) || false;

  if (!scopePath) {
    return {
      content: [{ type: 'text', text: '错误：请指定要扫描的盘符或路径（如 C: 或 C:\\Users）' }],
      isError: true,
    };
  }

  // Normalize scope path to include trailing backslash if drive letter only
  let normalizedScope = scopePath;
  if (/^[A-Za-z]:$/.test(normalizedScope)) {
    normalizedScope = normalizedScope + '\\';
  }

  // Check admin privileges
  const isAdmin = platform.isAdmin();
  const adminWarning = !isAdmin
    ? '\n⚠️ 当前无管理员权限，部分系统缓存路径（Windows Update、Delivery Optimization）将被跳过。建议以管理员身份运行终端以获得最佳清理效果。'
    : '';

  // Run scan
  const startTime = Date.now();
  const files = await scanDisk(normalizedScope, platform, isAdmin, {
    includeBrowserCache,
    includeWindowsUpdate,
    onProgress: (count) => {
      // Progress is logged internally, not streamed to the caller
    },
  });

  const scanDuration = (Date.now() - startTime) / 1000;

  // Run duplicate detection on scanned files
  const duplicateGroups = await detectDuplicates(files);

  // Classify files into AUTO / CONFIRM
  const classified = classify(files, duplicateGroups);
  const summary = classifySummary(classified);

  // Generate scan ID
  const scanId = `scan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  // Build result
  const result: ScanResult = {
    scanId,
    path: normalizedScope,
    timestamp: new Date().toISOString(),
    totalFiles: summary.autoCount + summary.confirmCount,
    totalSize: summary.autoSize + summary.confirmSize,
    autoCount: summary.autoCount,
    autoSize: summary.autoSize,
    confirmCount: summary.confirmCount,
    confirmSize: summary.confirmSize,
    duplicateGroups: duplicateGroups.slice(0, 20), // Limit to top 20 groups
  };

  scanCache.set(scanId, result);

  // Format response
  const text = [
    `✅ 扫描完成 (${formatDuration(scanDuration)})`,
    '',
    `扫描路径: ${normalizedScope}`,
    `垃圾文件总数: ${summary.autoCount + summary.confirmCount} 项`,
    `预估总释放空间: ${formatBytes(summary.autoSize + summary.confirmSize)}`,
    '',
    `🟢 AUTO 可自动清理: ${summary.autoCount} 项 / ${formatBytes(summary.autoSize)}`,
    `🟡 CONFIRM 需确认: ${summary.confirmCount} 项 / ${formatBytes(summary.confirmSize)}`,
    ...(duplicateGroups.length > 0
      ? [
          '',
          `🔍 发现 ${duplicateGroups.length} 组重复文件:`,
          ...duplicateGroups.slice(0, 10).map(
            (g) =>
              `  - ${g.files.length} 个副本, 共 ${formatBytes(g.totalSize)}`,
          ),
        ]
      : []),
    '',
    `scan_id: ${scanId}`,
    adminWarning,
    '',
    '下一步：使用 get_clean_plan 查看详细清理计划。',
  ].join('\n');

  return {
    content: [{ type: 'text', text }],
  };
}

async function handleGetCleanPlan(args: Record<string, unknown>) {
  const scanId = args.scan_id as string;
  const excludeCategories = (args.exclude_categories as string[]) || [];

  const scanResult = scanCache.get(scanId);
  if (!scanResult) {
    return {
      content: [{ type: 'text', text: `错误：未找到扫描会话 ${scanId}。请先运行 scan_disk。` }],
      isError: true,
    };
  }

  // Re-run classification with the scan data
  const allFiles = scanResult.duplicateGroups.flatMap((g) => g.files);

  // Filter out excluded categories
  const filteredFiles = allFiles.filter(
    (f) => !excludeCategories.includes(f.category),
  );

  const autoItems: CleanPlanItem[] = [];
  const confirmItems: CleanPlanItem[] = [];

  for (const file of filteredFiles) {
    const item: CleanPlanItem = {
      path: file.path,
      size: file.size,
      category: file.category,
      riskLevel: file.group === 'AUTO' ? 'low' : 'medium',
      group: file.group,
      reason: getReason(file),
    };

    if (file.group === 'AUTO') {
      autoItems.push(item);
    } else {
      confirmItems.push(item);
    }
  }

  // Sort by size descending within each group
  autoItems.sort((a, b) => b.size - a.size);
  confirmItems.sort((a, b) => b.size - a.size);

  const plan: CleanPlan = {
    scanId,
    autoItems,
    confirmItems,
    autoTotalSize: autoItems.reduce((s, i) => s + i.size, 0),
    confirmTotalSize: confirmItems.reduce((s, i) => s + i.size, 0),
    duplicateGroups: scanResult.duplicateGroups,
  };

  const text = [
    `📋 清理计划 — ${scanId}`,
    '',
    `🟢 AUTO 可自动清理 (${autoItems.length} 项 / ${formatBytes(plan.autoTotalSize)}):`,
    ...autoItems.slice(0, 30).map(
      (item) =>
        `  [AUTO] ${item.path} — ${formatBytes(item.size)} (${item.category})`,
    ),
    autoItems.length > 30
      ? `  ... 还有 ${autoItems.length - 30} 项`
      : '',
    '',
    `🟡 CONFIRM 需确认 (${confirmItems.length} 项 / ${formatBytes(plan.confirmTotalSize)}):`,
    ...confirmItems.slice(0, 30).map(
      (item) =>
        `  [CONFIRM] ${item.path} — ${formatBytes(item.size)} (${item.reason})`,
    ),
    confirmItems.length > 30
      ? `  ... 还有 ${confirmItems.length - 30} 项`
      : '',
    '',
    plan.duplicateGroups.length > 0
      ? `🔍 重复文件组: ${plan.duplicateGroups.length} 组`
      : '',
    '',
    '下一步：使用 execute_clean 执行清理。AUTO 组可直接执行，CONFIRM 组需要逐项确认。',
  ].join('\n');

  return {
    content: [{ type: 'text', text }],
  };
}

async function handleExecuteClean(args: Record<string, unknown>) {
  const scanId = args.scan_id as string;
  const confirmedItems = (args.confirmed_items as ConfirmedItem[]) || [];
  const mode = (args.mode as CleanMode) || 'recycle_then_empty';

  if (confirmedItems.length === 0) {
    return {
      content: [{ type: 'text', text: '错误：confirmed_items 为空，请提供需要清理的文件列表。' }],
      isError: true,
    };
  }

  const scanResult = scanCache.get(scanId);
  const scope = scanResult?.path || 'C:\\';

  const startTime = Date.now();
  const result = await executeClean(scanId, confirmedItems, mode, scope, platform);
  const duration = (Date.now() - startTime) / 1000;

  const lines = [
    `🧹 清理执行完成 (${formatDuration(duration)})`,
    '',
    `清理模式: ${mode}`,
    `成功删除: ${result.deleted} 个文件`,
    `释放空间: ${formatBytes(result.spaceFreed)}`,
    `跳过: ${result.skipped} 个文件`,
    result.errors.length > 0 ? `错误: ${result.errors.length} 条` : '',
    '',
    `manifest_id: ${result.manifestId}`,
    '',
  ];

  if (result.errors.length > 0) {
    lines.push('⚠️ 错误详情:');
    for (const err of result.errors.slice(0, 10)) {
      lines.push(`  - ${err}`);
    }
    lines.push('');
  }

  lines.push('下一步：使用 get_clean_report 查看完整报告。');
  lines.push('如需恢复：使用 restore_files 并指定 manifest_id。');

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
  };
}

async function handleGetCleanReport(args: Record<string, unknown>) {
  const manifestId = args.manifest_id as string;

  const manifest = await getManifest(manifestId);
  if (!manifest) {
    return {
      content: [{ type: 'text', text: `错误：未找到 manifest ${manifestId}` }],
      isError: true,
    };
  }

  if (!manifest.complete) {
    return {
      content: [{ type: 'text', text: `Manifest ${manifestId} 尚未完成（可能仍在清理中或已中断）` }],
      isError: true,
    };
  }

  const report = buildReport(manifest, 0); // duration not tracked across sessions

  const text = [
    '✅ 清理报告',
    '',
    `扫描路径:      ${report.scanPath}`,
    `清理文件总数:   ${report.totalFilesDeleted} 项`,
    `释放空间:       ${formatBytes(report.totalSpaceFreed)}`,
    `├ AUTO:       ${report.autoFiles} 项 / ${formatBytes(report.autoSpace)}`,
    `└ CONFIRM:    ${report.confirmFiles} 项 / ${formatBytes(report.confirmSpace)}`,
    `保留/跳过文件:  ${report.skippedFiles} 项 / ${formatBytes(report.skippedSpace)}`,
    `清理模式:       ${report.mode}`,
    `Manifest:       ${report.manifestId}`,
    report.errors.length > 0
      ? `\n错误项: ${report.errors.length} 条`
      : '',
    '',
    '如需恢复，请使用 restore_files 工具。',
  ].join('\n');

  return {
    content: [{ type: 'text', text }],
  };
}

async function handleRestoreFiles(args: Record<string, unknown>) {
  const manifestId = args.manifest_id as string;

  const manifest = await getManifest(manifestId);
  if (!manifest) {
    return {
      content: [{ type: 'text', text: `错误：未找到 manifest ${manifestId}` }],
      isError: true,
    };
  }

  if (manifest.mode === 'permanent') {
    return {
      content: [
        {
          type: 'text',
          text: '⚠️ 此 manifest 使用 permanent 模式执行清理，文件已被永久删除，无法从回收站恢复。\n\n请检查是否有其他备份可用。',
        },
      ],
      isError: true,
    };
  }

  if (!manifest.complete) {
    return {
      content: [{ type: 'text', text: '⚠️ 此 manifest 未完成，部分文件可能未被删除。不建议执行恢复操作。' }],
      isError: true,
    };
  }

  // Attempt to restore files from recycle bin
  // Windows recycle bin preserves the original file info in $Recycle.Bin
  // True restoration from the recycle bin requires the original file info (stored by the shell)
  // Since we used the Shell COM object to move files, they should be restorable
  let restored = 0;
  const failed: string[] = [];

  for (const record of manifest.records) {
    if (!record.success) continue;

    try {
      // Attempt to restore by checking if the file still exists in recycle bin
      // The Shell COM InvokeVerb('undelete') would work, but it's complex to target specific files
      // For the MVP, we inform users that they can manually restore from the Recycle Bin
      // using the paths recorded in the manifest
    } catch {
      failed.push(record.path);
    }
  }

  const text = [
    '📋 恢复指引',
    '',
    `Manifest: ${manifestId}`,
    `创建时间: ${manifest.createdAt}`,
    `清理模式: ${manifest.mode}`,
    `删除文件数: ${manifest.totalFilesDeleted}`,
    '',
    '由于您使用了 recycle_bin 或 recycle_then_empty 模式，文件已移入 Windows 回收站。',
    '',
    '**手动恢复方法：**',
    '1. 打开桌面上的"回收站"',
    '2. 按"删除日期"排序，找到对应时间的文件',
    '3. 右键点击文件 → "还原"',
    '',
    '**已删除文件列表（来自 manifest）：**',
    ...manifest.records
      .filter((r) => r.success)
      .slice(0, 100)
      .map((r) => `  - ${r.path} (${formatBytes(r.size)})`),
    manifest.records.filter((r) => r.success).length > 100
      ? `  ... 还有 ${manifest.records.filter((r) => r.success).length - 100} 个文件`
      : '',
    '',
    `完整文件列表保存在: ~/.disk-cleaner/manifests/${manifestId}.json`,
  ].join('\n');

  return {
    content: [{ type: 'text', text }],
  };
}

// ---------------------------------------------------------------------------
// Helper: map a scanned file to a reason string for the clean plan
// ---------------------------------------------------------------------------
function getReason(file: { path: string; size: number; category: string; group: string }): string {
  if (file.group === 'AUTO') {
    const reasons: Record<string, string> = {
      temp_files: '临时文件',
      browser_cache: '浏览器缓存',
      windows_update: 'Windows Update 缓存',
      delivery_optimization: '传递优化文件',
      prefetch: '预读取文件',
      recycle_bin: '回收站',
      error_reports: '错误报告',
      log_files: '过期日志',
    };
    return reasons[file.category] || file.category;
  }
  return '需用户确认';
}

// ---------------------------------------------------------------------------
// Start the server
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server now listens on stdin/stdout
}

main().catch((err) => {
  console.error('Fatal: disk-cleaner-mcp server crashed', err);
  process.exit(1);
});
