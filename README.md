# ForuForge · 项目约束

把一句项目目标整理成可核对的约束、问题和执行资料。ForuForge 是一个 **Codex skill + Windows 本地桌面画布**：主聊天分析目标并选择开发级别，画布按目录展示问题，用户确认后导出任务书或 AI 项目约束。主聊天负责复核、分工和验收。

## 能做什么

- 固定本次项目目标，按「项目 → 大项 → 小项 → 原子便签」记录需求、约束、问题、验收和风险。
- 提供生产级、小范围应用、作业演示三档问题模板；每档初始有 18 个问题，选项附好处和代价。便签和政策会参与补充问题及冲突检查。
- 管理遇问题策略、外部依赖、数据、环境等全局政策；硬约束解锁记录理由、审批人和时间。
- 在提交或导出前列出未回答的阻塞问题和必填政策。用户可以补全，或留下确认人和理由，导出标为「未完成规划草案」的资料。
- 导出纯文本或 JSON 格式的项目任务书与 AI 项目约束。跨聊天协作由主聊天按 [SKILL.md](SKILL.md) 执行，画布只保存项目决策。

问题由本地模板和规则生成；当前版本没有调用 AI 自动生成问题。项目 JSON 保存在指定位置，每次修改前生成带时间戳的备份。

## 环境与安装

- Windows 10/11、Node.js 20+、PowerShell 7 (`pwsh`)、Microsoft Edge WebView2 Runtime。
- 桌面宿主是未签名的 `native/ProjectConstraints.exe`；对应 C# 源码在 `native/CanvasWindow.cs`。本地服务仅监听 `127.0.0.1`。

将仓库克隆或解压到 Codex 的 skills 目录，并保留目录名 `codex-project-constraint-canvas`：

```powershell
git clone https://github.com/Speraymer/foruforge.git "$env:CODEX_HOME\skills\codex-project-constraint-canvas"
```

如果未设置 `CODEX_HOME`，把目标路径换成实际 Codex 配置目录的 `skills\codex-project-constraint-canvas`。在 Codex 主聊天中调用 `$codex-project-constraint-canvas`，说出项目目标；主聊天会先确认开发级别，再初始化本次会话的项目文件并打开画布。用户在画布提交后，回主聊天说「画布已提交」。

| 开发级别 | 适用范围 | 问题侧重 |
|---|---|---|
| 生产级 `enterprise` | 真实上线、接口集成、真实资金或敏感数据 | 接口、鉴权、审计、恢复与合规 |
| 小范围 `small` | 小团队或局部使用 | 流程、角色、数据、交付 |
| 作业演示 `coursework` | 课堂作业或逻辑演示 | 题目、示例数据、演示与提交 |

## 手动启动与数据

主聊天通常会根据用户的实际目标完成以下步骤。手动运行时，命令会提示输入本次目标，并为这次运行创建独立项目文件：

```powershell
$projectFile = Join-Path (Get-Location) ('work\project-' + [guid]::NewGuid().ToString('N') + '.json')
$goal = Read-Host '输入本次项目目标'
$url = node .\scripts\launch.mjs $projectFile
$body = @{ goal = $goal; profile = 'small' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri ($url.TrimEnd('/') + '/api/start') -ContentType 'application/json' -Body $body
node .\scripts\open-app.mjs $projectFile
```

上例的 `small` 只是手动演示所选级别；主聊天会按实际用途选择 `enterprise`、`small` 或 `coursework`。`/api/start` 只初始化一次。更换目标时使用新的项目文件。项目文件、执行包、日志和备份都留在项目文件旁边；它们含用户输入，公开仓库不包含这些数据。

## 开发与验证

```powershell
node --test test/*.test.mjs
node --check ui/app.js
node --check ui/server.mjs
```

Windows 桌面宿主可用 .NET Framework 4.x 自带的 C# 编译器重建，编译产物输出到 `build`；运行时需将 `native` 中的 WebView2 DLL 放在 EXE 旁边：

```powershell
$native = (Resolve-Path .\native).Path
New-Item -ItemType Directory -Force .\build | Out-Null
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe "/out:build\ProjectConstraints.exe" "/reference:$native\Microsoft.Web.WebView2.Core.dll" "/reference:$native\Microsoft.Web.WebView2.WinForms.dll" "/win32icon:$native\ProjectConstraints.ico" "/win32manifest:$native\ProjectConstraints.manifest" "$native\CanvasWindow.cs"
Copy-Item .\native\*.dll .\build\
```

## 项目结构

| 路径 | 内容 |
|---|---|
| `SKILL.md` | 主聊天的目标分析、复核和跨聊天协作流程 |
| `ui/catalog.mjs` | 三档目录及问题模板 |
| `scripts/core.mjs` | 便签、约束锁、问题、冲突和导出规则 |
| `ui/server.mjs` / `ui/app.js` | 本机 API 与交互界面 |
| `native/` | 无边框 WebView2 宿主与第三方运行库 |
| `test/` | 规则和本机 API 测试 |

项目代码按 [MIT 许可](LICENSE) 发布。`native/` 中的 Microsoft WebView2 文件遵循其附带的 [许可](native/LICENSE.txt)与[通知](native/NOTICE.txt)。
