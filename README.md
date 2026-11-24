# 权衡 · DSH 本地版

版本 1.4.5。适用于方案选择、实施与排障。

工具组合：原始 22 项（不含 `session-memory`）保持不变，另新增 `loop-guard` 与 `session-memory`（后者承载 `deliberate_checkpoint` 断点）；`deliberate_hypotheses` 与 `deliberate_guard_stats` 注册在 `loop-guard` 内，不新增插件行。

## 防循环（运行时硬拦截）

`loop-guard.cjs` 是运行时 hook，规则用可计算度量（SHA256），不做语义相似：

1. **连续相同失败**：同一工具 + 同一参数签名 + 同一**失败**结果连续 N 次（默认 3）后，第 N+1 次在 `tools/pre-execute` 被拒绝，错误码 `REPEATED_IDENTICAL_FAILURE`。拒绝理由本身带换路指令，同一步还会用 `createUserMessage` 注入一条「请换一个可检验的新策略，并先说明新假设与判定标准」。
2. **成功调用永不硬拦**：重复读取、重复查询最多得到一条软提示；1.3.1 把成功重复判成失败的问题已修复。
3. **连续相同输出**：**同一工具**输出连续 N 次相同，只注入提示，不硬拒绝；streak 按工具隔离，非文本输出也参与比较。
4. **停滞检查**：同一用户轮内，连续 N 个有工具结果的步骤只得到重复观察，才触发检查。记录新的有效证据或在断点增加运行结果、反例、已排除项，可解除停滞计数。
5. **交替失败**：A 和 B 是两个不同的工具调用或参数组合。两者按相同顺序各自复现相同失败 N 个周期（默认 3）后，再试预期的下一调用会收到 `REPEATED_FAILURE_CYCLE`。不同调用仍可执行。成功、切换目标或开始新的用户轮会打断旧失败链。

连续两次撞上同一拦截会结束本轮；同一轮只拒绝一次，不会无限拒绝。`*_checkpoint`、`*_directions`、`*_hypotheses`、`*_guard_stats`、`todo_write` 等记账工具不参与计数。

hook 自身不会把会话搞崩：所有监听器内部 `try/catch`，任何异常都降级为「放行 + 往 stderr 记一条日志」；签名与输出哈希是**全量**流式 canonical 编码，没有 8 KB 截断。

## 配置

三个计数器**完全独立**，各有各的配置项：

| 配置项 | 默认 | 含义 | 怎么改 |
|---|---|---|---|
| `loop-guard.config.enabled` | `true` | 总开关；`false` = 完全不干预 | 改 `cordis.patch.yml` 里 `loop-guard` 行的 `enabled` |
| `loop-guard.config.denyOn` | `failure` | 只有失败重复才硬拦；`never` = 只提示 | 同上 |
| `loop-guard.config.threshold` | `3` | 连续相同失败 N 次后拦第 N+1 次；2..10，超出夹取 | 同上 |
| `loop-guard.config.outputStreakThreshold` | `3` | 同工具连续相同输出 N 次 → 软提示；2..10 | 同上 |
| `loop-guard.config.stallRounds` | `3` | 连续 N 个工具步骤只得到重复观察 → 停滞检查；2..10 | 同上 |
| `loop-guard.config.selfCheckEvery` | `0` | 1.3.1 兼容项；`>0` 才按用户轮次自检 | 同上 |
| `loop-guard.config.maxNoticesPerTurn` | `2` | 每轮最多注入条数；1..3 | 同上 |
| `loop-guard.config.stats` | `memory` | `off` / `memory`（只在内存计数） | 同上 |
| `loop-guard.config.budget.*` | 20 / 240 / 5 / 8192 | 假设条数、命题长度、每条证据数、账本总字节 | 同上 |
| `session-memory.config.writeSchema` | `2` | 断点写 v2；`1` = 写回 v1（回滚用） | 改 `session-memory` 行 |
| `session-memory.config.injectOn` | 四项全开 | resume / compaction / goal-change / milestone | 同上 |
| `session-memory.config.maxInjectChars` | `800` | 单次注入上限；200..2000 | 同上 |

`threshold` 控制连续相同失败次数与 A/B 周期数，`stallRounds` 数「同一用户轮内连续重复观察的步骤数」，`outputStreakThreshold` 数「同工具相同输出次数」，三者不共用计数器。非法值不会静默生效：整数越界会夹取，类型/枚举不对会回退默认并告警。想看实际生效值，跑 `dsh --profile headless --patch ./cordis.patch.yml --dump-config`。

## 假设账本

`deliberate_hypotheses` 记录结构化假设：`set` / `update` / `read` / `archive` / `reopen`。状态只有 `untested / testing / supported / falsified / blocked`；`falsified` 是终态，不能改名重开，只能新建并标 `supersedes`；`supported` 需要有效且非自证的证据；高风险假设进入 `testing` 前必须写 `nextCheck`。上限：20 条未归档、命题 ≤240 字符、每条 ≤5 条证据、账本 ≤8 KB。

`deliberate_directions` 保持 1.3.1 的参数与文案，并镜像成 `axis: "direction"` 的假设。

## 方向记录

`deliberate_directions` 在会话内保存本轮列出的 1–3 个方向（各一句 + 一句利弊），最多 3 条、每条 200 字符，**不落盘**。卡住或准备换路时，防循环提示会把这份记录带出来。

```
deliberate_directions { action: "set", items: ["方向 A（利/弊）", "方向 B（利/弊）"] }
deliberate_directions { action: "read" }
deliberate_directions { action: "clear" }
```

## 断点生命周期

一句话：**断点存在 `<DSH_HOME>/checkpoints/<profile>/` 下的会话级 JSON 文件；同一会话重启后仍能读回，新建会话或 `clear` 后失效。**

`deliberate_checkpoint` 支持 save、read、clear，note 最多 800 字符，可附带结构化字段（goal / excluded / decisions / runs / counterexamples / nextAction / goalRef）。save 写文件；read 文件优先，`ctx.sessionProjections` 的内存投影兜底（投影缺失时只用文件）。schema 为 v2：

```json
{"schemaVersion":2,"sessionId":"session-…","profile":"desktop","taskId":"","goalRef":null,"note":"断点正文（≤800 字符）","state":{"nextAction":"跑 test3","excluded":["编码问题"]},"updatedAt":"2026-11-24T03:00:00.000Z"}
```

`schemaVersion: 1` 的旧文件仍可读，下一次 save 自动升级为 v2；`writeSchema: 1` 可写回旧格式用于回滚（见 `MIGRATION.md`）。

| 问题 | 结论 |
|---|---|
| 存在哪 | `<DSH_HOME>/checkpoints/<profile>/<sha256(sessionId) 前 32 位>.json`；哈希文件名避免特殊字符造成路径问题 |
| 什么时候失效 | 新建会话（新 session id）读不到；切换 preset 同理；`clear` 删除文件；删除会话后文件成为孤儿，不再被任何会话引用，可手动清理 |
| 切换模型 | 不失效：文件与模型选择无关 |
| 上下文压缩 | 不失效：文件在，投影仍能从会话事件重建 |
| 是否按项目目录共享 | 不共享：按会话隔离 |
| 并发写 | 一个会话只有一个写者；临时文件 + 原子 rename，最后写入者生效 |
| 多 profile | 路径含 profile 名，互不覆盖 |
| 和 sessionProjections 的关系 | 并存，不是替换：文件是持久层，投影负责本会话内的即时提示与兜底 |

### 敏感字段与损坏文件

- **落盘前过滤**：`api_key` / `token` / `password` / `Authorization` / `sk-…` / `ghp_…` / `AKIA…` / JWT / 私钥块等形态的字段会被替换成 `[已过滤]`，工具会告诉你「疑似密钥字段已过滤」。宁可多过滤，也不要把凭据留在明文 JSON 里。
- **文件损坏**：JSON 解析失败或 `schemaVersion` 不符时，文件被重命名为 `<hash>.json.corrupt-<时间戳>.json`，按空断点重建，不会让会话崩掉；stderr 会有 `[checkpoint] 断点文件损坏` 告警。

### 手动清理（`clear` 之外）

```powershell
# 删掉某个 profile 的全部断点
Remove-Item "$env:DSH_HOME\checkpoints\<profile>" -Recurse -Force
# 只删某个会话的断点（文件名是 sessionId 的 sha256 前 32 位）
Remove-Item "$env:DSH_HOME\checkpoints\<profile>\<hash>.json"
# 隔离出来的损坏文件可以随时删
Remove-Item "$env:DSH_HOME\checkpoints\<profile>\*.corrupt-*.json"
```

`$env:DSH_HOME` 未设置时默认是 `~/.dsh`。

## 自动化评测

`EVALUATION.md` 的 19 个用例由 `evaluate.cjs` 跑两层：

1. **静态断言**（可自动判定，59 条）：两个 `cordis.patch.yml` 可解析、两个 `package.json` 合法、preset ID 仍为 `proof`/`deliberate`、**工具组合按 preset 分列**（proof 原始 23 项 / deliberate 原始 22 项必须完整且顺序不变，新增项单列报告、不算失败）、两个 preset 都注册了 `loop-guard`、签名无 8 KB 截断、只拦失败重复、streak 按工具、假设账本与统计工具已注册、断点 v2 + v1 迁移 + fold 脱敏、注入策略、`runtime-parity.json` 哈希一致、README 无过时表述、版本号与 CHANGELOG 对应。
2. **模型行为采集**（脚本喂 DSH、收输出）：只做能确定性核验的判定（文件是否改对、命令是否通过、是否出现 `REPEATED_IDENTICAL_FAILURE`、是否出现与要求相悖的措辞等），其余才写「待人工复测」。状态列是三态：**自动通过 / 自动失败 / 待人工复测**；脚本判定不等于真实通过。

单元测试不需要 dsh，也不需要额度，默认在静态断言之后、行为用例之前跑；失败会直接阻塞（`--no-unit` 可跳过）。静态断言与单测、行为评测**分开报告**，任何一类都不冒充另一类。

静态断言本身是关键词匹配，措辞一改就可能误判，所以 `--self-test` 会拿一组**故意改坏的副本**跑同一套断言（当前 15 条），确认它们真的会判失败——包括「把 8 KB 截断塞回签名」「去掉失败门控」「断点退回只认 v1」「把假设账本挪出 loop-guard」。

```powershell
node --test                          # 单元测试：守卫、断点与共享文件一致性
node sync-runtime.cjs --check        # 共享文件哈希一致性
node evaluate.cjs --static           # 只跑静态断言 + 单测，不调用模型
node evaluate.cjs --self-test        # 静态断言的负向自检（不需要 dsh）
node evaluate.cjs                    # 静态断言 + 单测 + 19 个行为用例
node evaluate.cjs --only 1,8,15      # 只跑指定行为用例（其余行标注“沿用上次结果”）
node evaluate.cjs --dry-run          # 只打印覆盖层和用例清单
node evaluate.cjs --no-unit          # 跳过单元测试
node evaluate.cjs --proof-dir ../dsh-proof-preset   # proof 目录不并排时指定
```

proof 目录默认是并排的 `../dsh-proof-preset`，也可以用环境变量 `DSH_PROOF_DIR` 指定。读不到 `<proof-dir>/cordis.patch.yml` 时，脚本在静态断言开始前直接报错退出。

评测记录里的环境信息是**实采**的：DSH 版本（`dsh --version`）、OS/架构、Node 版本、模型（从事件流读取，读不到写「未采集」）、权限模式、两个仓库的 commit SHA。不再写死版本号或模型名。

退出码：`0` = 全部通过；`1` = 有断言/单测/用例失败，或负向用例没被识别；`2` = 无法运行（参数错误、找不到 dsh、找不到 proof 目录）。

评测会真实消耗模型额度；原始会话记录保存在 `.eval/`（已 gitignore）。

**未实施**：standard / 1.3.1 / 候选三臂对照、每用例 ≥3 次重复、消融实验、proof 独立行为评测——这些在 `MIGRATION.md` 的「未实施项」里列明，不写成已完成。

## 离线安装

```powershell
dsh plugin --profile desktop add file:C:/path/to/local-dsh-deliberate-preset-1.4.5.tgz
```

把路径换成实际文件位置。在对应 profile 的插件管理器启用 `@local/dsh-deliberate-preset`。

## 使用

在模式选择器中选 权衡，新建会话即可使用。已打开的旧会话可能仍绑定旧版。
