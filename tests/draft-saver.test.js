import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftSaver } from '../frontend/src/draft-saver.js';

test('延迟的自动保存先结束，求助前保存等待自己的最新文本完成', async () => {
  const firstStarted = Promise.withResolvers(), releaseFirst = Promise.withResolvers();
  const writes = [];
  let stored, questionContext;
  const saver = createDraftSaver(async snapshot => {
    writes.push(snapshot.data.plan);
    if (writes.length === 1) { firstStarted.resolve(); await releaseFirst.promise; }
    stored = snapshot.data.plan;
  });
  const oldSave = saver.save({stage:1,data:{plan:'原先草稿'}});
  await firstStarted.promise;
  const askSave = saver.save({stage:1,data:{plan:'提问时的新草稿'}}).then(() => { questionContext = stored; });
  await Promise.resolve();
  assert.deepEqual(writes, ['原先草稿']);
  assert.equal(questionContext, undefined);
  releaseFirst.resolve();
  await Promise.all([oldSave, askSave]);
  assert.deepEqual(writes, ['原先草稿','提问时的新草稿']);
  assert.equal(stored, '提问时的新草稿');
  assert.equal(questionContext, '提问时的新草稿');
});

test('队列固定每次调用的文本，后续编辑不会改变已排队的请求', async () => {
  const gate = Promise.withResolvers(), started = Promise.withResolvers(), writes = [];
  const saver = createDraftSaver(async snapshot => {
    writes.push(snapshot.data.plan);
    if (writes.length === 1) { started.resolve(); await gate.promise; }
  });
  const first = saver.save({stage:1,data:{plan:'旧文本'}});
  await started.promise;
  const draft = {stage:1,data:{plan:'这一次求助的文本'}};
  const second = saver.save(draft);
  draft.data.plan = '求助后继续输入的文本';
  gate.resolve(); await Promise.all([first,second]);
  assert.deepEqual(writes, ['旧文本','这一次求助的文本']);
});

test('阶段切换取消旧队列，之后新阶段的保存仍然可用', async () => {
  const started = Promise.withResolvers(), writes = [];
  const saver = createDraftSaver(async (snapshot, signal) => {
    writes.push(snapshot.stage);
    if (snapshot.stage === 0) {
      started.resolve();
      await new Promise((resolve,reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'),{name:'AbortError'})),{once:true}));
    }
  });
  const first = saver.save({stage:0,data:{problem:'旧阶段'}});
  await started.promise;
  const queued = saver.save({stage:0,data:{problem:'等待中的旧阶段'}});
  const checked = Promise.all([assert.rejects(first,{name:'AbortError'}),assert.rejects(queued,{name:'AbortError'})]);
  saver.cancelPending();
  await checked;
  await saver.save({stage:1,data:{plan:'新阶段'}});
  assert.deepEqual(writes, [0,1]);
});

test('单次失败不静默重试，也不会阻塞之后明确发起的保存', async () => {
  let calls = 0;
  const saver = createDraftSaver(async snapshot => {
    calls += 1;
    if (calls === 1) throw new Error('connection failed');
    return snapshot.data.plan;
  });
  await assert.rejects(saver.save({stage:1,data:{plan:'失败文本'}}),/connection failed/);
  await saver.flush();
  assert.equal(calls, 1);
  assert.equal(await saver.save({stage:1,data:{plan:'重新保存'}}),'重新保存');
  saver.dispose();
  await assert.rejects(saver.save({stage:1,data:{plan:'退出后的请求'}}),{name:'AbortError'});
  assert.equal(calls, 2);
});
