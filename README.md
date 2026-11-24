# 权衡 · DSH 本地版

版本 1.3.0。适用于方案选择、实施与排障。

## 防循环（运行时硬拦截）

`loop-guard.cjs` 是运行时 hook，规则用可计算度量（SHA256），不做语义相似：

1. **连续相同调用**：同一工具 + 同一参数签名（`signature()`）+ 同一输出 hash 连续 N 次（默认 3）后，第 N+1 次在 `tools/pre-execute` 被拒绝，错误码沿用 `REPEATED_IDENTICAL_FAILURE`。拒绝理由本身带换路指令，同一步还会用 `createUserMessage` 注入一条「当前做法已连续 N 次相同，请换一个可检验的新策略，并先说明新假设与判定标准」——不是只回一个拒绝码。
2. **连续相同输出**：参数不同但连续 N 次输出 hash 相同，只注入提示，不硬拒绝（合法的重复检查不该被拦）。
3. **轮次自检**：每 `selfCheckEvery` 个用户轮次注入一次「当前做法是否在重复之前失败过的路径」。

连续两次撞上同一拦截会结束本轮；同一轮只拒绝一次，不会无限拒绝。`*_checkpoint`、`*_directions`、`todo_write` 等记账工具不参与计数。

hook 自身不会把会话搞崩：所有监听器内部 `try/catch`，任何异常都降级为「放行 + 往 stderr 记一条日志」；参数签名与输出 hash 只取前 8 KB，超大输出不会拖死会话。

## 配置

两个计数器**完全独立**，各有各的配置项，改一个不影响另一个：

| 配置项 | 默认 | 含义 | 怎么改 |
|---|---|---|---|
| `loop-guard.config.threshold` | `3` | B1：同一工具 + 同一参数 + 同一输出连续 N 次后拦截第 N+1 次 | 改 `cordis.patch.yml` 里 `loop-guard` 行的 `threshold`。必须正整数；`0`、负数、非数字、小数都会回退默认 `3`，并在 stderr 打一条 `[loop-guard] 配置 ... 不是正整数` 告警 |
| `loop-guard.config.selfCheckEvery` | `3` | C2：每 N 个用户轮次注入一次事前自检 | 同上，改 `selfCheckEvery`。同样必须正整数，非法值回退 `3` |

`threshold` 数的是「连续相同调用次数」，`selfCheckEvery` 数的是「用户轮次」，两者不共用计数器：把 `threshold` 调到 10 不会让自检失效，把 `selfCheckEvery` 调到 99 也不会让拦截失效。想看实际生效值，跑 `dsh --profile headless --patch ./cordis.patch.yml --dump-config`。

## 方向记录

`deliberate_directions` 在会话内保存本轮列出的 2–3 个方向（各一句 + 一句利弊），最多 3 条、每条 200 字符，**不落盘**。卡住或准备换路时，防循环提示会把这份记录带出来，先看有没有漏掉但能用的方向，再决定是否重想。简单问答可以不用。

```
deliberate_directions { action: "set", items: ["方向 A（利/弊）", "方向 B（利/弊）"] }
deliberate_directions { action: "read" }
deliberate_directions { action: "clear" }
```

## 断点生命周期

一句话：**断点存在 `<DSH_HOME>/checkpoints/<profile>/` 下的会话级 JSON 文件；同一会话重启后仍能读回，新建会话或 `clear` 后失效。**

`deliberate_checkpoint` 支持 save、read、clear，最多 800 字符。save 写文件；read 文件优先，`ctx.sessionProjections` 的内存投影兜底。schema 固定为：

```json
{"schemaVersion":1,"sessionId":"session-…","profile":"desktop","note":"断点正文（≤800 字符）","updatedAt":"2026-11-24T03:00:00.000Z"}
```

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

1. **静态断言**（可自动判定）：两个 `cordis.patch.yml` 可解析、两个 `package.json` 合法、preset ID 仍为 `proof`/`deliberate`、工具组合行未变、两个 preset 都注册了 `loop-guard`、proof 的 `memory.cjs` 无旧守卫、B1/C2 计数器独立、hook 异常降级、配置校验、断点过滤与容错、C1/C3/C4 语义一致、README 无过时表述、版本号与 CHANGELOG 对应。
2. **模型行为采集**（脚本喂 DSH、收输出）：只做能确定性核验的判定（文件是否改对、命令是否通过、是否出现 `REPEATED_IDENTICAL_FAILURE`、是否出现与要求相悖的措辞等），其余才写「待人工复测」。状态列是三态：**自动通过 / 自动失败 / 待人工复测**；脚本判定不等于真实通过。

静态断言本身是关键词匹配，措辞一改就可能误判，所以 `--self-test` 会拿一组**故意改坏的副本**跑同一套断言，确认它们真的会判失败——断言不会“怎么改都通过”。

```powershell
node evaluate.cjs --static          # 只跑静态断言
node evaluate.cjs --self-test       # 静态断言的负向自检（不需要 dsh）
node evaluate.cjs                   # 静态断言 + 19 个行为用例
node evaluate.cjs --only 1,8,15     # 只跑指定行为用例
node evaluate.cjs --dry-run         # 只打印覆盖层和用例清单
```

退出码：`0` = 全部通过；`1` = 有断言/用例失败，或负向用例没被识别；`2` = 无法运行（参数错误、找不到 dsh）。

评测会真实消耗模型额度；原始会话记录保存在 `.eval/`（已 gitignore）。

单元测试不需要 dsh：

```powershell
node --test loop-guard.test.cjs memory.test.cjs parity.test.cjs
```

## 使用

在模式选择器中选 权衡，新建会话即可使用。已打开的旧会话可能仍绑定旧版。
