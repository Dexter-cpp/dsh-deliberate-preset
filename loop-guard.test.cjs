'use strict';

/**
 * loop-guard 的单元测试：不需要 DSH 进程，直接驱动插件注册的 waterfall 监听器。
 * 运行：node --test loop-guard.test.cjs
 *
 * 覆盖：R2（拒绝 + 注入换路指令同时发生）、R3（B1 与 C2 计数独立）、
 * R6（hook 抛异常放行 / 大输出签名有上限）、R7（非法配置回退默认）、
 * R8（方向记录可被引用）。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const guard = require('./loop-guard.cjs');

const { MAX_HASH_CHARS, DENIAL_CODE } = guard._internals;

/**
 * 假宿主：createRequire(hostManifest) 之后能解析 @deepseek-ai/dsh-llm 与 dsh-tools。
 * 这样 createUserMessage / defineTool 走真实代码路径，而不是被 mock 掉。
 */
function makeHostManifest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-guard-host-'));
  const write = (name, source) => {
    const target = path.join(root, 'node_modules', '@deepseek-ai', name);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'package.json'),
      JSON.stringify({ name: '@deepseek-ai/' + name, version: '0.0.0', main: 'index.js' }));
    fs.writeFileSync(path.join(target, 'index.js'), source);
  };
  write('dsh-llm', "exports.createUserMessage = spec => ({ role: 'user', ...spec });\n");
  write('dsh-tools', "exports.defineTool = spec => spec;\n");
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fake-host', version: '0.0.0' }));
  return path.join(root, 'package.json');
}

const HOST_MANIFEST = makeHostManifest();

/** 最小的 Cordis 上下文：实现 on()/tools.register()，并可按 waterfall 顺序分发。 */
function makeContext() {
  const registered = new Map();
  const tools = [];
  return {
    tools: { register(spec) { tools.push(spec); } },
    tool(name) { return tools.find(item => item.name === name); },
    on(event, listener) {
      const list = registered.get(event) ?? [];
      list.push(listener);
      registered.set(event, list);
      return () => {};
    },
    async dispatch(event, payload, terminal = async () => ({ kind: 'allow' })) {
      const list = registered.get(event) ?? [];
      let index = 0;
      const run = async () => {
        if (index >= list.length) return terminal(payload);
        const listener = list[index++];
        return listener(payload, run);
      };
      return run();
    },
    /** tools/result 是观察型事件，监听器签名是 (exec, result)，没有 next。 */
    async emitResult(exec, value) {
      for (const listener of registered.get('tools/result') ?? []) await listener(exec, value);
    },
    async emitDisposed(payload) {
      for (const listener of registered.get('agent/disposed') ?? []) await listener(payload);
    },
  };
}

const agent = { id: 'session-test' };
const call = (ctx, name, args, callId) => ctx.dispatch('tools/pre-execute', {
  name, arguments: args, agent, callId,
});
const result = (ctx, name, args, text, isError = false) => ctx.emitResult({
  name, arguments: args, agent, callId: 'r-' + Math.random(),
}, {
  isError,
  content: [{ type: 'text', text }],
  error: isError ? { message: text } : undefined,
});
const step = (ctx, turn = 1) => ctx.dispatch('agent/pre-step', {
  agent, turn, step: 2, signal: { aborted: false },
}, async () => ({ kind: 'enter', messages: [] }));

const FAIL_ARGS = { command: 'node -e "process.exit(7)"' };
const FAIL_TEXT = 'exit code 7';

async function repeatCall(ctx, times, name = 'pwsh', args = FAIL_ARGS, text = FAIL_TEXT) {
  for (let index = 1; index <= times; index += 1) {
    const decision = await call(ctx, name, args, 'c' + index);
    if (decision.kind === 'deny') return index;
    await result(ctx, name, args, text, true);
  }
  return times + 1;
}

const start = (options = {}) => {
  const ctx = makeContext();
  guard.apply(ctx, { threshold: 3, hostManifest: HOST_MANIFEST, ...options });
  return ctx;
};

// ── R2 ─────────────────────────────────────────────────────────────────────

test('R2 第 4 次同工具同参数同输出被拒绝，并同时注入换路指令', async () => {
  const ctx = start();
  assert.equal(await repeatCall(ctx, 3), 4); // 前三次都放行
  const blocked = await call(ctx, 'pwsh', FAIL_ARGS, 'c4');
  assert.equal(blocked.kind, 'deny');
  assert.equal(blocked.info.code, DENIAL_CODE);
  // 拒绝理由本身就要带换路指令，不能只给拒绝码
  assert.match(blocked.reason, /当前做法已连续 3 次相同/);
  assert.match(blocked.reason, /请换一个可检验的新策略，并先说明新假设与判定标准/);
  // 同一轮内下一步还要注入一条 user 消息
  const injected = await step(ctx);
  assert.equal(injected.messages.length, 1);
  assert.match(injected.messages[0].content[0].text, /当前做法已连续 3 次相同/);
  assert.match(injected.messages[0].content[0].text, /判定标准/);
});

test('参数不同会重置计数；相同参数但输出不同也会重置', async () => {
  const ctx = start();
  await call(ctx, 'read', { path: 'a.txt' }, 'a1');
  await result(ctx, 'read', { path: 'a.txt' }, 'first');
  await call(ctx, 'read', { path: 'a.txt' }, 'a2');
  await result(ctx, 'read', { path: 'a.txt' }, 'second');
  await call(ctx, 'read', { path: 'a.txt' }, 'a3');
  await result(ctx, 'read', { path: 'a.txt' }, 'second');
  const allowed = await call(ctx, 'read', { path: 'a.txt' }, 'a4');
  assert.equal(allowed.kind, 'allow');
  const other = await call(ctx, 'read', { path: 'b.txt' }, 'b1');
  assert.equal(other.kind, 'allow');
});

test('同一命令只改 description 仍算相似调用，第 4 次被拒绝', async () => {
  const ctx = start();
  for (let index = 1; index <= 3; index += 1) {
    const args = { ...FAIL_ARGS, description: 'call ' + index };
    assert.equal((await call(ctx, 'pwsh', args, 'd' + index)).kind, 'allow');
    await result(ctx, 'pwsh', args, '[exit code: 1]', true);
  }
  const blocked = await call(ctx, 'pwsh', { ...FAIL_ARGS, description: 'call 4' }, 'd4');
  assert.equal(blocked.kind, 'deny');
  assert.equal(blocked.info.code, DENIAL_CODE);
});

test('调用参数不同但连续 3 次输出相同：注入强制换路提示，不硬拒绝', async () => {
  const ctx = start();
  for (let index = 1; index <= 3; index += 1) {
    const args = { command: 'echo probe-' + index };
    assert.equal((await call(ctx, 'pwsh', args, 'o' + index)).kind, 'allow');
    await result(ctx, 'pwsh', args, 'no matches found');
  }
  const injected = await step(ctx);
  assert.equal(injected.messages.length, 1);
  assert.match(injected.messages[0].content[0].text, /连续 3 次得到相同输出/);
  assert.match(injected.messages[0].content[0].text, /请换一个可检验的新策略/);
});

// ── R3 ─────────────────────────────────────────────────────────────────────

test('R3① 连续 2 次相同调用但轮次未到：只触发拦截，不误触自检', async () => {
  const ctx = start({ threshold: 2, selfCheckEvery: 5 });
  await step(ctx, 1); // 轮次开始
  assert.equal(await repeatCall(ctx, 2), 3); // 第 3 次被拦
  const blocked = await call(ctx, 'pwsh', FAIL_ARGS, 'c3');
  assert.equal(blocked.kind, 'deny');
  const injected = await step(ctx, 1); // 仍是第 1 轮，5 轮自检不该触发
  assert.equal(injected.messages.length, 1);
  assert.match(injected.messages[0].content[0].text, /运行时防循环/);
  assert.doesNotMatch(injected.messages[0].content[0].text, /事前自检/);
});

test('R3② 轮次到了但没有相同调用：只触发自检，不触发拦截', async () => {
  const ctx = start({ threshold: 3, selfCheckEvery: 2 });
  assert.equal((await step(ctx, 1)).messages.length, 0);
  const second = await step(ctx, 2);
  assert.equal(second.messages.length, 1);
  assert.match(second.messages[0].content[0].text, /事前自检/);
  assert.match(second.messages[0].content[0].text, /当前做法是否在重复之前失败过的路径/);
  assert.doesNotMatch(second.messages[0].content[0].text, /运行时防循环/);
  // 全程没有任何调用被拒绝
  assert.equal((await call(ctx, 'pwsh', FAIL_ARGS, 'x1')).kind, 'allow');
});

test('R3 两个计数器互不影响：改 threshold 不影响轮次自检，改 selfCheckEvery 不影响拦截', async () => {
  const wide = start({ threshold: 10, selfCheckEvery: 2 });
  assert.equal((await step(wide, 2)).messages.length, 1); // 拦截阈值放大，自检照常
  const narrow = start({ threshold: 2, selfCheckEvery: 99 });
  await step(narrow, 1);
  assert.equal(await repeatCall(narrow, 2), 3); // 自检阈值放大，拦截照常
});

// ── R6 ─────────────────────────────────────────────────────────────────────

test('R6① hook 内部抛异常时放行，工具照常执行', async () => {
  const ctx = start();
  guard._internals.logs.length = 0;
  // 取值即抛错的参数对象：signature() 会在 JSON.stringify 的 replacer 里踩到它
  const exploding = { get command() { throw new Error('boom-from-test'); } };
  const decision = await call(ctx, 'pwsh', exploding, 'boom1');
  assert.equal(decision.kind, 'allow');
  assert.ok(guard._internals.logs.some(line => /pre-execute 异常/.test(line)));
  // 异常之后守卫仍然可用：三次相同调用后第 4 次照样拦截
  assert.equal(await repeatCall(ctx, 3), 4);
});

test('R6② 超大输出的 hash 只取前 N 字符，不随体积变慢也不误判', async () => {
  const head = 'x'.repeat(MAX_HASH_CHARS);
  const huge = text => ({ isError: false, content: [{ type: 'text', text }] });
  const started = Date.now();
  const a = guard._internals.outputKey(huge(head + 'A'.repeat(4 * 1024 * 1024)));
  const b = guard._internals.outputKey(huge(head + 'B'.repeat(4 * 1024 * 1024)));
  const elapsed = Date.now() - started;
  assert.equal(a, b, '超出上限的部分不应参与签名');
  assert.ok(elapsed < 2000, `大输出签名耗时 ${elapsed}ms，超出预期`);
  assert.equal(guard._internals.outputText(huge(head + 'tail')).length, MAX_HASH_CHARS);
});

// ── R7 ─────────────────────────────────────────────────────────────────────

for (const bad of [0, -1, 'abc', 1.5, null]) {
  test(`R7 threshold=${JSON.stringify(bad)} 回退默认 3 且不崩`, async () => {
    const ctx = start({ threshold: bad });
    assert.equal(await repeatCall(ctx, 3), 4); // 仍是第 4 次拦截
    assert.equal((await call(ctx, 'pwsh', FAIL_ARGS, 'c4')).kind, 'deny');
  });
}

test('R7 selfCheckEvery 非法值回退默认 3，并在日志里告警', async () => {
  guard._internals.logs.length = 0;
  const ctx = start({ selfCheckEvery: 0 });
  assert.equal((await step(ctx, 2)).messages.length, 0); // 默认 3：第 2 轮不触发
  assert.equal((await step(ctx, 3)).messages.length, 1); // 第 3 轮触发
  assert.ok(guard._internals.logs.some(line => /selfCheckEvery=0 不是正整数/.test(line)));
});

test('R7 合法值照常生效（N=2 / selfCheckEvery=4）', async () => {
  const ctx = start({ threshold: 2, selfCheckEvery: 4 });
  assert.equal((await step(ctx, 1)).messages.length, 0);
  assert.equal((await step(ctx, 2)).messages.length, 0);
  assert.equal((await step(ctx, 3)).messages.length, 0);
  const fourth = await step(ctx, 4);
  assert.equal(fourth.messages.length, 1);
  assert.match(fourth.messages[0].content[0].text, /事前自检/);
  // 自检阈值放大到 4，拦截仍按 threshold=2 生效
  assert.equal(await repeatCall(ctx, 2), 3);
});

// ── R8 ─────────────────────────────────────────────────────────────────────

test('R8 方向记录会被拦截提示引用（卡住时先回看而不是重想）', async () => {
  const ctx = start({ threshold: 2 });
  const tool = ctx.tool(guard._internals.DIRECTIONS_TOOL);
  assert.ok(tool, '方向记录工具应已注册');
  const saved = await tool.execute(
    { action: 'set', items: ['换判据：用 checker 而不是逐字符比对', '反向构造：从答案倒推输入'] },
    { agent },
  );
  assert.match(saved, /已记录 2 个方向/);
  assert.match(await tool.execute({ action: 'read' }, { agent }), /checker/);

  await step(ctx, 1);
  await repeatCall(ctx, 2);
  const blocked = await call(ctx, 'pwsh', FAIL_ARGS, 'c3');
  assert.equal(blocked.kind, 'deny');
  assert.match(blocked.reason, /已记录的方向（先回看，别急着重想）/);
  assert.match(blocked.reason, /用 checker 而不是逐字符比对/);
  assert.match(blocked.reason, /先检查这些方向里有没有还没试过/);
  const injected = await step(ctx, 1);
  assert.match(injected.messages[0].content[0].text, /反向构造/);
});

test('R8 方向记录最多 3 条、单条 200 字符，超限报错且不清空旧记录', async () => {
  const ctx = start();
  const tool = ctx.tool(guard._internals.DIRECTIONS_TOOL);
  await tool.execute({ action: 'set', items: ['A'] }, { agent });
  await assert.rejects(() => tool.execute({ action: 'set', items: ['1', '2', '3', '4'] }, { agent }), /最多记录 3 个方向/);
  await assert.rejects(() => tool.execute({ action: 'set', items: ['y'.repeat(201)] }, { agent }), /最多 200 字符/);
  assert.equal(await tool.execute({ action: 'read' }, { agent }), '1. A');
  assert.match(await tool.execute({ action: 'clear' }, { agent }), /已清除/);
  assert.equal(await tool.execute({ action: 'read' }, { agent }), '当前没有记录方向。');
});

// ── 其它既有行为 ────────────────────────────────────────────────────────────

test('checkpoint / directions / todo 记账工具不参与相似计数', async () => {
  const ctx = start();
  for (let index = 1; index <= 6; index += 1) {
    assert.equal((await call(ctx, 'deliberate_checkpoint', { action: 'read' }, 'k' + index)).kind, 'allow');
    assert.equal((await call(ctx, guard._internals.DIRECTIONS_TOOL, { action: 'read' }, 'm' + index)).kind, 'allow');
  }
});

test('连续两次撞上同一拦截后结束本轮；同一轮只拒绝一次，下一轮恢复', async () => {
  const ctx = start({ threshold: 2 });
  await step(ctx, 1);
  await repeatCall(ctx, 2);
  assert.equal((await call(ctx, 'pwsh', FAIL_ARGS, 'c3')).kind, 'deny');
  assert.equal((await call(ctx, 'pwsh', FAIL_ARGS, 'c4')).kind, 'deny');
  const rejected = await step(ctx, 1);
  assert.equal(rejected.kind, 'reject');
  // 同一轮再次进入 pre-step 不应无限拒绝
  assert.notEqual((await step(ctx, 1)).kind, 'reject');
  // 新用户轮次恢复
  assert.notEqual((await step(ctx, 2)).kind, 'reject');
});

test('缺少 hostManifest 时仍能拦截（只是注入退化为纯文本消息）', async () => {
  const ctx = makeContext();
  await guard.apply(ctx, { threshold: 2 });
  await step(ctx, 1);
  await repeatCall(ctx, 2);
  const blocked = await call(ctx, 'pwsh', FAIL_ARGS, 'c3');
  assert.equal(blocked.kind, 'deny');
  const injected = await step(ctx, 1);
  assert.equal(injected.messages[0].role, 'user');
});
