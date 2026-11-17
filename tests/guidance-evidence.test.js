import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { getGuidanceEvidence } from '../backend/src/guidance-evidence.js';
import { buildGuidancePrompt, GUIDANCE_CONTEXT_LIMITS } from '../backend/src/guidance-context.js';
import { DEFAULT_CONFIG } from '../shared/definitions.js';

function fixture() {
  const database=new DatabaseSync(':memory:');
  database.exec('CREATE TABLE trials(id INTEGER PRIMARY KEY,student_id TEXT,stage INTEGER,data TEXT);');
  const insert=database.prepare('INSERT INTO trials VALUES (?,?,?,?)');
  for(let id=1;id<=12;id++) insert.run(id,'student-a',1,JSON.stringify({input:{moisture:id*100,weather:'sunny',actualRain:false,sensorConnected:true,pumpConnected:true,prediction:'unsure',question:'检查变量'},rule:{threshold:2800,skipRain:false,minutes:10},decision:true,waterMl:350,finalMoisture:2200}));
  insert.run(99,'student-b',1,JSON.stringify({input:{question:'他人的测试资料'}}));
  return database;
}
function input(evidence) {
  return {student:{condition:'responsive-hint'},progress:{stage:1,config:structuredClone(DEFAULT_CONFIG),state:{drafts:{},rule:{threshold:2700,skipRain:true,minutes:8}}},trigger:'help',question:'比较测试 #1 和 #2',history:[],...evidence};
}
function context(result) { return JSON.parse(result.messages[1].content.split('\n').slice(1).join('\n')); }

test('明确引用较早记录时按所属学生检索，最近窗口和比较事实保持独立',()=>{
  const database=fixture();
  try{
    const evidence=getGuidanceEvidence(database,'student-a','请比较测试 #1 和 #2，顺便看看测试记录编号99。');
    assert.deepEqual(evidence.recentTrials.map(row=>row.id),[5,6,7,8,9,10,11,12]);
    assert.deepEqual(evidence.referencedTrials.map(row=>row.id),[1,2]);assert.deepEqual(evidence.missingReferenceIds,[99]);
    const data=context(buildGuidancePrompt(input(evidence)));
    assert.deepEqual(data.referencedTests.map(row=>row.id),[1,2]);assert.deepEqual(data.recentComparison.testIds,[11,12]);
    assert.deepEqual(data.unavailableTestIds,[99]);assert.ok(!JSON.stringify(data).includes('他人的测试资料'));
    assert.equal(data.referencedTests[0].recordedRule,undefined);
  }finally{database.close();}
});

test('仅提到读数时不查编号，显式编号去重且检索数量受限',()=>{
  const database=fixture();
  try{
    assert.deepEqual(getGuidanceEvidence(database,'student-a','读数1800，浇水10分钟，测试结果如何？').referencedTrials,[]);
    assert.deepEqual(getGuidanceEvidence(database,'student-a','测试1和2两种读数后会怎样？').referencedTrials,[]);
    const evidence=getGuidanceEvidence(database,'student-a','比较测试记录编号1、2和3，测试编号4，#1，#5，#6。');
    assert.deepEqual(evidence.referencedTrials.map(row=>row.id),[1,2,3,4]);assert.deepEqual(evidence.omittedReferenceIds,[5,6]);
  }finally{database.close();}
});

test('转义后的真实上下文有上限，压缩时仍保留明确引用和最近两次证据',()=>{
  const database=fixture();
  try{
    const evidence=getGuidanceEvidence(database,'student-a','比较#1、#2、#3、#4');
    const data=input(evidence),long='x'+'\n'.repeat(4998)+'x';data.progress.stage=4;
    data.progress.config.stages[4].title=long;data.progress.config.stages[4].description=long;
    data.progress.config.scenarios=Array.from({length:20},()=>({id:long,moisture:1800,weather:'sunny',decision:true}));
    data.progress.state.drafts={0:{problem:long,variable:'weather',reason:long},1:{plan:long,evidence:long},2:{reason:long},3:{analysis:long,limitation:long},4:{conclusion:long,transfer:long}};
    data.progress.state.workspace={stage:4,updatedAt:'2026-11-03T10:00:00Z',viewStage:3,deviceId:'sensor',viewedTrialId:12};
    // 操作历史会增长，预算紧张时仍需保留当前查看状态与明确引用的测试证据。
    data.recentActions=Array.from({length:12},(_,id)=>({id,stage:3,type:'workspace_changed',data:{changes:{input:{question:long,moisture:1800,weather:'rainy'}}}}));
    for(const row of [...data.recentTrials,...data.referencedTrials]) row.data.input.question='x'+'\n'.repeat(998)+'x';
    const result=buildGuidancePrompt(data),packed=context(result);
    assert.ok(result.contextChars<=GUIDANCE_CONTEXT_LIMITS.contextChars,`转义后的字符数：${result.contextChars}`);
    assert.equal(result.contextChars,JSON.stringify(packed).length);
    assert.deepEqual(packed.referencedTests.map(row=>row.id),[1,2,3,4]);assert.deepEqual(packed.recentTests.slice(-2).map(row=>row.id),[11,12]);
    assert.deepEqual(packed.recentComparison.testIds,[11,12]);assert.match(JSON.stringify(packed),/已截断/);
    assert.equal(packed.latestWorkspace.deviceId,'sensor');assert.equal(packed.latestWorkspace.viewedTrialId,12);
  }finally{database.close();}
});
