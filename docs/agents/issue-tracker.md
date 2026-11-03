# Issue tracker

GitHub Issues：[mikyan/durableagent](https://github.com/mikyan/durableagent/issues)。用户于 2026-11-03 授权新建公开仓库，代码与工单使用同一仓库。

总 spec 发布为父 issue；每个纵向切片各自发布为子 issue，并设置 GitHub 原生 blocked-by 关系。工作前读取当前票、父 spec、阻塞票及相关评论；只处理阻塞已解除且获得执行授权的前沿。

连接器能完成的操作优先使用连接器；建仓库、标签及原生依赖关系可用 `gh`。多行正文从文件读取，避免 shell 内插。

本地 spec / tickets 保存设计正文，GitHub issue 保存执行状态、讨论与阻塞关系。修改契约时同步两处；不要根据本地未勾选清单覆盖远端验收结果。

PRs as a request surface: off。外部 PR 不自动进入需求队列。
