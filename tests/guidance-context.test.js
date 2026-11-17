import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGuidancePrompt, GUIDANCE_CONTEXT_LIMITS } from '../backend/src/guidance-context.js';
import { DEFAULT_CONFIG } from '../shared/definitions.js';

function fixture(stage=0) {
  return {student:{condition:'responsive-hint'},progress:{stage,config:structuredClone(DEFAULT_CONFIG),state:{drafts:{0:{problem:'记录B预报有雨仍灌溉',variable:'weather',reason:'可能缺少天气判断'}},rule:{threshold:2700,skipRain:true,minutes:8}}},trigger:'help',question:'记录B能说明什么？',history:[],recentTrials:[]};
}
function context(result) { return JSON.parse(result.messages[1].content.split('\n').slice(1).join('\n')); }
function trial(id=17,stage=1) {
  return {id,stage,data:{input:{moisture:1800,weather:'rainy',actualRain:false,sensorConnected:true,pumpConnected:false,prediction:'irrigate',question:'检查天气因素'},decision:false,waterMl:0,finalMoisture:1775,rule:{threshold:2800,skipRain:false,minutes:10},series:[{internal:'不应进入提示词'}]}};
}

test('观察期提供原始记录、阶段任务与学生猜想，不泄漏隐藏规则或测评答案',()=>{
  const input=fixture();input.progress.config.referenceRule.secret='参考规则隐藏标记';input.progress.config.assessmentAnswers='测评答案隐藏标记';
  input.progress.state.drafts[0].unknown='未知字段隐藏标记';input.progress.state.drafts[4]={conclusion:'未来阶段隐藏标记'};
  const result=buildGuidancePrompt(input),data=context(result),serialized=JSON.stringify(result);
  assert.equal(data.currentStage.title,DEFAULT_CONFIG.stages[0].title);
  assert.match(data.currentStage.task,/初步猜想/);
  assert.deepEqual(data.observationRecords.map(record=>record.id),['A','B','C']);
  assert.equal(data.observationRecords[1].forecast,'预报有雨');assert.equal(data.observationRecords[1].decision,'灌溉');
  assert.equal(data.originalHypothesis.reason,input.progress.state.drafts[0].reason);
  assert.equal(data.currentRule,undefined);
  for (const word of ['参考规则隐藏标记','测评答案隐藏标记','未知字段隐藏标记','未来阶段隐藏标记','initialRule','referenceRule']) assert.ok(!serialized.includes(word));
});

test('测试提供固定证据编号、预测和连接状态；优化期才加入学生可见的当前规则',()=>{
  const input=fixture(1);input.recentTrials=[trial(17),trial(23)];
  let data=context(buildGuidancePrompt(input));
  assert.deepEqual(data.recentTests.map(test=>test.id),[17,23]);
  assert.deepEqual(data.recentTests[0].input,{reading:1800,forecast:'预报有雨',actualRain:false,sensorConnected:true,pumpConnected:false,prediction:'irrigate',question:'检查天气因素'});
  assert.equal(data.recentTests[0].decision,'不灌溉');assert.equal(data.recentTests[0].waterMl,0);assert.equal(data.recentTests[0].finalReading,1775);
  assert.equal(data.recentTests[0].rule,undefined);assert.equal(data.recentTests[0].recordedRule,undefined);assert.equal(data.currentRule,undefined);assert.ok(!JSON.stringify(data).includes('不应进入提示词'));
  input.progress.stage=2;input.progress.state.drafts[2]={reason:'加入天气判断再测试'};
  data=context(buildGuidancePrompt(input));assert.deepEqual(data.currentRule,input.progress.state.rule);assert.equal(data.studentWork.at(-1).fields.reason,'加入天气判断再测试');
  assert.deepEqual(data.recentTests[0].recordedRule,input.recentTrials[0].data.rule);assert.notDeepEqual(data.recentTests[0].recordedRule,data.currentRule);
});

test('对照事实只比较实际输入与规则，预测不同不能被当作决策原因',()=>{
  const input=fixture(1),before=trial(17),after=trial(18);
  before.data.input.weather='sunny';before.data.input.prediction='wait';before.data.decision=true;
  after.data.input.weather='rainy';after.data.input.prediction='unsure';after.data.input.question='问题文字也变化了';
  input.recentTrials=[before,after];
  let data=context(buildGuidancePrompt(input));
  assert.deepEqual(data.recentComparison,{testIds:[17,18],sameReading:true,changedInputs:['weather'],sameRule:true});
  assert.equal(data.recentTests[0].predictionMatched,false);assert.equal(data.recentTests[1].predictionMatched,null);
  after.data.input.prediction='wait';after.data.rule.skipRain=true;
  data=context(buildGuidancePrompt(input));assert.equal(data.recentTests[1].predictionMatched,true);assert.equal(data.recentComparison.sameRule,false);assert.equal(data.recentTests[1].recordedRule,undefined);
  delete before.data.rule;data=context(buildGuidancePrompt(input));assert.equal(data.recentComparison.sameRule,null);
  input.recentTrials=[after];assert.equal(context(buildGuidancePrompt(input)).recentComparison,null);
});

test('反向标定保持本轮事实，历史规则与当前规则明确区分',()=>{
  const input=fixture(3);input.progress.config.higherMeansWetter=false;
  input.recentTrials=[trial(31,2),trial(32,3)];input.recentTrials[1].data.input.moisture=3200;
  input.recentTrials[1].data.rule={threshold:3100,skipRain:true,minutes:6};
  const result=buildGuidancePrompt(input),data=context(result);
  assert.equal(data.sensor.meaning,'读数越大越干');assert.equal(data.recentComparison.sameReading,false);
  assert.deepEqual(data.recentComparison.changedInputs,['moisture']);assert.equal(data.recentComparison.sameRule,false);
  assert.equal(data.recentTests[0].recordedRule.threshold,2800);assert.equal(data.recentTests[1].recordedRule.threshold,3100);assert.equal(data.currentRule.threshold,2700);
  assert.match(result.messages[0].content,/不能从灌溉决策倒推/);assert.match(result.messages[0].content,/不能自动当作同一规则版本/);
  assert.match(result.promptVersion,/^qinghe-v\d+\.\d+$/);
});

test('反向标定的原始A/C天气相同，比较事实不把差异归因于天气或未记录规则',()=>{
  const input=fixture();input.progress.config.higherMeansWetter=false;
  const result=buildGuidancePrompt(input),data=context(result);
  assert.equal(data.sensor.meaning,'读数越大越干');
  assert.deepEqual(data.observationComparisons[0],{recordIds:['A','C'],sameForecast:true,sameReading:false,sameDecision:false});
  assert.equal(data.observationComparisons[0].sameRule,undefined);
  assert.deepEqual(data.observationComparisons.find(pair=>pair.recordIds.join('/')==='A/B'),{recordIds:['A','B'],sameForecast:false,sameReading:false,sameDecision:true});
  assert.match(result.messages[0].content,/天气相同，不能把决策差异归因于天气变化/);
  input.progress.config.higherMeansWetter=true;
  assert.deepEqual(context(buildGuidancePrompt(input)).observationComparisons,data.observationComparisons);
});

test('原始记录对照最多六对，优先同天气且不生成不存在的记录编号',()=>{
  const input=fixture();
  input.progress.config.scenarios=Array.from({length:20},(_,id)=>({id:`R${id}`,moisture:id%3===0?1800:3200,weather:id%2===0?'sunny':'rainy',decision:id%3===0}));
  const data=context(buildGuidancePrompt(input));
  assert.equal(data.observationComparisons.length,6);
  assert.deepEqual(data.observationComparisons[0].recordIds,['R0','R2']);
  assert.ok(data.observationComparisons.every(pair=>pair.sameForecast));
  assert.ok(data.observationComparisons.flatMap(pair=>pair.recordIds).every(id=>data.observationRecords.some(record=>record.id===id)));
});

test('历史保留已答轮次与主动提示，失败的连续问题不污染下一次请求',()=>{
  const input=fixture(1);
  input.history=[{role:'assistant',content:'先想一想要检查哪个变量。'},
    {role:'user',content:'失败后没有答案的问题'},
    {role:'user',content:'先前有答案的问题'},{role:'assistant',content:'先前已生成的指导'},
    {role:'user',content:'自动提示前失败的问题'},{role:'assistant',trigger:'idle',content:'停留后的主动提示'},
    {role:'user',content:input.question}];
  const messages=buildGuidancePrompt(input).messages;
  assert.ok(messages.some(message=>message.content==='先想一想要检查哪个变量。'));
  assert.ok(messages.some(message=>message.content==='先前有答案的问题'));
  assert.ok(!messages.some(message=>message.content==='失败后没有答案的问题'));
  assert.ok(!messages.some(message=>message.content==='自动提示前失败的问题'));assert.ok(messages.some(message=>message.content==='停留后的主动提示'));
  assert.equal(messages.map(message=>message.content).join('\n').split(input.question).length-1,1);
  assert.equal(messages.at(-1).role,'user');assert.ok(messages.at(-1).content.includes(input.question));
});

test('长草稿和长历史受到预算约束，最新提问完整保留且截断明确标注',()=>{
  const input=fixture(4),long='超长学生内容'.repeat(1000);
  input.question='本次完整问题'.repeat(200);
  input.progress.config.stages[4].title=long;input.progress.config.stages[4].description=long;
  input.progress.config.scenarios=Array.from({length:20},(_,i)=>({id:long+i,moisture:1800,weather:'rainy',decision:true}));
  input.progress.state.drafts={0:{problem:long,variable:long,reason:long},1:{plan:long,evidence:long},2:{reason:long},3:{analysis:long,limitation:long},4:{conclusion:long,transfer:long}};
  input.history=Array.from({length:40},(_,i)=>({role:i%2?'assistant':'user',content:`第${i}条${long}`}));
  input.recentTrials=Array.from({length:100},(_,i)=>{const row=trial(i);row.data.input.question=long;return row;});
  const result=buildGuidancePrompt(input),data=context(result),history=result.messages.slice(2,-1);
  assert.ok(result.contextChars<=GUIDANCE_CONTEXT_LIMITS.contextChars,`实际上下文字符数：${result.contextChars}`);
  assert.ok(history.reduce((sum,message)=>sum+message.content.length,0)<=GUIDANCE_CONTEXT_LIMITS.historyChars);
  assert.match(JSON.stringify(data),/内容已截断/);assert.ok(data.recentTests.length>=2&&data.recentTests.length<=8);assert.deepEqual(data.recentTests.slice(-2).map(row=>row.id),[98,99]);
  assert.equal(result.messages.at(-1).content.split(input.question).length-1,1);
  assert.match(result.messages.at(-1).content,/本次反馈要求/);
  assert.match(history.at(-1).content,/第39条/);
});

test('静态教学前缀不随实验材料变化，线索和详细条件分别保留教学约束',()=>{
  const input=fixture(1),hint=buildGuidancePrompt(input);
  input.progress.stage=3;input.question='修改后的问题';input.recentTrials=[trial()];
  assert.equal(buildGuidancePrompt(input).messages[0].content,hint.messages[0].content);
  assert.match(hint.messages[0].content,/80字内/);assert.match(hint.messages[0].content,/最终结论/);assert.match(hint.messages[0].content,/不得编造/);
  input.student.condition='active-detailed';const detailed=buildGuidancePrompt(input);
  assert.match(detailed.messages[0].content,/150至250字/);assert.match(detailed.messages.at(-1).content,/150至250个中文字符/);assert.notEqual(detailed.messages[0].content,hint.messages[0].content);
  input.trigger='anomaly';input.question='';assert.match(buildGuidancePrompt(input).messages.at(-1).content,/触发事件/);
});

test('最新工作台与草案进入材料，明确区分尚未运行设置、已保存规则和历史测试',()=>{
  const input=fixture(2);input.recentTrials=[trial(17)];
  input.progress.state.workspace={stage:2,updatedAt:'2026-11-03T10:00:00Z',input:{moisture:3300,weather:'cloudy',actualRain:true,sensorConnected:false,pumpConnected:true,prediction:'wait',question:'准备检查尚未测试的连接'},ruleDraft:{threshold:null,minutes:6,skipRain:false},deviceId:'sensor',viewStage:1,viewedTrialId:17,secret:'不应传递的工作台字段'};
  input.recentActions=[{id:90,stage:2,type:'workspace_changed',created_at:'2026-11-03T10:00:00Z',data:{changes:{input:{weather:'cloudy'}}}},
    {id:91,stage:2,type:'posttest_submitted',data:{answers:'独立测评不应进入材料'}}];
  const result=buildGuidancePrompt(input),data=context(result);
  assert.equal(data.latestWorkspace.input.reading,3300);assert.equal(data.latestWorkspace.input.forecast,'多云');
  assert.equal(data.latestWorkspace.input.sensorConnected,false);assert.equal(data.latestWorkspace.input.prediction,'wait');
  assert.equal(data.latestWorkspace.ruleDraft.threshold,null);assert.equal(data.currentRule.threshold,2700);
  assert.equal(data.recentTests[0].input.reading,1800);assert.equal(data.recentTests[0].recordedRule.threshold,2800);
  assert.equal(data.latestWorkspace.viewedTrialId,17);assert.equal(data.latestWorkspace.input.decision,undefined);
  assert.equal(data.recentActions.length,1);assert.equal(data.recentActions[0].actionId,90);
  assert.ok(!JSON.stringify(data).includes('不应'));assert.match(result.messages[0].content,/尚未保存/);assert.match(result.messages[0].content,/不代表已经运行/);
});

test('旧阶段工作台不混入新阶段，早期操作不泄漏尚未公开规则',()=>{
  const input=fixture(1);
  input.progress.state.workspace={stage:0,input:{question:'旧阶段未测试输入'}};
  input.recentActions=[{id:1,stage:1,type:'workspace_changed',data:{changes:{ruleDraft:{threshold:2800,minutes:10,skipRain:false},deviceId:'pump'}}}];
  const data=context(buildGuidancePrompt(input));
  assert.equal(data.latestWorkspace,undefined);assert.equal(data.recentActions[0].changes.ruleDraft,undefined);
  assert.equal(data.recentActions[0].changes.deviceId,'pump');
});
