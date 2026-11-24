'use strict';

/**
 * memory.cjs 的单元测试：断点落盘的安全与容错（R9）。
 * 两份 memory.cjs（proof / deliberate）跑同一组断言，防止只改一边。
 * 运行：node --test memory.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TARGETS = [
  { mode: 'deliberate', module: require('./memory.cjs') },
  { mode: 'proof', module: require('../proof-preset/memory.cjs') },
];

/** 每个用例一个干净的 DSH_HOME，避免互相看到对方写的断点。 */
function useHome(mode) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `checkpoint-${mode}-`));
  process.env.DSH_HOME = home;
  process.env.DSH_PROFILE = mode;
  return home;
}

for (const target of TARGETS) {
  const { mode, module: memory } = target;
  const api = memory._internals;

  test(`[${mode}] R9 敏感字段在落盘前被过滤`, async () => {
    useHome(mode);
    const note = [
      '目标：修 add()；api_key: sk-live-abcdef1234567890',
      'password: hunter2',
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij',
      '下一步：跑 node check.js',
    ].join('\n');
    const stored = await api.writeCheckpoint('session-secret', note);
    assert.doesNotMatch(stored, /sk-live-abcdef/);
    assert.doesNotMatch(stored, /hunter2/);
    assert.doesNotMatch(stored, /eyJhbGciOiJIUzI1NiJ9/);
    assert.match(stored, /下一步：跑 node check\.js/);
    // 磁盘上也不能留明文
    const raw = fs.readFileSync(api.checkpointPath('session-secret'), 'utf8');
    assert.doesNotMatch(raw, /sk-live-abcdef/);
    assert.doesNotMatch(raw, /hunter2/);
    assert.equal(await api.readCheckpoint('session-secret'), stored);
  });

  test(`[${mode}] R9 普通断点不被误伤`, async () => {
    useHome(mode);
    const note = '目标：让 test3 通过；已排除：编码问题；下一步：跑 test3.js 看 diff';
    assert.equal(await api.writeCheckpoint('session-plain', note), note);
    assert.equal(await api.readCheckpoint('session-plain'), note);
  });

  test(`[${mode}] R9 损坏文件被隔离并按空断点重建，不抛异常`, async () => {
    const home = useHome(mode);
    const file = api.checkpointPath('session-broken');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"schemaVersion":1,"note":"半截', 'utf8');

    const loaded = await api.loadCheckpoint('session-broken');
    assert.equal(loaded.status, 'corrupt');
    assert.equal(loaded.note, '');
    assert.equal(await api.readCheckpoint('session-broken'), '');

    const quarantined = fs.readdirSync(path.join(home, 'checkpoints', mode)).filter(name => name.includes('.corrupt-'));
    assert.equal(quarantined.length, 1, '损坏文件应被重命名隔离，而不是直接丢掉');
    assert.equal(fs.existsSync(file), false);

    // 重建：下一次 save 直接写新文件，read 能读回
    assert.equal(await api.writeCheckpoint('session-broken', '重建后的断点'), '重建后的断点');
    assert.equal(await api.readCheckpoint('session-broken'), '重建后的断点');
    assert.ok(api.warnings.some(line => /断点文件损坏/.test(line)));
  });

  test(`[${mode}] R9 schema 不符 / 会话不符按空断点处理`, async () => {
    useHome(mode);
    const file = api.checkpointPath('session-schema');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 99, sessionId: 'session-schema', note: 'x' }), 'utf8');
    assert.equal((await api.loadCheckpoint('session-schema')).status, 'corrupt');

    const other = api.checkpointPath('session-foreign');
    fs.writeFileSync(other, JSON.stringify({ schemaVersion: 1, sessionId: 'another-session', note: 'x' }), 'utf8');
    const foreign = await api.loadCheckpoint('session-foreign');
    assert.equal(foreign.status, 'foreign');
    assert.equal(foreign.note, '');
    assert.equal(fs.existsSync(other), true, '别的会话的文件不该被隔离');
  });

  test(`[${mode}] clear 删除断点文件`, async () => {
    useHome(mode);
    await api.writeCheckpoint('session-clear', '待清除');
    assert.equal(fs.existsSync(api.checkpointPath('session-clear')), true);
    await api.clearCheckpoint('session-clear');
    assert.equal(fs.existsSync(api.checkpointPath('session-clear')), false);
    assert.equal(await api.readCheckpoint('session-clear'), '');
  });
}

test('两份 memory.cjs 内容一致（只靠 package.json 区分 proof / deliberate）', () => {
  const a = fs.readFileSync(path.join(__dirname, 'memory.cjs'), 'utf8');
  const b = fs.readFileSync(path.join(__dirname, '..', 'proof-preset', 'memory.cjs'), 'utf8');
  assert.equal(a, b);
});
