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
| `plugin/manifest.json` | 生成清单，入口为 `runtime/main.js` |
| `plugin/dist/` | 安装包，保留历史版本 |
| `scripts/`、`test/` | 工具与测试源码；`.cjs` 为手写文件 |
| `build/` | Git 忽略的编译中间文件、CLI 和测试 JS |

`build.cjs` 只清理 `build/` 和 `plugin/runtime/`。不要在这两个目录放手写文件。构建拒绝符号链接输出根，但不防恶意并发修改；构建期间保持目录可信、独占。

## 修改入口

| 修改内容 | 源码 | 检查 |
| --- | --- | --- |
| 任务动作 | `plugin/tool.ts`、`plugin/core.ts` | `test/governance.test.ts` |
| 看板与架构 | `plugin/project.ts` | `test/project.test.ts` |
| Git 协作 | `plugin/git.ts` | `test/git.test.ts` |
| 界面与语言 | `plugin/renderer/`、`plugin/panel.ts` | `test/panel.test.ts`、`test/browser.cjs` |
| 构建路径 | `tsconfig.json`、`scripts/build.cjs` | `test/layout.test.cjs` |
| 发布载荷 | `scripts/plugin-center.cjs` | `test/release.test.cjs`、发布预览 |

## 交付

按 [交付流程](../scripts/RELEASING.md) 提交、同步 GitHub、集成 main 并清理已合并分支。插件内容变更使用 PI PluginCheck/PluginPack 打包，不用 shell 自制安装包。普通构建不会推送、发布或安装。
