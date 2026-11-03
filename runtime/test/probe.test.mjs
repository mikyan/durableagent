import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeProbe } from '../dist/probe.js';

test('a conversation streams Chinese text through the real SDK and reconnects to its state', {timeout:5000}, async () => {
  const probe = new RuntimeProbe();
  await probe.start();
  const observed = [];
  const off = probe.observe(state => observed.push(state));
  try {
    const result = await probe.send('请回答你好🌍');
    assert.equal(result.status, 'done');
    assert.equal(probe.snapshot().text, '你好🌍');
    assert(observed.some(s => s.text === '你'));
    off();
    let reconnected;
    probe.observe(state => { reconnected = state; })();
    assert.equal(reconnected.text, '你好🌍');
    assert.equal(probe.snapshot().sdk, '1.5.0');
  } finally { await probe.close(); }
});

test('stop aborts a hanging model read and close allows a fresh single owner', {timeout:7000}, async () => {
  const probe = new RuntimeProbe({ hang: true });
  await Promise.all([probe.start(), probe.start()]);
  try {
  const pending = probe.send('hang');
  const deadline = Date.now() + 5000;
  while (probe.snapshot().transportRequests !== 1 && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
  assert.equal(probe.snapshot().transportRequests, 1);
  await probe.stop();
  await pending;
  assert.equal(probe.snapshot().transportAborted, true);
  await probe.close();
  await probe.start();
  assert.equal(probe.snapshot().status, 'ready');
  await probe.close();
  } finally {await probe.close();}
});

test('close during initialization never revives the session', {timeout:5000}, async () => {
  const probe = new RuntimeProbe();
  const starting = probe.start();
  await probe.close();
  await starting;
  assert.equal(probe.snapshot().status, 'closed');
  await probe.start();
  assert.equal(probe.snapshot().status, 'ready');
  await probe.close();
});

test('tool arguments survive byte-split SSE and real pi-schema coercion', {timeout:5000}, async () => {
  const probe = new RuntimeProbe({tool: true});
  await probe.start();
  try {
    assert.equal((await probe.send('调用工具')).status, 'done');
    assert.deepEqual(probe.snapshot().toolArguments, [{city:'北京🌍',count:2}]);
  } finally {await probe.close();}
});

test('invalid tool arguments are rejected by the SDK before execution', {timeout:5000}, async () => {
  const probe = new RuntimeProbe({tool:true,invalidTool:true});
  await probe.start();
  try {
    assert.equal((await probe.send('invalid tool')).status,'done');
    assert.deepEqual(probe.snapshot().toolArguments,[]);
    assert.equal(probe.snapshot().toolRejected,true);
  } finally {await probe.close();}
});

test('the loaded module exercises required Node primitives and sqlite', {timeout:5000}, async () => {
  const probe = new RuntimeProbe();
  await probe.start();
  try {
    assert.equal(probe.snapshot().capabilities?.sqlite,42);
    assert.equal(probe.snapshot().capabilities?.text,'中文🌍');
    assert.equal(probe.snapshot().capabilities?.weakRef,true);
    assert.equal(probe.snapshot().capabilities?.proxy,7);
    assert.equal(probe.snapshot().capabilities?.asyncIteration,'ab');
    assert.match(probe.snapshot().capabilities?.moduleUrl,/\/dist\/capabilities\.js$/);
    assert.match(probe.snapshot().capabilities?.random,/^[\da-f-]{36}$/);
  } finally {await probe.close();}
});
