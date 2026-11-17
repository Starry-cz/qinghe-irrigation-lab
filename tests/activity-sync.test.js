import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createActivitySync} from '../frontend/src/activity-sync.js';

test('连续编辑合并为最新状态，求助前同步关闭本次自动介入',async()=>{
  const writes=[];
  const sync=createActivitySync(async body=>{writes.push(body);return {};});
  sync.change(1,{input:{weather:'sunny',question:'旧目的'}});
  sync.change(1,{input:{weather:'rainy',question:'最新目的'},deviceId:'sensor'});
  await sync.flush();
  assert.deepEqual(writes,[{stage:1,data:{input:{weather:'rainy',question:'最新目的'},deviceId:'sensor'},allowGuidance:false}]);
  sync.dispose();
});

test('旧请求延迟时串行保存最新操作，求助等待新的版本',async()=>{
  const writes=[],entered=Promise.withResolvers(),release=Promise.withResolvers();
  let stored;
  const sync=createActivitySync(async body=>{
    writes.push(body);
    if(writes.length===1){entered.resolve();await release.promise;}
    stored=body.data.input.weather;
    return {};
  });
  sync.change(1,{input:{weather:'sunny'}});
  const first=sync.flush({allowGuidance:true}); await entered.promise;
  sync.change(1,{input:{weather:'rainy'}});
  const manual=sync.flush();
  await Promise.resolve();assert.equal(writes.length,1);
  release.resolve();await Promise.all([first,manual]);
  assert.equal(stored,'rainy');assert.equal(writes.length,2);
  assert.equal(writes[1].allowGuidance,false);
  sync.dispose();
});

test('完成同步后不重发已确认草案，后续查看动作不会恢复已保存的旧草案',async()=>{
  const writes=[];
  const sync=createActivitySync(async body=>{writes.push(body);return {};});
  sync.change(2,{ruleDraft:{threshold:2400,minutes:8,skipRain:true}});await sync.flush();
  // 此时规则保存接口可清空服务器草案；下次设备查看不能把草案再写回去。
  sync.change(2,{deviceId:'pump'});await sync.flush();
  assert.deepEqual(writes[1].data,{deviceId:'pump'});
  sync.dispose();
});

test('自动活动等待草稿时点击求助，真正发请求前降为只保存',async()=>{
  const waiting=Promise.withResolvers(),saved=Promise.withResolvers(),sent=[];
  const sync=createActivitySync(async body=>{
    waiting.resolve();await saved.promise;
    // 与fetch序列化时机一致：草稿等待结束后才固定请求体。
    sent.push(structuredClone(body));return {};
  });
  sync.change(1,{input:{weather:'rainy'}});
  const automatic=sync.flush({allowGuidance:true});await waiting.promise;
  const beforeHelp=sync.flush();saved.resolve();
  await Promise.all([automatic,beforeHelp]);
  assert.equal(sent[0].allowGuidance,false);
  sync.dispose();
});

test('快照复制嵌套对象，排队期间的外部修改不能污染已发送操作',async()=>{
  const entered=Promise.withResolvers(),release=Promise.withResolvers(),writes=[];
  const sync=createActivitySync(async body=>{writes.push(body);entered.resolve();await release.promise;return {};});
  const draft={threshold:2300,minutes:7,skipRain:true};
  sync.change(2,{ruleDraft:draft});const saved=sync.flush();await entered.promise;
  draft.threshold=999;release.resolve();await saved;
  assert.equal(writes[0].data.ruleDraft.threshold,2300);
  sync.dispose();
});

test('失败明确返回，心跳不重试；再次手动同步保存最新数据',async()=>{
  let calls=0;
  const sync=createActivitySync(async()=>{calls+=1;if(calls===1)throw new Error('同步失败');return {};});
  sync.change(1,{input:{weather:'rainy'}});
  await assert.rejects(sync.flush(),/同步失败/);
  await assert.rejects(sync.flush({allowGuidance:true,retryFailed:false}),/同步失败/);
  assert.equal(calls,1);
  await sync.flush();assert.equal(calls,2);
  sync.dispose();
});

test('阶段切换丢弃待发输入并中止旧阶段请求，新阶段仍可同步',async()=>{
  const entered=Promise.withResolvers(),writes=[];
  const sync=createActivitySync(async(body,signal)=>{
    writes.push(body.stage);
    if(body.stage===1){entered.resolve();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('cancelled'),{name:'AbortError'})),{once:true}));}
    return {};
  });
  sync.change(1,{input:{weather:'rainy'}});const first=sync.flush();await entered.promise;
  const cancelled=assert.rejects(first,{name:'AbortError'});
  sync.change(1,{input:{weather:'cloudy'}});sync.reset();
  sync.change(2,{ruleDraft:{threshold:null,minutes:8,skipRain:true}});
  await sync.flush();await cancelled;
  assert.deepEqual(writes,[1,2]);
  sync.dispose();
});

test('文字停顿后只同步一次，初始化快照不触发主动指导',async()=>{
  const writes=[];
  const sync=createActivitySync(async body=>{writes.push(body);return {};},{delay:15});
  sync.change(1,{input:{question:'初始'}},{allowGuidance:false});
  sync.change(1,{input:{question:'最终输入'}},{allowGuidance:false});
  await delay(45);assert.equal(writes.length,1);assert.equal(writes[0].allowGuidance,false);
  sync.dispose();await delay(20);assert.equal(writes.length,1);
});
