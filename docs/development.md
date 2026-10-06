# 开发与构建

## 目录约定

```text
plugin/*.ts              主进程源码：main/core/project/git/panel/tool
plugin/renderer/*.ts     浏览器源码：panel/graph/graph-model/i18n
plugin/renderer/*.html、*.css  手写静态资源
plugin/runtime/          生成的安装运行 JS，提交以支持源码SHA绑定发布
plugin/manifest.json     生成的宿主清单，入口 runtime/main.js
plugin/dist/             历史与当前安装包，不由build清理
test/*.ts、*.cjs         测试源码；cjs是手写而非重复产物
scripts/*.ts、*.cjs      构建/CLI/交付源码
build/                   被Git忽略的编译中间目录、CLI和测试JS
docs/                    稳定文档
notes/                   必要的决策/验证记录，不作为当前任务定义
```

不在 TS 旁边生成 JS。不手改 runtime 或 manifest；改源码后重新 build。保留 runtime 在版本控制中的原因是宿主直接加载 JS，插件中心发布载荷由审核提交的 git show 构造，不依赖工作区或线上临时编译。CI 重建后检查差异，确保产物匹配源码。这是输出分离，不是将所有生成文件都忽略。

## 命令

Node 20+：

```powershell
npm ci
npm run typecheck
npm run build
npm test
'{"action":"status"}' | node build/scripts/governance.js
# 已配置 Playwright 与 PI_BROWSER 时
npm run test:browser
```

scripts/build.cjs 清理固定 build/，编译主进程/CLI/测试为 CommonJS 和浏览器为无require的脚本，生成manifest，再把插件JS复制到 plugin/runtime/。测试使用 build/test/，浏览器测试加载真实 plugin/renderer/index.html 和 runtime 桥接内核。构建仅清理它拥有的 build/ 与 runtime/，不清理 dist、STATE 或 .governance；不要在输出目录放手写文件。

目录删除输出根为符号链接时拒绝构建。输出目录属于构建系统，必须可信且在构建时独占；这不是防恶意并发的安全边界。

## 修改时怎样定位

- 任务动作：tool.ts 参数 → core.ts run分派/动作 → governance.test.ts。
- 看板/架构：project.ts → project.test.ts → renderer/panel.ts/graph.ts → browser.cjs。
- Git：git.ts → git.test.ts。不要把main推送隐藏在受管工具中。
- 界面：HTML/CSS + renderer TS；英文/中文字符串在 i18n.ts。
- 构建：tsconfig → build.cjs → build-manifest.ts → layout.test.cjs。
- 发布：plugin-center.cjs 白名单必须匹配 runtime/main.js 与 HTML脚本路径，release-auto.cjs 控制交付。见 scripts/RELEASING.md。

实际检查 typecheck/build/tests/browser；插件变更用 PI PluginCheck/PluginPack 打包，不用shell自制包。旧包保留。普通构建不推送、不发布、不安装。

Docs 写当前稳定用途，Notes 写必要依据与实测证据，STATE 写当前目标与进度；不为满足形式创建空 notes。原有 plugin/*.md 和 changes/ 的有效说明保留，通过文档入口链接，而不是一次搬迁所有历史。
