# 更新记录

## 1.4.5

- 只在歧义影响结论时重述目标。求证模式遇到合法反例即可结束相应命题的验证；权衡模式优先选择能区分原因的检查。
- 防循环比较实际错误和完整输出，同一调用的报错改变时重新计数。新增 A/B 交替失败检测，沿用 threshold 和 denyOn。
- 用户新一轮可重新尝试。提示按用户轮限额；停滞由工具步骤的重复观察触发。变更目标会清除旧方向和失败记录。
- 假设创建和修改共用证据校验。断点成功保存后向守卫同步目标及新增的运行、反例和排除记录，兼容 v1/v2 断点。

## 1.4.1

只修一致性校验与文档，运行时（`loop-guard.cjs` / `memory.cjs` / `state-bus.cjs` / `ledger.cjs`）未改。

- **parity 哈希改为行尾归一化**：`sync-runtime.cjs`、`parity.test.cjs` 与 `evaluate.cjs` 的对应断言先做 CRLF → LF、去 BOM 再算 SHA256，并重写 `runtime-parity.json`。修复 1.4.0 的清单在混合行尾的工作区上生成、换行不同就报「共享文件被单边修改」的问题——Windows 默认 `core.autocrlf=true` 的克隆与 Linux/macOS 的 LF 克隆此前都会在 `node --test` 里失败。
- 运行时、persona、断点格式、工具组合与 1.4.0 完全相同，升级无需迁移。

## 1.4.0

与 `@local/dsh-proof-preset` 同版本。运行时行为、断点格式、评测与文档同步升级。

- **成功调用不再被硬拦**：只有「同工具 + 同参数 + 同**失败**结果」连续 N 次才拒绝；成功调用最多得到软提示。修复 1.3.1 把正常重复读取判成空转的缺陷。
- **签名/输出哈希全量计算**（`sig/v2` / `out/v2`），删除 8 KB 前缀截断；非文本输出、BigInt、循环引用、抛错访问器都有确定性处理。
- **输出 streak 按工具隔离**；失败结果不再重复报「相同输出」。
- **停滞自检状态触发**：连续 N 轮无新证据才注入；`selfCheckEvery` 保留为兼容项，默认 0。
- **新增 `deliberate_hypotheses` 与 `deliberate_guard_stats`**（注册在 `loop-guard.cjs` 内，不新增插件行）；`deliberate_directions` 参数与文案保持兼容并镜像进账本。
- **断点 v2**：taskId / goalRef / 结构化 state（goal、excluded、decisions、runs、counterexamples）；v1 可读并迁移，`writeSchema: 1` 可回滚。
- **注入按事件触发**（resume / compaction / goal-change / milestone）；投影 fold 阶段脱敏。
- **宿主能力逐项降级**：`sessionProjections` / `zod` / `defineTool` / `createUserMessage` 缺失时只降级对应功能。
- **评测器**：环境元数据改为实采（DSH 版本、OS、Node、模型、权限、两仓 SHA），删除硬编码的「DSH 0.2.2-rc.5；Windows；deepseek-flash」；新增 `--no-unit`，默认先跑 `node --test` 并把单测结果单独写进报告；局部重跑的行会标注「沿用上次结果」。
- **测试可独立运行**：新增 `state-bus.cjs` / `ledger.cjs` / `runtime-parity.json` / `sync-runtime.cjs`；`parity.test.cjs` 改用哈希清单，不再依赖相邻仓库目录。
- **工具组合**：deliberate 原始 22 项保持不变，新增项仍是 `loop-guard` 与 `session-memory`。
- 未实施（不写成已完成）：独立反方子代理、三臂对照评测、proof 行为评测、消融实验——见 `MIGRATION.md` 的「未实施项」。

## 1.3.1

第四轮审查（F1–F3）：只修评测器与文档，运行时（`loop-guard.cjs` / `memory.cjs`）未改。

- **F1 工具组合基准拆开**：`evaluate.cjs` 不再用一份 23 项清单同时校验两个 preset。改成 `PROOF_BASELINE_ROWS`（proof 原始 23 项，含 `session-memory`）+ `DELIBERATE_BASELINE_ROWS`（deliberate 原始 22 项）+ 新增白名单（proof：`loop-guard`；deliberate：`loop-guard`、`session-memory`）。原始项必须完整且顺序不变，新增项单独报告、不算失败。旧写法会把「deliberate 新增 `session-memory`」当成「本来就有、必须匹配」，等于把新增当成基准。
- **F2 表述改准**：CHANGELOG/README 不再写笼统的「23 行工具组合不变」这类说法，改成 proof 原始 23 项 / deliberate 原始 22 项 + 新增项；新增静态断言 `工具组合表述按 preset 分开` 守着。
- **F3 proof 路径可配**：`evaluate.cjs` 不再硬编码 `../proof-preset`，改用 `--proof-dir <path>` 或 `DSH_PROOF_DIR`；读不到 `<proof-dir>/cordis.patch.yml` 时在静态断言开始前报明确错误并以退出码 `2` 结束，不再把空串喂给断言、产出一串模糊误失败。`read()` 的逻辑键从 `'../proof-preset/x'` 改成 `'proof:x'`，避免被误读成真实路径。
- 静态断言 47 → 50 项，负向自检 9 → 11 条（新增「原始组合少一行」「CHANGELOG 写回笼统说法」两条）。

## 1.3.0

第二轮 / 第三轮审查（R1–R12）的收尾版本。

- **R1 双 preset 防循环**：`loop-guard.cjs` 现在两个 preset 各带一份完全相同的实现（`proof-preset/loop-guard.cjs` 新增），两个 `cordis.patch.yml` 都注册了 `- id: loop-guard`，且排在 `session-memory` 之前。proof 的 `memory.cjs` 删除旧 `ctx.tools.guard` 与 `REPEATED_IDENTICAL_FAILURE` 计数，只留断点。
- **R2 拦截后注入换路指令**：拒绝理由改为「当前做法已连续 N 次相同，请换一个可检验的新策略，并先说明新假设与判定标准」，同一步再用 `createUserMessage` 注入一条 user 消息；不再只返回拒绝码。
- **R3 计数器分离**：B1（连续相同调用次数，`threshold`）与 C2（用户轮次，`selfCheckEvery`）用互不相干的状态字段，结构性检查确认两段代码不读对方的计数器。
- **R4 deliberate 的 `memory.cjs` 去留**：确认它不是僵尸文件——只保留 `deliberate_checkpoint` 的 save/read/clear 与落盘容错，不再有防循环逻辑；两份 `memory.cjs` 逐字节一致。
- **R5 用例判据自动化**：用例 6/9/11/13/17 从「待人工复测」改为确定性判据（含负向判据）；只剩用例 1、2 需要人工，理由写进 `EVALUATION.md` 与代码注释。
- **R6 hook 自身不崩**：所有监听器 `try/catch`，异常降级为「放行 + stderr 日志」；参数签名与输出 hash 只取前 8 KB（`MAX_HASH_CHARS`），超大输出不参与拼接。
- **R7 配置可校验 + 有文档**：`threshold` / `selfCheckEvery` 必须是正整数，`0` / 负数 / 非数字 / 小数回退默认 `3` 并在 stderr 告警；两个 README 增加配置表（名字、默认值、含义、怎么改）。
- **R8 方向留痕**：新增 `deliberate_directions`（会话内、不落盘、最多 3 条），卡住或换路时防循环提示会引用已记录方向，先回看再决定是否重想。
- **R9 断点落盘安全**：写入前过滤密钥/token/密码类字段；JSON 损坏或 schema 不符时隔离为 `.corrupt-<时间戳>.json` 并按空断点重建；README 补 `clear` 之外的手动清理方式。
- **R10 静态断言防脆弱**：`evaluate.cjs --self-test` 用 9 条故意改坏的副本验证断言会判失败；退出码约定 `0` 全过 / `1` 有失败 / `2` 无法运行。
- **R11 两个 preset 一致**：C1/C3/C4 与防循环段逐条对齐（proof 补「静态检查与运行验证分开写」「不编造」与 `loop-guard` 计数说明），并新增 `parity.test.cjs` 守着。
- **R12 版本与文档**：两个 `package.json` 升到 `1.3.0`；proof 新增 `CHANGELOG.md`；README 清掉「同错复现守卫」「纯配置」等过时表述。
- 新增单测：`loop-guard.test.cjs`（21 条）、`memory.test.cjs`（11 条）、`parity.test.cjs`（8 条），均不需要 DSH。

## 1.2.0-beta.2

- 防循环从纯提示词升级为运行时硬拦截：新增 `loop-guard.cjs`，承接 `memory.cjs` 原有的三次守卫（同工具 + 同参数 + 同错误，`REPEATED_IDENTICAL_FAILURE`），N 可配置（默认 3），并补充输出 hash 与每 N 个用户轮次的事前自检注入。`memory.cjs` 只保留断点，删除重复守卫，避免两份计数器。
- 新增 `evaluate.cjs`：先跑静态断言（两个 YAML/JSON 可解析、preset ID 未变、工具组合按 preset 分列校验、persona 关键词、hook/断点落盘），再批量跑 19 个行为用例；状态按「自动通过 / 自动失败 / 待人工复测」三态回填，明确「脚本判定≠真实通过」。
- 断点改为落盘：`<DSH_HOME>/checkpoints/<profile>/<hash>.json`，schema 固定；临时文件 + 原子 rename，一个会话单写者；多 profile 分目录；与 `sessionProjections` 并存（文件持久层 + 投影即时提示）。
- 代价估算加入三个量化维度：改动文件数、预计轮次、是否不可逆。
- 施工图每块必须写可检验的通过条件，并与 `EVALUATION.md` 判据对齐。
- 两个 preset 的 prefix 增加问题重述与「先列 2–3 个方向，其中至少一个反直觉/逆向/极端」；suffix 增加「不强制套固定结构」。
- 防循环段加入事前自检；deliberate 由 hook 每 N 个用户轮次真正计数并注入，proof 使用阶段/卡住等自然锚点。
- 保持预设 ID 不变；proof 原始 23 项工具组合不变，deliberate 由 22 项增至 23 项（新增 `session-memory` 承载 `deliberate_checkpoint`），另两个 preset 各新增 `loop-guard`。

## 1.1.0-beta.2

- 明确失败尝试的计数单位，并在提交超时时先核对是否生效。
- 对事实分歧先核对对象、版本和记录。用户接受方案代价后可继续推进已授权的执行任务。
- 明确评估请求的交付边界，补充四个回归用例。
- 在 Windows 的 Harness `0.2.2-rc.5` 独立 Web profile 中验证安装、注册与作用域加载。

## 1.1.0-beta.1 — 2026-11-23

- 将固定开场、两路线和按步数画表改为按任务复杂度选择流程。
- 区分关键歧义与可撤销细节；查证优先，保留必要澄清。
- 用有证据的反对与用户选择后的推进，替换“审议者而非执行者”的身份冲突。
- 保留三次失败换策略，补充实质进展定义、循环误判防护及跨策略止损。
- 合并重复阶段汇报；不机械拆块、不为结尾模板编造风险。
- 保持 proof 23 项、deliberate 22 项的工具组合与预设 ID 不变；新增待复测用例，原版测试结果不沿用为新版通过。

## 1.0.0 — 2026-11-23

- 首次公开发布“权衡”模式，预设 ID 为 `deliberate`。
- 配置九节工作规则：开场评估、反对与换路、显式假设、阶段闸门、防循环、收工验证、简单任务豁免、施工图和决策日志。
- 保留原始工具组合快照（proof 23 项、deliberate 22 项），未改动模式行为。
- 补齐中文安装、使用示例、卸载、兼容性和局限说明。

- 补充作者已通过空转、歧义和反驳三项行为测试的状态，区分作者验证与发布静态检查。
