import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_CONFIG } from '../shared/definitions.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const dir=mkdtempSync(join(tmpdir(),'qinghe-live-state-'));
const dbPath=join(dir,'lab.db');
const base='http://127.0.0.1:43196/api',upstream='http://127.0.0.1:43197';
const credentials={role:'teacher',username:'live-state-admin',password:'Live-state-test-only-2026'};
const calls=[],gates=new Map(),logs=[];
let server,admin;
const terminal=new Set(['succeeded','failed','cancelled']);
const trialInput={moisture:1800,weather:'sunny',actualRain:false,sensorConnected:true,pumpConnected:true,prediction:'unsure',question:'检查原始测试条件'};
const stageDrafts=[
  {problem:'检查预报和灌溉决定的关系',variable:'weather',reason:'比较已有观察记录中的条件'},
  {plan:'保持读数相同，比较天气条件',evidence:'根据测试编号说明结果'},
  {reason:'修改判断条件后重新测试'},
  {analysis:'在不同条件下核对方案',limitation:'还需要更多情境验证'},
  {conclusion:'依据测试证据调整了规则',transfer:'更换植物后重新采集水分需求'},
];

// 捕获真实后端发出的模型请求，只连接本机 mock，不使用租用服务或正式学生数据。
const mock=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw),call={body,receivedAt:Date.now()};calls.push(call);
  const closed=Promise.withResolvers();res.once('close',()=>closed.resolve());
  const gate=gates.get(body.model);
  if(gate){gate.entered.resolve();await Promise.race([gate.released.promise,closed.promise]);}
  if(res.destroyed)return;
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({choices:[{message:{content:'请先区分当前准备的条件与已经完成的测试，再说明需要什么证据。'},finish_reason:'stop'}],usage:{prompt_tokens:123,completion_tokens:38,total_tokens:161}}));
});
async function request(path,{body,method=body?'POST':'GET',cookie}={}){
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(5000)});
  const raw=await response.text();
  return {status:response.status,data:response.headers.get('content-type')?.includes('json')?JSON.parse(raw):raw,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function until(check,message,timeout=6000){
  const deadline=Date.now()+timeout;
  do{const value=await check();if(value)return value;await delay(25);}while(Date.now()<deadline);
  assert.fail(message);
}
function database(fn){const db=new DatabaseSync(dbPath);try{return fn(db);}finally{db.close();}}
function context(call){return JSON.parse(call.body.messages[1].content.split('\n').slice(1).join('\n'));}
async function state(student){const result=await request('/student/state',{cookie:student.cookie});assert.equal(result.status,200);return result.data;}
async function settle(student,result){
  assert.ok([200,202].includes(result.status),JSON.stringify(result.data));
  const id=result.data.guidance?.id;
  if(!id)return result.data;
  return until(async()=>{const data=await state(student);return data.guidance?.id===id&&terminal.has(data.guidance.status)?data:false;},`指导 ${id} 未结束`);
}
async function setup({conditions=['responsive-hint'],config={}}={}){
  const created=await request('/admin/experiments',{cookie:admin,body:{title:'最新操作状态回归'}});assert.equal(created.status,201);
  const id=created.data.id;
  const configured=await request(`/admin/experiments/${id}`,{cookie:admin,method:'PUT',body:{status:'open',config:{...DEFAULT_CONFIG,assessmentEnabled:false,allowHelpBeforeHypothesis:true,cooldownSeconds:0,idleSeconds:3600,minExploreTests:1,minVerifyTests:1,...config}}});assert.equal(configured.status,200);
  const roster=await request('/admin/students',{cookie:admin,body:{experimentId:id,students:conditions.map((condition,i)=>({name:`实时学生${i}`,studentNo:`live-${id}-${i}`,className:'操作同步验证班',condition}))}});assert.equal(roster.status,201);
  const students=[];
  for(const student of roster.data.students){const login=await request('/login',{body:{role:'student',name:student.name,studentNo:student.studentNo}});assert.equal(login.status,200);students.push({...student,cookie:login.cookie});}
  return {id,students};
}
async function activity(student,stage,data,allowGuidance=true){return request('/student/activity',{cookie:student.cookie,body:{stage,data,allowGuidance}});}
async function advance(student,stage){return settle(student,await request('/student/advance',{cookie:student.cookie,body:{stage,data:stageDrafts[stage]}}));}
async function trial(student,input={}){return settle(student,await request('/student/trial',{cookie:student.cookie,body:{...trialInput,...input}}));}
async function help(student,question='请结合我的当前操作帮助思考。'){
  const current=await state(student);
  return request('/student/help',{cookie:student.cookie,body:{stage:current.stage,question}});
}
async function selectModel(student,model){
  const result=await request('/model-settings',{cookie:student.cookie,method:'PUT',body:{mode:'custom',baseUrl:upstream+'/v1',model,apiKey:'test-only-live-model-key',thinking:'disabled'}});
  assert.equal(result.status,200,JSON.stringify(result.data));
}
before(async()=>{
  await new Promise(resolve=>mock.listen(43197,'127.0.0.1',resolve));
  server=spawn(process.execPath,['backend/src/index.js'],{cwd:root,windowsHide:true,env:{...process.env,DB_PATH:dbPath,PORT:'43196',HOST:'127.0.0.1',TEACHER_USERNAME:credentials.username,TEACHER_PASSWORD:credentials.password,
    NODE_ENV:'test',ALLOW_LOCAL_MODEL_ENDPOINTS:'true',AI_PROVIDER:'openai',AI_BASE_URL:upstream+'/v1',AI_MODEL:'live-default',AI_API_KEY:'test-only-live-key',AI_THINKING:'',AI_MAX_CONCURRENT:'1',AI_QUEUE_LIMIT:'8',AI_QUEUE_WAIT_MS:'10000'},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',d=>logs.push(d.toString()));server.stderr.on('data',d=>logs.push(d.toString()));
  await until(async()=>{try{return (await request('/health')).status===200;}catch{return false;}},'最新状态测试后端未启动：'+logs.join(''),10000);
  const login=await request('/login',{body:credentials});assert.equal(login.status,200);admin=login.cookie;
});
after(async()=>{
  for(const gate of gates.values())gate.released.resolve();
  if(server?.exitCode===null){const exited=new Promise(resolve=>server.once('exit',resolve));server.kill();await exited;}
  mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve));
  // dir 只来自本测试新建的操作系统临时目录，正式数据库与工作区文件不参与清理。
  rmSync(dir,{recursive:true,force:true});
});

test('未运行的最新条件进入求助上下文，连续更新不丢字段且不制造测试结果',async()=>{
  const {students:[student]}=await setup();await advance(student,0);
  const before=calls.length;
  assert.equal((await activity(student,1,{input:{weather:'rainy',moisture:3111,sensorConnected:false}})).status,200);
  assert.equal((await activity(student,1,{input:{actualRain:true,pumpConnected:false,prediction:'wait',question:'尚未运行的新计划 LIVE-UNRUN'}})).status,200);
  assert.equal(calls.length,before,'响应组的操作同步不能自动调用模型');
  const current=await state(student);
  assert.equal(current.state.workspace.input.weather,'rainy');assert.equal(current.state.workspace.input.moisture,3111);
  assert.equal(current.state.workspace.input.sensorConnected,false);assert.equal(current.state.workspace.input.pumpConnected,false);
  assert.equal(current.trials.length,0);
  await settle(student,await help(student));
  const evidence=context(calls.at(-1));
  assert.equal(evidence.latestWorkspace.input.reading,3111);assert.equal(evidence.latestWorkspace.input.forecast,'预报有雨');
  assert.equal(evidence.latestWorkspace.input.actualRain,true);assert.equal(evidence.latestWorkspace.input.sensorConnected,false);assert.equal(evidence.latestWorkspace.input.pumpConnected,false);
  assert.equal(evidence.latestWorkspace.input.prediction,'wait');assert.match(evidence.latestWorkspace.input.question,/LIVE-UNRUN/);
  assert.equal(evidence.recentTests.length,0);assert.equal(evidence.latestWorkspace.decision,undefined);assert.equal(evidence.latestWorkspace.waterMl,undefined);
  assert.ok(evidence.recentActions.length>0);
  assert.equal((await state(student)).trials.length,0);
});

test('未保存规则草案可被指导读取，不能覆盖正式规则或冒充已完成测试',async()=>{
  const {students:[student]}=await setup();await advance(student,0);await trial(student);await advance(student,1);
  const before=await state(student),draft={threshold:1300,minutes:4,skipRain:true};
  assert.equal((await activity(student,2,{ruleDraft:draft,input:{question:'先解释这份草案 LIVE-RULE-DRAFT'}},false)).status,200);
  await settle(student,await help(student));
  const evidence=context(calls.at(-1)),current=await state(student);
  assert.deepEqual(evidence.latestWorkspace.ruleDraft,draft);assert.deepEqual(evidence.currentRule,before.state.rule);
  assert.deepEqual(current.state.rule,before.state.rule);assert.equal(current.trials.length,before.trials.length);
  // 清空中的输入仍是草案；保存正式控制规则必须经过原有数值校验。
  assert.equal((await activity(student,2,{ruleDraft:{threshold:null,minutes:null,skipRain:false}},false)).status,200);
  assert.equal((await request('/student/rule',{cookie:student.cookie,body:{threshold:null,minutes:null,skipRain:false}})).status,400);
  const saved=await request('/student/rule',{cookie:student.cookie,body:draft});assert.equal(saved.status,200);
  assert.deepEqual(saved.data.state.rule,draft);assert.equal(saved.data.state.workspace.ruleDraft,null);
});

test('查看历史测试与下一次测试条件分开，不能读取其他学生的测试',async()=>{
  const {students:[first,second]}=await setup({conditions:['responsive-hint','responsive-detailed']});
  for(const student of [first,second]){await advance(student,0);await trial(student);}
  const old=(await state(first)).trials.at(-1),foreign=(await state(second)).trials.at(-1);
  assert.equal((await activity(first,1,{input:{moisture:3333,weather:'rainy',question:'下一次测试 LIVE-NEXT'}},false)).status,200);
  assert.equal((await activity(first,1,{viewedTrialId:old.id,deviceId:'sensor'},false)).status,200);
  await settle(first,await help(first));
  const evidence=context(calls.at(-1));
  assert.equal(evidence.latestWorkspace.viewedTrialId,old.id);assert.equal(evidence.latestWorkspace.input.reading,3333);
  assert.equal(evidence.recentTests.at(-1).input.reading,1800);assert.equal(evidence.recentTests.at(-1).input.forecast,'晴天');
  assert.equal((await state(first)).trials.length,1);
  const denied=await activity(first,1,{viewedTrialId:foreign.id},false);assert.ok(denied.status>=400&&denied.status<500);
  assert.notEqual((await state(second)).state.workspace?.input?.question,'下一次测试 LIVE-NEXT');
  assert.equal((await activity(first,1,{input:{weather:'cloudy'}},false)).status,200);
  assert.equal((await state(first)).state.workspace.viewedTrialId,null,'改变测试条件后退出历史结果视图');
});

test('新阶段清除旧工作台快照，旧页面的迟到操作不能写入新阶段',async()=>{
  const {students:[student]}=await setup();await advance(student,0);await trial(student);
  await activity(student,1,{input:{question:'旧阶段输入 LIVE-OLD-STAGE'},deviceId:'tank'},false);
  const next=await advance(student,1);assert.equal(next.stage,2);
  assert.ok(!JSON.stringify(next.state.workspace).includes('LIVE-OLD-STAGE'));
  const denied=await activity(student,1,{input:{question:'迟到输入 LIVE-LATE'}},false);assert.equal(denied.status,409);
  assert.ok(!JSON.stringify((await state(student)).state.workspace).includes('LIVE-LATE'));
});

test('主动组操作可触发指导，查看操作不触发，同类指导去重并保留线索与详细条件',async()=>{
  const {students}=await setup({conditions:['active-hint','active-detailed']});
  for(const student of students){
    await advance(student,0);const before=calls.length;
    assert.equal((await activity(student,1,{deviceId:'sensor',viewStage:0,observationId:'B'})).status,200);
    assert.equal(calls.length,before,'仅查看不应新增教学介入');
    const result=await activity(student,1,{input:{weather:'rainy',question:'主动操作 LIVE-ACTIVE'}});
    assert.equal(result.status,200);assert.equal(result.data.guidance.trigger,'operation');
    await settle(student,result);assert.equal(calls.length,before+1);
    const call=calls.at(-1);assert.equal(context(call).trigger,'operation');
    assert.match(call.body.messages[0].content,student.condition==='active-hint'?/80字/:/150至250字/);
    await activity(student,1,{input:{weather:'cloudy'}});assert.equal(calls.length,before+1,'同阶段同类自动提示仍然去重');
  }
});

test('主动操作继续遵守冷却和手动求助权限，同值同步不延长空闲计时',async()=>{
  const {students:[student]}=await setup({conditions:['active-hint'],config:{cooldownSeconds:45,activeCanAsk:false}});
  await advance(student,0);const before=calls.length;
  assert.equal((await activity(student,1,{input:{weather:'rainy'}})).status,200);
  assert.equal(calls.length,before,'阶段提示后的冷却期内不能继续自动指导');
  assert.equal((await help(student)).status,409,'禁止主动组手动求助的设置仍生效');
  const first=await state(student);await delay(30);
  assert.equal((await activity(student,1,{input:{weather:'rainy'}})).status,200);
  assert.equal((await state(student)).state.lastActivityAt,first.state.lastActivityAt);
  const reasons=database(db=>db.prepare("SELECT data FROM events WHERE student_id=? AND type='guidance_skipped'").all(student.id));
  assert.ok(reasons.some(row=>row.data.includes('冷却')));
});

test('前后独立测评期间，操作同步和停留都不能绕过禁答',async()=>{
  const {students:[student]}=await setup({conditions:['active-detailed'],config:{assessmentEnabled:true,allowHelpBeforeHypothesis:true}});
  const before=calls.length;
  assert.equal((await activity(student,0,{deviceId:'controller',observationId:'B'})).status,200);
  assert.equal((await help(student,'请帮我回答前测')).status,409);
  database(db=>{const row=db.prepare('SELECT state FROM progress WHERE student_id=?').get(student.id),data=JSON.parse(row.state);data.lastActivityAt='2000-01-01T00:00:00.000Z';db.prepare('UPDATE progress SET state=? WHERE student_id=?').run(JSON.stringify(data),student.id);});
  assert.equal((await request('/student/heartbeat',{cookie:student.cookie,body:{}})).status,200);
  assert.equal(calls.length,before);
  assert.equal((await request('/student/assessment',{cookie:student.cookie,body:{kind:'pretest',answers:[0,1,2,3]}})).status,200);
  await advance(student,0);
  for(let stage=1;stage<=3;stage++){await trial(student);await advance(student,stage);}
  const atPost=calls.length;assert.equal((await state(student)).canAsk,false);
  assert.equal((await activity(student,4,{viewStage:2,deviceId:'pump'})).status,200);
  assert.equal((await help(student,'请帮我回答后测')).status,409);
  assert.equal((await request('/student/heartbeat',{cookie:student.cookie,body:{}})).status,200);
  assert.equal(calls.length,atPost);
  assert.equal((await request('/student/assessment',{cookie:student.cookie,body:{kind:'posttest',answers:[0,1,2,3]}})).status,200);
  await settle(student,await help(student,'测评已经结束，整理已有证据。'));
  assert.equal(calls.length,atPost+1);assert.equal(context(calls.at(-1)).currentStage.id,4);
  assert.ok(!JSON.stringify(context(calls.at(-1))).includes('answers'));
});

test('排队期间同步的新操作和草稿，在真正开始模型生成时读取',async()=>{
  const {students:[blocking,waiting]}=await setup({conditions:['responsive-hint','responsive-detailed']});
  for(const student of [blocking,waiting])await advance(student,0);
  const model='live-held-model',gate={entered:Promise.withResolvers(),released:Promise.withResolvers()};gates.set(model,gate);
  await selectModel(blocking,model);
  try{
    const first=await help(blocking);assert.equal(first.status,202);await gate.entered.promise;
    await activity(waiting,1,{input:{question:'排队前的旧计划 LIVE-BEFORE',weather:'sunny'}},false);
    const second=await help(waiting);assert.equal(second.status,202);assert.equal(second.data.guidance.status,'queued');
    await activity(waiting,1,{input:{question:'排队后更新的计划 LIVE-AFTER',weather:'rainy',moisture:3222}},false);
    assert.equal((await request('/student/draft',{cookie:waiting.cookie,body:{stage:1,data:{plan:'排队后更新的草稿 LIVE-DRAFT-AFTER',evidence:'等待比较'}}})).status,200);
    gate.released.resolve();await settle(blocking,first);await settle(waiting,second);
    const evidence=context(calls.at(-1));
    assert.equal(evidence.latestWorkspace.input.reading,3222);assert.equal(evidence.latestWorkspace.input.forecast,'预报有雨');
    assert.match(evidence.latestWorkspace.input.question,/LIVE-AFTER/);assert.ok(!evidence.latestWorkspace.input.question.includes('LIVE-BEFORE'));
    assert.ok(JSON.stringify(evidence.studentWork).includes('LIVE-DRAFT-AFTER'));
  }finally{gate.released.resolve();gates.delete(model);}
});
