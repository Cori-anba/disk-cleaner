# Disk Cleaner MCP

> 一句话清理磁盘，安全到可以闭着眼睛用。

> ⚠️ **请务必以管理员模式打开 PowerShell / 终端来运行你的 Agent，再调用本 skill！**
> 否则 Windows Update 缓存、Delivery Optimization、Prefetch 等系统级垃圾将无法访问，清理效果会大打折扣（通常少清理 10-30 GB）。

![运行结果示例](https://raw.githubusercontent.com/Cori-anba/disk-cleaner/main/运行结果示例.jpg)

你的 C 盘又红了？说一句「帮我清理 C 盘」，剩下的全自动搞定——**临时文件、浏览器缓存、Windows Update 残留、回收站**等 8 类垃圾一次性扫干净，通常能腾出 **15~40 GB** 空间。中间不需要你盯着，只有到最后遇到拿不准的文件时才会问你一声。

安全方面，System32、个人文档、桌面照片、程序目录、`.exe` `.dll` 等系统文件**硬编码在代码里永远不碰**——不是靠 AI 自觉，是代码层面直接拦截，AI 没权限绕过。

---

## 为什么选 Disk Cleaner MCP？

市面上清理工具很多，但要么需要你手动勾选操心，要么不敢放手给 AI。这个工具的设计理念是：

**你只负责说一句话，安全的事交给代码。**

| 你的顾虑 | 我们的方案 |
|----------|-----------|
| 怕删了系统文件？ | Rule Zero 硬编码黑名单，System32、Program Files 等 43 条路径 + 25 种扩展名直接拦截 |
| 怕删了重要文档？ | Documents、Desktop、Pictures、.ssh、.aws 等一律跳过 |
| 怕 AI 自作主张？ | 代码层五重校验，每删一个文件过一次安检，AI 只是翻译官 |
| 怕删错了找不回？ | 默认先进回收站再清空，全程生成 Manifest 清单，支持恢复 |
| 怕日常消耗 token？ | 不提到「清理」就不触发，日常写代码零 token 开销 |

---

## 使用体验

说一句话就开始，中间全自动，末尾才需要你拍板。

```
用户：帮我清理一下 C 盘

Agent：我将扫描以下内容：
       · Windows 临时文件
       · 浏览器缓存 (Chrome、Edge)
       · Windows Update 缓存
       · Delivery Optimization 文件
       · Prefetch 预读文件
       · 回收站
       
       扫描范围：C:\（系统关键路径已自动排除）
       清理模式：删除后清空回收站（可恢复）
       
       是否开始？

用户：开始吧

Agent：[自动扫描中...]
       
       扫描完成！
       🟢 可自动清理：387 项，共 22.3 GB
       🟡 需要你确认：12 项，共 8.7 GB
       
       正在自动清理第一类文件...

Agent：自动清理完成，已释放 22.3 GB。
       
       下面 12 个文件需要你过目一下：
       
       ① C:\Downloads\ChromeSetup_2024.exe  (245 MB, 半年前下载的)
          [删除] [保留]
       
       ② 发现重复文件：
          [A] C:\Temp\report_final.pdf (12.3 MB)
          [B] D:\Backup\report_final.pdf (12.3 MB, 内容完全相同)
          [删A] [删B] [都保留] [都删除]
       
       ...逐一确认...

Agent：✅ 清理完毕
       
       本次清理 C:\
       ───────────────
       共清理：  394 个文件
       释放空间：28.1 GB
       ├ 自动清理：387 项 / 22.3 GB
       └ 确认清理：  7 项 /  5.8 GB（另有 5 项你选择保留）
       
       如需恢复，可凭 Manifest 从回收站找回。
```

---

## 安装

### 环境要求

- [Node.js](https://nodejs.org/) >= 18.0.0
- Windows 系统（macOS / Linux 计划在 v0.2.0 支持）

### 步骤

```bash
# 克隆仓库
git clone https://github.com/Cori-anba/disk-cleaner.git
cd disk-cleaner

# 安装依赖
npm install

# 编译
npm run build
```

### 配置 MCP

在 `~/.claude/.mcp.json` 中添加：

```json
{
  "mcpServers": {
    "disk-cleaner": {
      "command": "npx",
      "args": ["tsx", "C:\\Users\\你的用户名\\.claude\\skills\\disk-cleaner-mcp\\src\\index.ts"]
    }
  }
}
```

配置完成后重启 Claude Code 即可使用。同时将 `disk-cleaner.md` skill 文件放入 `~/.claude/skills/` 目录。

---

## 安全机制详解

### 五重删除校验

每删一个文件，代码层必须同时满足以下五个条件：

```
✅ 1. 文件在用户指定的盘符/路径范围内
✅ 2. 文件路径不在禁止列表中
✅ 3. 文件扩展名不是系统/可执行类型
✅ 4. 文件类型在「可清理」白名单中
✅ 5. 用户已明确确认
```

五道闸门全通过才执行删除，缺一不可。**这些规则写在代码里，不是写在 prompt 里，AI 无权修改。**

### 绝不触碰的路径（扫描阶段直接跳过）

`C:\Windows\System32` · `SysWOW64` · `WinSxS` · `Boot` · `Fonts` · `Program Files` · `Program Files (x86)` · 用户 Documents · Desktop · Pictures · Music · Videos · `.ssh` · `.aws` · `.kube` · `AppData\Roaming` · `ProgramData\Microsoft`（WER 错误报告除外）· Recovery · EFI · System Volume Information

### 绝不删除的文件类型

`.exe` `.dll` `.sys` `.msi` `.bat` `.ps1` `.vbs` `.reg` `.com` `.drv` `.cpl` `.scr` 等 25 种系统/可执行扩展名。

### 可清理的 8 类垃圾

| 类别 | 具体内容 |
|------|---------|
| 临时文件 | `.tmp` `.temp` `~*` `.bak` `.old` |
| 浏览器缓存 | Chrome / Edge / Brave / Opera 缓存 |
| Windows Update 缓存 | `SoftwareDistribution\Download` |
| 传递优化文件 | Delivery Optimization 缓存 |
| 预读取文件 | `Windows\Prefetch\*.pf` |
| 回收站 | `$Recycle.Bin` 内容 |
| 系统错误报告 | Windows WER 崩溃转储 |
| 过期日志 | Temp 目录下超过 30 天的 `.log` |

---

## 恢复机制

默认使用「移入回收站 → 清空」模式，文件并非立即永久消失。如需恢复：

1. 打开桌面回收站
2. 按删除日期排序
3. 右键 → 还原

同时 `~/.disk-cleaner/manifests/` 下有每次清理的完整 JSON 清单，记录每个文件的路径、大小、哈希和时间戳。

---

## 项目结构

```
disk-cleaner-mcp/
├── src/
│   ├── index.ts              # MCP 服务入口，5 个工具注册
│   ├── scanner.ts            # 只读文件扫描器
│   ├── classifier.ts         # AUTO / CONFIRM 分类（硬规则）
│   ├── cleaner.ts            # 删除执行 + canDelete() 安全门
│   ├── duplicate-detector.ts # SHA-256 哈希 + 文件名相似度
│   ├── manifest-store.ts     # JSON 清单持久化
│   ├── reporter.ts           # 清理报告生成
│   ├── safety-rules.ts       # Rule Zero 安全规则集
│   ├── types.ts / constants.ts
│   └── platform/
│       ├── interface.ts      # 跨平台抽象接口
│       └── windows.ts        # Windows 实现
└── tests/ (53 个测试，全部通过)
```

---

## 路线图

- [x] v0.1.0 — Windows 支持、5 个 MCP 工具、Rule Zero 安全规则、AUTO/CONFIRM 分类
- [ ] v0.2.0 — macOS 支持
- [ ] v0.3.0 — Linux 支持
- [ ] v0.4.0 — npm 发布
- [ ] v0.5.0 — 定时扫描、自定义清理配置

---

## License

MIT
