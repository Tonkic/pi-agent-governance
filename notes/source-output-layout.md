# 源码/产物分离决策与验证

## 为什么改

用户要求更容易读懂代码，并将 TS 与编译 JS 分开。旧布局由无 outDir 的 tsc 在 TS 旁生成 JS，宿主直接加载 main.js；可打包但目录噪声大。此记录保存迁移依据，不作为当前任务来源。

## 决策

- TS 路径保留，避免无意义重命名核心模块和架构引用。plugin/runtime 集中放10个安装 JS，build 放可丢弃的中间产物、测试和CLI。
- runtime 与 manifest 仍提交，支持宿主直接加载和发布者从审核 SHA 构造白名单载荷。并非要求所有产物都从 Git 忽略；CI 重建检查保证源码一致。
- manifest.main 改为 runtime/main.js，HTML四个脚本改为 ../runtime/renderer/，发布白名单与浏览器桥接跟随迁移。
- Docs 保存稳定架构和开发用法，Notes 按需要记录实际决策/验证；插件不强制空目录。原有工具文档/changes 证据保留，通过入口链接。没有修改业务规则、权限或用户项目数据。
- 0.6.2 是本地补丁，按已授权流程同步GitHub并集成main，不发布市场、不自动安装。旧安装包保留。

## 实际验证

- typecheck/build、63/63测试通过，包括新布局、CLI、入口/HTML引用与生成文件一致性测试。
- npm run test:browser 连接真实内核、模拟宿主桥接通过，中英文刷新/看板/架构/版本守卫保留；不是实际宿主或人工目视验收。
- scratch干净副本没有runtime/旧邻接JS，npm ci后typecheck/build/test重新生成成功，63/63通过。日志：session scratch layout-clean.log、layout-tests.log。
- PluginPack含校验：28文件，277359字节，SHA256 ade28c7fb06fc033d140cedf0894fa9277ae78c58ef35c66cea48c956f20c930；仅原有agent.tool.register授权提示。
- TS7不导出bin/tsc子路径，构建从package.json声明的bin.tsc解析CLI。旧HTML路径断言已更新，新布局测试验证真实引用，不保留虚假旧入口。

## 边界

build/runtime为编译器拥有目录，仅允许生成文件；构建拒绝符号链接输出根，不防恶意并发。历史包和STATE/.governance不清理。受管git_create此前因无关未跟踪目录拒绝，使用串行独立功能分支与原生Git，不伪造受管git_verify。总体验收仍待宿主窗口拖动与人工目视检查，整体STATE不close。提交后及main集成后仍需实测与远端核对，不能用上述提交前结果代替。

追加检查：3项布局/CLI/文档链接测试独立通过；全部10个运行JS与迁移前逐字节一致。官方i18n门禁0 FAIL、2 REVIEW：安装器要求的双语字符串命令标题与固定标识STATE，保持已验证兼容方案。diff审查覆盖输出/入口/脚本白名单与测试路径，无权限扩大。
