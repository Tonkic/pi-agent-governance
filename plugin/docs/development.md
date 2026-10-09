<!-- Generated from docs/ by scripts/build-docs.cjs. Do not edit. -->
# 开发

修改 `.ts` 源码后运行构建和测试。不要手改生成的 JS 或 `manifest.json`。

## 构建与检查

需要 Node.js 20+。在仓库根目录运行：

```powershell
npm ci
npm run typecheck
npm run build
npm test
```

构建成功后，插件 JS 位于 `plugin/runtime/`，CLI 和测试 JS 位于 `build/`。读取当前目录的治理状态：

```powershell
'{"action":"status"}' | node build/scripts/governance.js
```

运行浏览器检查前，配置可解析的 Playwright 和指向 Chromium/Edge 的 `PI_BROWSER`：

```powershell
npm run test:browser
```

浏览器检查使用模拟宿主桥接，不替代实际安装验收。

## 目录

| 路径 | 内容 |
| --- | --- |
| `plugin/*.ts` | 主进程源码 |
| `plugin/renderer/` | 浏览器 TS、HTML 和 CSS |
| `plugin/runtime/` | 已提交的运行 JS，供宿主及发布载荷使用 |
| `plugin/manifest.json`、`plugin/main.js` | 生成清单和市场所需固定入口；main.js只转接runtime/main.js，不手改 |
| `plugin/README.md`、`plugin/docs/` | 从 `docs/` 生成并提交的安装包说明，不手改 |
| `plugin/dist/` | 安装包，保留历史版本 |
| `scripts/`、`test/` | 工具与测试源码；`.cjs` 为手写文件 |
| `build/` | Git 忽略的编译中间文件、CLI 和测试 JS |

`build.cjs` 清理 `build/`、`plugin/runtime/`；`build-docs.cjs` 和 `build-entry.cjs` 只替换带生成标记的说明/入口，拒绝链接或未知手写文件。不要在生成目录放手写内容。构建不防恶意并发修改，运行期间保持目录可信、独占。

## 修改入口

| 修改内容 | 源码 | 检查 |
| --- | --- | --- |
| 任务动作 | `plugin/tool.ts`、`plugin/core.ts` | `test/governance.test.ts` |
| 看板与架构 | `plugin/project.ts` | `test/project.test.ts` |
| Git 协作 | `plugin/git.ts` | `test/git.test.ts` |
| 界面与语言 | `plugin/renderer/`、`plugin/panel.ts` | `test/panel.test.ts`、`test/browser.cjs` |
| Agent 任务与模型 | `plugin/operations.ts` | `test/operations.test.ts` |
| 说明与生成规则 | `docs/`、`scripts/build-docs.cjs` | `test/layout.test.cjs` |
| 构建路径 | `tsconfig.json`、`scripts/build.cjs` | `test/layout.test.cjs` |
| 发布载荷 | `scripts/plugin-center.cjs` | `test/release.test.cjs`、发布预览 |

## 交付

按 [交付流程](releasing.md) 提交、同步 GitHub、集成 main 并清理已合并分支。插件内容变更使用 PI PluginCheck/PluginPack 打包，不用 shell 自制安装包。普通构建不会推送、发布或安装。

## 一次启动接续待办

在 PI-Desktop「自动化」中运行本项目的手动任务「接续项目：已批准待办」。它在独立 Agent 会话中读取 AGENTS、STATE 和看板，连续处理已批准范围内的可执行项；完成、真实阻塞或需要新授权时停止。不是定时任务，不会后台自行唤醒，也不会自动安装或改权限模式。

任务配置属于本机宿主，不随 Git clone 迁移。换机器时按相同规则创建手动任务，并绑定正确工作区。运行前结束同项目其他写入任务，不能让两个对话并发改共享目录。不要在已有回合还在开发时重复点击运行。
