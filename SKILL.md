---
name: disk-cleaner
description: 安全磁盘清理工具 — 扫描并清理 C盘/D盘等指定路径的垃圾文件（临时文件、浏览器缓存、Windows Update 缓存等）。用户显式调用后生效，日常对话不消耗 token。
---

# Disk Cleaner Skill

当用户请求清理磁盘空间时（如"清理C盘"、"释放D盘空间"），使用 MCP disk-cleaner 服务器的工具执行清理。

## 核心原则

1. **前置授权一次** — 扫描前向用户确认：扫描范围、垃圾类别、清理模式、权限需求
2. **中间全自动** — AUTO 组文件自动清理，不中断询问
3. **末尾集中确认** — CONFIRM 组文件（重复文件、大文件、旧安装包）逐项让用户选择
4. **安全硬约束** — Rule Zero 规则由 MCP 工具强制执行，LLM 无权绕过

## 工具使用流程

### Step 1: scan_disk

```
调用 scan_disk:
  path: 用户指定的盘符或路径（如 "C:" 或 "D:\Downloads"）
  include_browser_cache: 询问用户是否包含浏览器缓存
  include_windows_update: 询问用户是否包含 Windows Update 缓存
```

扫描完成后，向用户汇报：
- 扫描到的垃圾文件总数和总大小
- AUTO 可自动清理的数量和大小
- CONFIRM 需确认的数量和大小
- 如有重复文件组，列出

### Step 2: get_clean_plan

调用 get_clean_plan(scan_id) 获取详细清理计划，展示给用户确认。

### Step 3: execute_clean

AUTO 组：先执行 execute_clean 清理 AUTO 组文件。
CONFIRM 组：逐项展示，让用户对每项选择 [删除] [保留] [全部删除] [全部保留]。

默认使用 mode: "recycle_then_empty"。

### Step 4: get_clean_report

清理完成后调用 get_clean_report(manifest_id)，向用户展示：
- 清理文件总数、释放空间
- AUTO/CONFIRM 分别的统计
- 跳过的文件数
- manifest_id（用于恢复）

## 注意事项

- 如果用户说"清理C盘"，默认执行全盘扫描
- 如果用户指定了具体路径（如"清理 Downloads 文件夹"），则 scope 限定为对应路径
- 提醒用户：默认使用 recycle_then_empty 模式，文件会先进回收站再清空
- manifest 保存在 ~/.disk-cleaner/manifests/，用户可以用 restore_files 恢复
- 如果检测到无管理员权限，告知用户并以降级模式运行
- **被占用的文件自动跳过**：execute_clean 在遇到文件被其他进程锁定时，自动跳过该文件并记录到报告，不弹出任何对话框或询问用户——用户只需在最终报告中看到跳过项
