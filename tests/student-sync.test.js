import test from 'node:test';
import assert from 'node:assert/strict';
import { guidancePending, mergeMessages, mergeStudentSnapshot } from '../frontend/src/student-sync.js';

test('交错返回的指导快照保留新消息并按持久化编号排序', () => {
  const newer = [{ id:9, content:'新回复' }, { id:7, content:'问题' }];
  const older = [{ id:5, content:'此前指导' }, { id:7, content:'问题' }];
  const merged = mergeMessages(newer, older);
  assert.deepEqual(merged.map(message => message.id), [5,7,9]);
  assert.equal(merged.at(-1).content, '新回复');
  assert.equal(newer.length, 2);
});

test('旧阶段快照不回退当前阶段、成果或可求助状态', () => {
  const current = { stage:4, completed:true, canAsk:false, state:{ drafts:{4:{conclusion:'已提交'}} }, messages:[{id:8}] };
  const merged = mergeStudentSnapshot(current, { stage:3, completed:false, canAsk:true, state:{drafts:{}}, messages:[{id:6}] });
  assert.equal(merged.stage, 4);
  assert.equal(merged.completed, true);
  assert.equal(merged.canAsk, false);
  assert.equal(merged.state.drafts[4].conclusion, '已提交');
  assert.deepEqual(merged.messages.map(message => message.id), [6,8]);
  assert.equal(mergeStudentSnapshot(current, {stage:4,completed:false}).completed, true);
});

test('指导任务只前进，新任务可以替换已经完成的旧任务', () => {
  const initial = { stage:1, messages:[], guidance:{id:4,status:'running'} };
  const queued = mergeStudentSnapshot(initial, {guidance:{id:4,status:'queued'}});
  assert.equal(queued.guidance.status, 'running');
  const succeeded = mergeStudentSnapshot(queued, {guidance:{id:4,status:'succeeded'}});
  assert.equal(guidancePending(succeeded.guidance), false);
  assert.equal(mergeStudentSnapshot(succeeded, initial).guidance.status, 'succeeded');
  assert.equal(mergeStudentSnapshot(succeeded, {guidance:null}).guidance.status, 'succeeded');
  const next = mergeStudentSnapshot(succeeded, {guidance:{id:5,status:'queued'}});
  assert.equal(next.guidance.id, 5);
  assert.equal(guidancePending(next.guidance), true);
  assert.equal(mergeStudentSnapshot(next, {guidance:{id:4,status:'failed'}}).guidance.id, 5);
});

test('心跳局部快照不覆盖当前草稿，初始空消息可正常载入', () => {
  const initial = mergeStudentSnapshot(null, {stage:1,messages:[],state:{drafts:{1:{plan:'保留这段思考'}}}});
  const merged = mergeStudentSnapshot(initial, {stage:1,status:'open',messages:[{id:1,content:'指导'}],guidance:{id:1,status:'failed',error:'服务繁忙'}});
  assert.equal(merged.state.drafts[1].plan, '保留这段思考');
  assert.equal(merged.messages.length, 1);
  assert.equal(guidancePending(merged.guidance), false);
  assert.equal(merged.guidance.error, '服务繁忙');
});

test('同阶段迟到的业务快照不能回退测评和规则，但仍可补齐消息', () => {
  const current = {stage:2,revision:30,completed:false,canAsk:true,state:{preDone:true,rule:{threshold:2100}},trials:[{id:11}],messages:[{id:9}]};
  const older = {stage:2,revision:28,completed:false,canAsk:false,state:{preDone:false,rule:{threshold:1800}},trials:[],messages:[{id:8}],guidance:{id:7,status:'succeeded'}};
  const merged = mergeStudentSnapshot(current,older);
  assert.equal(merged.revision,30);
  assert.equal(merged.state.preDone,true);
  assert.equal(merged.state.rule.threshold,2100);
  assert.equal(merged.canAsk,true);
  assert.deepEqual(merged.trials,[{id:11}]);
  assert.deepEqual(merged.messages.map(message=>message.id),[8,9]);
  assert.equal(merged.guidance.status,'succeeded');
});
