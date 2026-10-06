# Microsoft 文档写作

用户选择 Microsoft Writing Style Guide，要求简洁说明用途与用法，不采用 Diátaxis 分类，不添加教程。官方来源链接保存在 docs/README.md，不另建自定义规范。

本次重写 docs/README.md、architecture.md、development.md：使用导航表、职责/数据表及直接命令，保留必要边界，删除长篇教学与重复解释。AGENTS 同步写作依据。没有修改插件代码、版本、权限或包；既有 API 文档和历史证据保留。

实际检查：npm test 完成构建并通过64/64（含文档链接）；git diff --check通过。日志在session scratch/microsoft-docs-tests.log。GitHub只读ls-remote HTTPS443超时，未完成远端同步或main集成，功能分支保留。宿主治理工具指向C:\导致失败，进度通过D:\pi-agent-governance内同一治理内核保存。整体宿主与目视验收仍未通过，不close。
