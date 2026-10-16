# 开发

修改 `.ts` 源码后运行构建和测试。不要手改生成的 JS 或 `manifest.json`。

## 构建与检查

需要 Node.js 22+。在仓库根目录运行：

```powershell
npm ci
npm run typecheck
npm run build
npm test
```

构建后插件JS在`plugin/runtime/`，MCP入口在`build/mcp/server.js`，只读宿主Hook在`build/mcp/context-hook.js`，CLI/测试在`build/`。宿主绑定和配置见 [MCP与Skill](mcp.md)。读取当前目录的治理状态：

```powershell
'{"action":"status"}' | node build/scripts/governance.js
```

浏览器检查使用锁定的Playwright。首次运行可执行 `npx playwright install chromium`；本机也可用 `PI_BROWSER` 指向已有Chromium/Edge，CI安装bundled Chromium：

```powershell
npm run test:browser
```

浏览器检查使用模拟宿主桥接；尚未执行的真实安装和宿主交互检查保持未验证，不增加测试后的重复人工验收。

## 目录

| 路径 | 内容 |
| --- | --- |
| `plugin/*.ts` | 主进程源码 |
| `mcp/` | stdio协议适配和客户端示例；复用同一核心，不含宿主模型/会话接口 |
| `web/` | 本地HTTP白名单服务及网页桥接/CSS；复用工作台，不含外部Agent启动 |
| `plugin/renderer/` | 浏览器 TS、HTML 和 CSS |
| `plugin/runtime/` | 已提交的运行 JS，供宿主及发布载荷使用 |
| `plugin/manifest.json`、`plugin/main.js` | 生成清单和市场所需固定入口；main.js只转接runtime/main.js，不手改 |
| `plugin/README.md`、`plugin/docs/` | 从 `docs/` 生成并提交的安装包说明，不手改 |
| `plugin/dist/` | 只保留当前可用安装包；旧版本按需从对应Git提交取回 |
| `scripts/`、`test/` | 工具与测试源码；`.cjs` 为手写文件 |
| `build/` | Git 忽略的编译中间文件、CLI 和测试 JS |

本机宿主目标 `/.pi/` 与既有 `/changes/archive/redesign-governance-panel/` 经用户批准由Git忽略，文件不纳入源码提交。历史证据与有效项目数据保留；经明确批准可清理旧包、旧操作记录和确认无引用的废弃内容，不以忽略规则代替清理或放宽dirty门禁。

`build.cjs` 清理 `build/`、`plugin/runtime/`；`build-docs.cjs` 和 `build-entry.cjs` 只替换带生成标记的说明/入口，拒绝链接或未知手写文件。不要在生成目录放手写内容。构建不防恶意并发修改，运行期间保持目录可信、独占。

## 修改入口

| 修改内容 | 源码 | 检查 |
| --- | --- | --- |
| 任务动作 | `plugin/tool.ts`、`plugin/core.ts` | `test/governance.test.ts` |
| 看板与架构 | `plugin/project.ts` | `test/project.test.ts` |
| Git 协作 | `plugin/git.ts` | `test/git.test.ts` |
| 界面与语言 | `plugin/renderer/`、`plugin/panel.ts` | `test/panel.test.ts`、`test/browser.cjs` |
| Agent任务、已有会话复用/工具项目绑定 | `plugin/operations.ts`、`plugin/main.ts` | `test/operations.test.ts`、`test/host-context.test.cjs` |
| 说明与生成规则 | `docs/`、`scripts/build-docs.cjs` | `test/layout.test.cjs` |
| 行为文档与场景证据 | `plugin/behaviors.ts`、`scripts/check-behaviors.cjs` | `test/behaviors.test.cjs`、`npm run check:behaviors` |
| 构建路径 | `tsconfig.json`、`scripts/build.cjs` | `test/layout.test.cjs` |
| MCP/只读宿主Hook/Skill资源 | `mcp/server.ts`、`mcp/context-hook.ts`、`plugin/skills/architecture-copilot/` | `test/mcp.test.cjs`，真实SDK与stdin fixtures，非安装客户端E2E |
| 本地浏览器控制台 | `web/server.ts`、`web/bridge.js` | `test/web.test.cjs`、`test/web-browser.cjs`，由test:browser串行执行 |
| 多目标分发与GitHub发布 | `scripts/build-distributions.cjs`、`scripts/github-release.cjs`、`.github/workflows/` | `test/distributions.test.cjs`、`test/release.test.cjs` |

## 交付

按 [交付流程](releasing.md) 提交、同步 GitHub、集成 main 并清理已合并分支。插件内容变更使用 PI PluginCheck/PluginPack 打包，不用 shell 自制安装包。普通构建不会推送、发布或安装。

## 一次启动接续待办

在 PI-Desktop「自动化」中运行本项目的手动任务「接续项目：已批准待办」。它在独立 Agent 会话中读取 AGENTS、STATE 和看板，连续处理已批准范围内的可执行项；完成、真实阻塞或需要新授权时停止。不是定时任务，不会后台自行唤醒，也不会自动安装或改权限模式。

任务配置属于本机宿主，不随 Git clone 迁移。换机器时按相同规则创建手动任务，并绑定正确工作区。运行前结束同项目其他写入任务，不能让两个对话并发改共享目录。不要在已有回合还在开发时重复点击运行。
