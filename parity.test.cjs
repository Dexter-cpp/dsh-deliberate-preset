'use strict';

/**
 * 两个 preset 的一致性测试（R1 / R11）。
 * 运行：node --test parity.test.cjs
 *
 * R1：proof 与 deliberate 都必须注册 loop-guard，且 proof 的 memory.cjs 里不能残留旧防循环守卫。
 * R11：C1（发散）/ C3（断点）/ C4（交付）/ 防循环 的语义必须一致，措辞可不同。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PROOF_DIR = path.join(ROOT, '..', 'proof-preset');
const DELIBERATE_DIR = ROOT;
const read = file => fs.readFileSync(file, 'utf8');

const SOURCES = {
  proof: {
    dir: PROOF_DIR,
    patch: read(path.join(PROOF_DIR, 'cordis.patch.yml')),
    memory: read(path.join(PROOF_DIR, 'memory.cjs')),
    guard: read(path.join(PROOF_DIR, 'loop-guard.cjs')),
    pkg: JSON.parse(read(path.join(PROOF_DIR, 'package.json'))),
  },
  deliberate: {
    dir: DELIBERATE_DIR,
    patch: read(path.join(DELIBERATE_DIR, 'cordis.patch.yml')),
    memory: read(path.join(DELIBERATE_DIR, 'memory.cjs')),
    guard: read(path.join(DELIBERATE_DIR, 'loop-guard.cjs')),
    pkg: JSON.parse(read(path.join(DELIBERATE_DIR, 'package.json'))),
  },
};

/** 取 persona 的 prefix / suffix 块标量（只认本项目 yml 的固定缩进）。 */
function extractPersona(text) {
  const lines = text.split(/\r?\n/);
  const personaAt = lines.findIndex(line => /^\s*-\s+id:\s*persona\s*$/.test(line));
  assert.ok(personaAt >= 0, 'cordis.patch.yml 里找不到 - id: persona');
  const collect = key => {
    const pattern = new RegExp('^\\s*' + key + ':\\s*\\|-\\s*$');
    const at = lines.findIndex((line, index) => index > personaAt && pattern.test(line));
    assert.ok(at > personaAt, `persona 缺少 ${key} 块`);
    const indent = lines[at].search(/\S/);
    const body = [];
    for (let index = at + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.trim() === '') { body.push(''); continue; }
      if (line.search(/\S/) <= indent) break;
      body.push(line.trim());
    }
    return body.join('\n');
  };
  return { prefix: collect('prefix'), suffix: collect('suffix') };
}

// ── R1 ─────────────────────────────────────────────────────────────────────

test('R1 两个 cordis.patch.yml 都注册了 loop-guard，且指向各自的包', () => {
  const rows = {
    proof: /^ {10}- id: loop-guard$/m.test(SOURCES.proof.patch),
    deliberate: /^ {10}- id: loop-guard$/m.test(SOURCES.deliberate.patch),
  };
  assert.equal(rows.proof, true, 'proof 缺少 loop-guard 注册');
  assert.equal(rows.deliberate, true, 'deliberate 缺少 loop-guard 注册');
  assert.match(SOURCES.proof.patch, /name: '@local\/dsh-proof-preset\/loop-guard\.cjs'/);
  assert.match(SOURCES.deliberate.patch, /name: '@local\/dsh-deliberate-preset\/loop-guard\.cjs'/);
  // 配置项必须显式写出，且默认值为正整数 3
  for (const mode of ['proof', 'deliberate']) {
    assert.match(SOURCES[mode].patch, /threshold:\s*3/, `${mode} 缺少 threshold`);
    assert.match(SOURCES[mode].patch, /selfCheckEvery:\s*3/, `${mode} 缺少 selfCheckEvery`);
  }
});

test('R1 loop-guard 在 session-memory 之前注册，先拿到调用', () => {
  for (const mode of ['proof', 'deliberate']) {
    const patch = SOURCES[mode].patch;
    const guardAt = patch.search(/^ {10}- id: loop-guard$/m);
    const memoryAt = patch.search(/^ {10}- id: session-memory$/m);
    assert.ok(guardAt > 0 && memoryAt > 0, `${mode} 缺少行`);
    assert.ok(guardAt < memoryAt, `${mode} 的 loop-guard 应排在 session-memory 之前`);
  }
});

test('R1 proof 的 memory.cjs 已无旧防循环守卫，也不再注入换路提示', () => {
  for (const mode of ['proof', 'deliberate']) {
    const memory = SOURCES[mode].memory;
    assert.doesNotMatch(memory, /ctx\.tools\.guard/, `${mode} 仍残留 ctx.tools.guard`);
    assert.doesNotMatch(memory, /REPEATED_IDENTICAL_FAILURE/, `${mode} 仍残留拒绝码`);
    assert.doesNotMatch(memory, /已连续 .* 次以相同参数/, `${mode} 仍残留换路提示`);
  }
});

test('R1 两份实现逐字节一致，靠 package.json 名字区分模式', () => {
  assert.equal(SOURCES.proof.memory, SOURCES.deliberate.memory, '两份 memory.cjs 应完全一致');
  assert.equal(SOURCES.proof.guard, SOURCES.deliberate.guard, '两份 loop-guard.cjs 应完全一致');
});

test('R1 proof 的 loop-guard 能独立工作：第 4 次相同调用被拒绝', async () => {
  const guard = require(path.join(PROOF_DIR, 'loop-guard.cjs'));
  assert.equal(guard._internals.MODE, 'proof');
  assert.equal(guard._internals.CHECKPOINT_TOOL, 'proof_checkpoint');
  assert.equal(guard._internals.DIRECTIONS_TOOL, 'proof_directions');

  const listeners = new Map();
  const ctx = {
    tools: { register() {} },
    on(event, listener) { listeners.set(event, [...(listeners.get(event) ?? []), listener]); return () => {}; },
  };
  await guard.apply(ctx, { threshold: 3 });
  const agent = { id: 'proof-smoke' };
  const args = { command: 'node -e "process.exit(7)"' };
  const call = () => {
    let index = 0;
    const list = listeners.get('tools/pre-execute') ?? [];
    const run = async () => (index < list.length ? list[index++]({ name: 'pwsh', arguments: args, agent }, run) : { kind: 'allow' });
    return run();
  };
  const emit = async text => {
    for (const listener of listeners.get('tools/result') ?? []) {
      await listener({ name: 'pwsh', arguments: args, agent }, { isError: true, content: [{ type: 'text', text }], error: { message: text } });
    }
  };
  for (let index = 1; index <= 3; index += 1) {
    assert.equal((await call()).kind, 'allow');
    await emit('exit code 7');
  }
  const blocked = await call();
  assert.equal(blocked.kind, 'deny');
  assert.equal(blocked.info.code, 'REPEATED_IDENTICAL_FAILURE');
  assert.match(blocked.reason, /请换一个可检验的新策略/);
});

// ── R11 ────────────────────────────────────────────────────────────────────

const PARITY = [
  { rule: 'C1 发散：先重述问题，再列 2–3 个方向并记入方向工具', words: ['重述问题', '真正的目标', '2–3 个', '反直觉', '简单问答或单步小改可跳过', '_directions'] },
  { rule: 'C3 断点：save/read/clear 时机与工具不可用兜底', words: ['断点', 'clear', '工具不可用', '先核对断点'] },
  { rule: 'C4 交付：静态检查与运行验证分开，不编造风险', words: ['静态检查与运行验证分开写', '不编造', '未验证'] },
  { rule: '防循环：事前自检 + 运行时 loop-guard 计数 + 止损', words: ['事前自检', 'loop-guard', '止损'] },
];

test('R11 proof 与 deliberate 的 C1/C3/C4/防循环 语义逐条一致', () => {
  const personas = {
    proof: extractPersona(SOURCES.proof.patch),
    deliberate: extractPersona(SOURCES.deliberate.patch),
  };
  const text = mode => personas[mode].prefix + '\n' + personas[mode].suffix;
  const missing = [];
  for (const group of PARITY) {
    for (const mode of ['proof', 'deliberate']) {
      const absent = group.words.filter(word => !text(mode).includes(word));
      if (absent.length > 0) missing.push(`${mode} / ${group.rule} 缺：${absent.join('、')}`);
    }
  }
  assert.deepEqual(missing, [], missing.join('\n'));
});

test('R11 每个 preset 只引用自己的工具名，不串台', () => {
  const proofText = extractPersona(SOURCES.proof.patch);
  const deliberateText = extractPersona(SOURCES.deliberate.patch);
  assert.match(proofText.prefix + proofText.suffix, /proof_directions/);
  assert.doesNotMatch(proofText.prefix + proofText.suffix, /deliberate_directions/);
  assert.match(deliberateText.prefix + deliberateText.suffix, /deliberate_directions/);
  assert.doesNotMatch(deliberateText.prefix + deliberateText.suffix, /proof_directions/);
});

test('R11 两个 preset 的防循环规则不互相矛盾：都靠 hook 计数，都保留 3 次换路', () => {
  for (const mode of ['proof', 'deliberate']) {
    const persona = extractPersona(SOURCES[mode].patch);
    const text = persona.prefix + '\n' + persona.suffix;
    // 都声明“不靠你自己计数”，避免模型和 hook 各数一套
    assert.match(text, /不靠你自己计数/, `${mode} 缺少“不靠你自己计数”`);
    // 都保留“三次/三轮”的止损锚点
    assert.match(text, /(连续三轮|连续失败 3 次|失败三次)/, `${mode} 缺少止损锚点`);
  }
});
