# 权衡 · Deliberate

**先判断值不值得做，再把对的事情做完。**

DeepSeek Harness（DSH）的社区模式插件，与标准、创造等模式一样，通过 Agent preset 选择使用。它让复杂任务先比较路径、估算代价，再分块执行、检查进展，并在反复失败时换路或止损。

纯配置 bundle：不新增 JavaScript 实现，不需要构建，不增加模型服务或第三方 API。它改变的是工作方式，实际工具和执行能力仍由 Harness 提供。非 DeepSeek 官方插件。

## 为什么用权衡

| 机制 | 希望改善的问题 | 使用收益 |
| --- | --- | --- |
| 开场三笔账：复述、代价、路径 | 目标没弄清就开工 | 在投入前看清范围、成本和替代方案 |
| 显式标记假设 | 把猜测当成事实 | 更容易发现和纠正错误前提 |
| 施工图：依赖、产出、验收、状态 | 长任务做到哪算哪 | 每一块都有可以检查的完成标准 |
| 阶段闸门 | 成本持续增加却继续硬推 | 在阶段之间重新评估收益和成本 |
| 三次法则、原点检测、收敛判断 | 同一种失败反复重试，错误从 A 移到 B | 促使模型换策略、拆小问题或重新定义目标 |
| 收工自证 | 只说“完成了” | 分清验证过、未验证，以及具体失效场景 |
| 简短决策日志 | 看不出为什么选这条路 | 保留选择与取舍的可检查摘要 |
| 简单任务豁免 | 为小事套大流程 | 知识问答、错别字、格式和单步任务直接处理 |

这些是提示词设计目标，尚无对照实验或量化性能数据。它可能降低无效重试，也可能因为规划与检查增加耗时和 token；不承诺更快、更便宜或必然正确。

## 适合什么任务

- 多文件改动、重构、迁移，以及有多种方案的实现任务。
- 难复现的故障排查，尤其是已经反复修复但没有收敛的问题。
- 需要先核算成本、风险、边界条件的技术方案。

简单问答和小改动也能使用，提示词已设定直接处理的豁免。需要快速大量发散想法时，可根据任务选择其他模式；权衡的侧重点是取舍与收敛。

## 安装

### 1. 下载到固定目录

已安装 Git 时：

```sh
git clone https://github.com/Dexter-cpp/dsh-deliberate-preset.git
```

也可以使用 GitHub 的 **Code → Download ZIP**，解压到长期保留的位置。安装目标是包含 `package.json` 和 `cordis.patch.yml` 的文件夹，不是 ZIP 文件。

### 2. 在 Harness 中安装 bundle

在能够使用插件管理工具的 Harness 会话中发送，例如：

```text
请用 plugin_manager 安装本地模式插件，action 为 install_bundle，
target 为 C:/DSH-plugins/dsh-deliberate-preset。
安装后检查该 bundle 已启用。
```

将示例路径替换成自己的**绝对路径**。对应的工具参数如下；这是 Harness 工具调用参数，不是终端命令：

```json
{
  "action": "install_bundle",
  "target": "C:/DSH-plugins/dsh-deliberate-preset"
}
```

安装只作用于当前 profile。本地目录安装可能通过链接引用原目录，安装后请保留目录，避免移动或删除。原始说明提示安装可能影响其他 bundle 的启用状态，安装后应检查插件页；这不是本插件单独修改其他插件的逻辑。

### 3. 选择“权衡”

在模式选择器中选择 **权衡**，建议新建会话验证。预设 ID 是 `deliberate`，排序值为 `5`；最终显示顺序取决于已安装的其他模式。若尚未出现，检查插件是否启用、当前 profile 是否正确，并在需要时重启 Harness。

无需单独运行 `npm install` 或构建命令。`private: true` 防止误发 npm，不影响作为本地 bundle 使用；本仓库发布不代表已进入 npm 或官方插件市场。

## 怎么用

安装并选择模式后，正常描述任务即可，无需每次复制整份提示词。

**重构前比较方案：**

```text
这个模块需要支持两种数据源。先评估最小改动与抽象接口两种路线的成本，
推荐一种；需要改多个文件时列出依赖、产出和验收，再实施。
```

**让排障收敛：**

```text
这个测试偶发失败，前两次修改都没有解决。
请先收集证据，明确假设；若同一种方法连续失败三次，换策略，
最后说明实际验证了什么、还有什么没验证。
```

**评估是否值得做：**

```text
我想为了一个每周运行一次的小脚本引入消息队列。
请先评估收益、维护成本和更简单的替代方案，再给建议。
```

以上是使用示例，未作为真实模型输出或效果测试记录。复杂任务预期出现：开场评估 → 施工图 → 分块执行与阶段检查 → 简短决策摘要 → 收工验证。具体输出由模型、任务和当前环境决定。

## 禁用与卸载

临时不用时，切换其他模式；要停用整个 bundle，在插件页禁用。

卸载前先将使用该预设的会话切换到其他模式，再请 Harness 调用：

```json
{
  "action": "remove_bundle",
  "target": "@local/dsh-deliberate-preset"
}
```

按工具返回提示完成必要的重启。确认卸载后再删除本地目录。

## 实现与兼容性

| 项目 | 值 |
| --- | --- |
| 包名 | `@local/dsh-deliberate-preset` |
| 版本 | `1.0.0` |
| 预设声明行 ID | `preset-deliberate` |
| 预设 ID / 显示名 | `deliberate` / 权衡 |
| 顶层子插件项 | 23（含插件组，不等于 23 个叶子工具） |
| 定义文件 | [`cordis.patch.yml`](cordis.patch.yml) |

`package.json` 通过 `dsh.bundle.patch` 声明补丁；补丁插入一个 `@deepseek-ai/dsh-agent-preset`。`persona.prefix` 定义态度，`persona.suffix` 定义九节工作规则，未设置 `complete`。它没有显式覆盖沙箱或审批策略；实际权限仍取决于宿主配置。

工具组合来自 Standard 的静态快照，包含平台 shell、文件、搜索、规划、压缩、委派、网页与办公等插件声明，部分插件按平台或环境禁用。**它不动态继承 Standard，也不会自动同步上游新增工具。** 2026-11-23 对照上游提交 `4b399c39a6d1479cd84ca591b4d7c88e24d38a96`：除 persona 外，当前上游还多一个 `tool-cordis`，其余子插件声明一致。

需要宿主提供所声明的 DSH 插件及 Agent preset 服务，主要面向提供模式选择器的桌面/Web 环境。不保证任意旧版、精简 profile 或未来版本可直接加载。目前完成了静态配置检查，尚未完成 Harness 内实际安装和模型行为测试，也未确定最低兼容版本。

## 局限与排障

- **不是硬性执行器：** 三次止损、阶段闸门与验收均依赖模型遵守；没有运行时计数器或强制拦截。
- **不能替代权限控制：** 提示词中的“有权说不”与“用户坚持”不构成系统权限，不能绕过审批、沙箱或安全约束。
- **流程可能偏重：** 九节提示词会占用上下文，复杂任务可能输出较多；简单任务豁免也依赖模型判断。
- **新模式未出现：** 检查安装路径、bundle 启用状态、profile、预设 ID 冲突，并新建会话或重启。
- **报缺少插件：** 检查 Harness 版本与所需插件是否齐全。不要用添加构建脚本解决纯配置 bundle 的宿主兼容问题。
- **更新后行为未变：** 本地链接与 Git/归档安装的更新方式不同；按安装来源更新，并新建 Agent/会话验证。
- **插件详情无独立图标或本地化名称：** 本版本未提供额外图标、locale 资源，界面可能回退到包名和 README。

提交问题时请提供 Harness 版本、操作系统、安装方式和脱敏后的完整错误信息。

## 上游与许可证

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [Agent preset 定义](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/preset/agent-preset/README.md)
- [插件管理说明](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/boot/plugin-manager/README.md)
- [Standard 配置来源](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/bundle/web-app/presets/standard.patch.yml)

采用 [MIT License](LICENSE)。Standard 派生配置的上游版权声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
