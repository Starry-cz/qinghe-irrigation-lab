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
const dir=mkdtempSync(join(tmpdir(),'qinghe-agent-runtime-'));
const dbPath=join(dir,'lab.db');
const base='http://127.0.0.1:43191/api',upstream='http://127.0.0.1:43192';
const credentials={role:'teacher',username:'runtime-admin',password:'Runtime-test-only-2026'};
const calls=[],gates=new Map(),logs=[];
let server,admin,active=0,peak=0;
let queueLimit=8,queueWaitMs=5000;
const terminal=new Set(['succeeded','failed','cancelled']);
const trialInput={moisture:1800,weather:'sunny',actualRain:false,sensorConnected:true,pumpConnected:true,prediction:'unsure',question:'比较已有记录中的证据'};
const hypothesis={problem:'观察不同天气下的灌溉决策',variable:'weather',reason:'保持其他条件相同，检查已有猜想'};

// 所有模型请求均发往本地 HTTP mock，延迟由测试显式释放，不调用租用 API。
const mock=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw),call={body,receivedAt:Date.now(),finished:false};calls.push(call);
  active+=1;peak=Math.max(peak,active);
  const closed=Promise.withResolvers();res.once('close',()=>closed.resolve());
  try{
    const gate=gates.get(body.model);
    if(gate){gate.entered.resolve();await Promise.race([gate.released.promise,closed.promise]);}
    if(res.destroyed)return;
    res.setHeader('Content-Type','application/json');
    if(body.model==='runtime-unavailable'){
      res.writeHead(503);res.end(JSON.stringify({error:{message:'仅供测试的上游内部错误'}}));return;
    }
    res.end(JSON.stringify({choices:[{message:{content:'请根据已经完成的测试，说明你的判断与哪些观察证据对应。'},finish_reason:'stop'}],usage:{prompt_tokens:123,completion_tokens:45,total_tokens:168}}));
  }finally{active-=1;call.finished=true;}
});

async function request(path,{body,method=body?'POST':'GET',cookie,timeout=5000}={}){
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(timeout)});
  const raw=await response.text();
  return {status:response.status,data:response.headers.get('content-type')?.includes('json')?JSON.parse(raw):raw,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function until(check,message,timeout=6000){
  const deadline=Date.now()+timeout;
  do{const value=await check();if(value)return value;await delay(25);}while(Date.now()<deadline);
  assert.fail(message);
}
async function start(){
  server=spawn(process.execPath,['backend/src/index.js'],{cwd:root,env:{...process.env,DB_PATH:dbPath,PORT:'43191',HOST:'127.0.0.1',TEACHER_USERNAME:credentials.username,TEACHER_PASSWORD:credentials.password,
    NODE_ENV:'test',ALLOW_LOCAL_MODEL_ENDPOINTS:'true',AI_PROVIDER:'openai',AI_BASE_URL:upstream+'/v1',AI_MODEL:'runtime-default',AI_API_KEY:'test-only-runtime-key',AI_THINKING:'',
    AI_MAX_CONCURRENT:'2',AI_QUEUE_LIMIT:String(queueLimit),AI_QUEUE_WAIT_MS:String(queueWaitMs)},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',d=>logs.push(d.toString()));server.stderr.on('data',d=>logs.push(d.toString()));
  await until(async()=>{try{return (await request('/health')).status===200;}catch{return false;}},'异步智能体测试后端未启动：'+logs.join(''),10000);
}
async function stop(){
  if(!server||server.exitCode!==null)return;
  const exited=new Promise(resolve=>server.once('exit',resolve));server.kill();await exited;
}
function database(fn){const db=new DatabaseSync(dbPath);try{return fn(db);}finally{db.close();}}
function run(id){return database(db=>db.prepare('SELECT * FROM guidance_runs WHERE id=?').get(id));}
function hold(model){const gate={entered:Promise.withResolvers(),released:Promise.withResolvers()};gates.set(model,gate);return gate;}
async function selectModel(student,model){
  const result=await request('/model-settings',{cookie:student.cookie,method:'PUT',body:{mode:'custom',baseUrl:upstream+'/v1',model,apiKey:'test-only-personal-runtime-key',thinking:'disabled'}});
  assert.equal(result.status,200,JSON.stringify(result.data));
}
async function setup({conditions=['responsive-hint'],config={}}={}){
  const created=await request('/admin/experiments',{cookie:admin,body:{title:'异步智能体验收'}});assert.equal(created.status,201);
  const id=created.data.id;
  const configured=await request(`/admin/experiments/${id}`,{cookie:admin,method:'PUT',body:{status:'open',config:{...DEFAULT_CONFIG,assessmentEnabled:false,allowHelpBeforeHypothesis:true,cooldownSeconds:0,idleSeconds:3600,minExploreTests:1,minVerifyTests:1,...config}}});assert.equal(configured.status,200);
  const roster=await request('/admin/students',{cookie:admin,body:{experimentId:id,students:conditions.map((condition,i)=>({name:`异步学生${i}`,studentNo:`runtime-${id}-${i}`,className:'异步验证班',condition}))}});assert.equal(roster.status,201);
  const students=[];
  for(const student of roster.data.students){
    const login=await request('/login',{body:{role:'student',name:student.name,studentNo:student.studentNo}});assert.equal(login.status,200);students.push({...student,cookie:login.cookie});
  }
  return {id,students};
}
async function help(student,question='请帮助我检查实验中的证据。'){
  return request('/student/help',{cookie:student.cookie,body:{question}});
}
async function state(student){const result=await request('/student/state',{cookie:student.cookie});assert.equal(result.status,200);return result.data;}
async function done(student,id){return until(async()=>{const current=await state(student);return current.guidance?.id===id&&terminal.has(current.guidance.status)?current:false;},`任务 ${id} 未结束`);}
async function advance(student,stage,data){return request('/student/advance',{cookie:student.cookie,body:{stage,data}});}
async function trial(student,input={}){return request('/student/trial',{cookie:student.cookie,body:{...trialInput,...input}});}

before(async()=>{
  await new Promise(resolve=>mock.listen(43192,'127.0.0.1',resolve));await start();
  const login=await request('/login',{body:credentials});assert.equal(login.status,200);admin=login.cookie;
});
after(async()=>{
  for(const gate of gates.values())gate.released.resolve();
  await stop();mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve));
  // 删除目标仅为本测试刚生成的临时目录，正式平台数据不受影响。
  rmSync(dir,{recursive:true,force:true});
});

test('独立前测仍禁答，完成前测后按原条件受理指导',async()=>{
  const {students:[student]}=await setup({config:{assessmentEnabled:true,allowHelpBeforeHypothesis:true}});
  const before=calls.length;
  assert.equal((await state(student)).canAsk,false);
  assert.equal((await help(student,'请帮我回答知识前测')).status,409);
  const heartbeat=await request('/student/heartbeat',{cookie:student.cookie,body:{}});assert.equal(heartbeat.status,200);
  assert.equal(calls.length,before);assert.equal(database(db=>db.prepare('SELECT COUNT(*) AS n FROM guidance_runs WHERE student_id=?').get(student.id).n),0);
  assert.equal((await request('/student/assessment',{cookie:student.cookie,body:{kind:'pretest',answers:[0,1,2,3]}})).status,200);
  const accepted=await help(student);assert.equal(accepted.status,202);assert.equal(accepted.data.student.id,student.id);assert.ok(accepted.data.guidance.id);
  const final=await done(student,accepted.data.guidance.id);assert.equal(final.guidance.status,'succeeded');assert.equal(final.messages.filter(m=>m.role==='assistant').length,1);
});

test('模型并发上限为二，排队时仍可保存草稿，重复求助不会重复调用',async()=>{
  const {students}=await setup({conditions:Array(4).fill('responsive-hint')});
  const model='held-concurrency',gate=hold(model);for(const student of students)await selectModel(student,model);
  peak=0;const callStart=calls.length;
  try{
    const accepted=await Promise.all(students.map(student=>help(student)));
    assert.ok(accepted.every(r=>r.status===202));
    assert.equal(new Set(accepted.map(r=>r.data.guidance.id)).size,4);
    await until(()=>calls.slice(callStart).filter(c=>c.body.model===model).length===2,'未观察到两路并发模型请求');
    await delay(100);
    assert.equal(calls.slice(callStart).filter(c=>c.body.model===model).length,2);assert.equal(peak,2);
    assert.equal((await help(students[0])).status,409);
    const saved=await request('/student/draft',{cookie:students[3].cookie,body:{stage:0,data:{problem:'等待指导时继续记录自己的猜想'}}});assert.equal(saved.status,200);
    const heartbeat=await request('/student/heartbeat',{cookie:students[3].cookie,body:{}});assert.equal(heartbeat.status,200);assert.equal(heartbeat.data.guidance.id,accepted[3].data.guidance.id);assert.equal(heartbeat.data.guidance.status,'queued');
    gate.released.resolve();
    for(let i=0;i<students.length;i++){const final=await done(students[i],accepted[i].data.guidance.id);assert.equal(final.guidance.status,'succeeded');}
    assert.equal(calls.slice(callStart).filter(c=>c.body.model===model).length,4);assert.equal(peak,2);
    assert.equal((await state(students[3])).state.drafts[0].problem,'等待指导时继续记录自己的猜想');
  }finally{gate.released.resolve();gates.delete(model);}
});

test('自动指导不阻塞测试、心跳和阶段提交，旧阶段回复不进入下一阶段',async()=>{
  const {students:[student]}=await setup({conditions:['active-hint']});
  const first=await advance(student,0,hypothesis);assert.equal(first.status,200);
  if(first.data.guidance)await done(student,first.data.guidance.id);
  const model='held-stage-change',gate=hold(model);await selectModel(student,model);
  try{
    const tested=await trial(student);assert.equal(tested.status,200);assert.equal(tested.data.trials.length,1);
    const oldId=tested.data.guidance.id;assert.equal(tested.data.guidance.stage,1);
    await gate.entered.promise;
    const pulse=await request('/student/heartbeat',{cookie:student.cookie,body:{}});assert.equal(pulse.status,200);assert.equal(pulse.data.guidance.id,oldId);
    const advanced=await advance(student,1,{plan:'比较天气',evidence:'记录已保存'});assert.equal(advanced.status,200);assert.equal(advanced.data.stage,2);
    gate.released.resolve();
    await until(()=>run(oldId).status==='cancelled','阶段已变化但旧指导未取消');
    const current=await state(student);
    if(current.guidance&&!terminal.has(current.guidance.status))await done(student,current.guidance.id);
    const final=await state(student);assert.equal(final.messages.filter(m=>m.role==='assistant'&&m.stage===1&&m.model===model).length,0);
    if(final.guidance.id!==oldId)assert.ok(final.guidance.id>oldId);
  }finally{gate.released.resolve();gates.delete(model);}
});

test('进入独立后测时取消上一阶段仍在生成的指导',async()=>{
  const {students:[student]}=await setup({config:{assessmentEnabled:true}});
  assert.equal((await request('/student/assessment',{cookie:student.cookie,body:{kind:'pretest',answers:[0,1,2,3]}})).status,200);
  assert.equal((await advance(student,0,hypothesis)).status,200);
  assert.equal((await trial(student)).status,200);
  assert.equal((await advance(student,1,{plan:'一次保持其他条件相同',evidence:'记录供水结果'})).status,200);
  assert.equal((await trial(student)).status,200);
  assert.equal((await advance(student,2,{reason:'结合已有测试检查当前规则'})).status,200);
  assert.equal((await trial(student)).status,200);
  const model='held-before-posttest',gate=hold(model);await selectModel(student,model);
  try{
    const accepted=await help(student);assert.equal(accepted.status,202);const id=accepted.data.guidance.id;
    await gate.entered.promise;
    const advanced=await advance(student,3,{analysis:'比较证据是否支持原解释',limitation:'需要更多条件验证'});assert.equal(advanced.status,200);assert.equal(advanced.data.stage,4);assert.equal(advanced.data.canAsk,false);
    assert.equal((await help(student,'请帮我回答后测')).status,409);
    gate.released.resolve();
    const final=await done(student,id);assert.equal(final.guidance.status,'cancelled');assert.equal(final.messages.filter(m=>m.role==='assistant').length,0);
    assert.ok(run(id).finished_at);
  }finally{gate.released.resolve();gates.delete(model);}
});

test('模型失败记录状态且不回退，学生可以再次求助',async()=>{
  const {students:[student]}=await setup();await selectModel(student,'runtime-unavailable');
  const before=calls.length,accepted=await help(student);assert.equal(accepted.status,202);
  const failed=await done(student,accepted.data.guidance.id);assert.equal(failed.guidance.status,'failed');assert.ok(failed.guidance.error);assert.equal(failed.messages.filter(m=>m.role==='assistant').length,0);
  assert.equal(calls.length,before+1);assert.equal(calls.at(-1).body.model,'runtime-unavailable');assert.ok(!JSON.stringify(failed).includes('仅供测试的上游内部错误'));
  await selectModel(student,'runtime-recovered');
  const retry=await help(student);assert.equal(retry.status,202);assert.ok(retry.data.guidance.id>accepted.data.guidance.id);
  assert.equal((await done(student,retry.data.guidance.id)).guidance.status,'succeeded');assert.equal(calls.at(-1).body.model,'runtime-recovered');
});

test('输入预算有界，完整研究记录保留，实际 usage 与耗时落库',async()=>{
  const {students:[student]}=await setup({config:{initialRule:{threshold:2741,skipRain:false,minutes:11},referenceRule:{threshold:2897,skipRain:true,minutes:13}}});
  // 向独立测试库放入长历史，以检验发送预算而非删除研究数据来压缩上下文。
  database(db=>{
    const insert=db.prepare('INSERT INTO messages(student_id,stage,role,content,trigger,provider,model,model_source,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
    for(let i=0;i<40;i++)insert.run(student.id,0,i%2?'assistant':'user',`旧记录${i}：`+'重复实验观察。'.repeat(300),'help','openai','runtime-history','platform',new Date().toISOString());
  });
  await request('/student/draft',{cookie:student.cookie,body:{stage:0,data:{problem:'只检查天气的假设',reason:'依据原始A与B记录',variable:'weather'}}});
  const question='独特的本次问题：我怎样区分预报信息和实际降雨？';
  const accepted=await help(student,question);assert.equal(accepted.status,202);
  const final=await done(student,accepted.data.guidance.id);assert.equal(final.guidance.status,'succeeded');
  const saved=run(accepted.data.guidance.id);assert.ok(saved.context_chars>0&&saved.context_chars<=12000);assert.equal(saved.input_tokens,123);assert.equal(saved.output_tokens,45);assert.ok(saved.queue_ms>=0);assert.ok(saved.duration_ms>=0);assert.ok(saved.started_at&&saved.finished_at);assert.ok(saved.prompt_version);
  const sent=JSON.stringify(calls.at(-1).body.messages);assert.ok(sent.length<20000);assert.equal(sent.split(question).length-1,1);assert.ok(!sent.includes('2741'));assert.ok(!sent.includes('2897'));assert.ok(!sent.includes('重复实验观察。'.repeat(300*40)));
  const count=database(db=>db.prepare('SELECT COUNT(*) AS n FROM messages WHERE student_id=?').get(student.id).n);assert.equal(count,42);assert.equal(final.messages.length,42);
});

test('重启将运行中与排队任务置为失败，不自动重放有费用的模型请求',async()=>{
  const {students}=await setup({conditions:Array(3).fill('responsive-hint')});
  const model='held-restart',gate=hold(model);for(const student of students)await selectModel(student,model);
  try{
    const accepted=await Promise.all(students.map(student=>help(student)));assert.ok(accepted.every(r=>r.status===202));
    await until(()=>calls.filter(c=>c.body.model===model).length===2,'重启前未建立运行中任务');
    assert.ok(accepted.some(r=>run(r.data.guidance.id).status==='queued'));
    await stop();gate.released.resolve();await until(()=>active===0,'停止后 mock 请求未结束');
    const before=calls.length;await start();
    for(let i=0;i<students.length;i++){
      const current=await state(students[i]);assert.equal(current.guidance.id,accepted[i].data.guidance.id);assert.equal(current.guidance.status,'failed');assert.ok(current.guidance.error);assert.equal(current.messages.filter(m=>m.role==='assistant').length,0);
    }
    await delay(100);assert.equal(calls.length,before);
    await selectModel(students[0],'runtime-after-restart');const retried=await help(students[0]);assert.equal(retried.status,202);assert.equal((await done(students[0],retried.data.guidance.id)).guidance.status,'succeeded');
  }finally{gate.released.resolve();gates.delete(model);}
});

test('排队满时明确拒绝且不写入问题，超时排队任务释放后可再次求助',async()=>{
  await stop();queueLimit=1;queueWaitMs=400;await start();
  const {students}=await setup({conditions:Array(4).fill('responsive-hint')});
  const model='held-queue-budget',gate=hold(model);for(const student of students)await selectModel(student,model);
  try{
    const first=await help(students[0]),second=await help(students[1]);assert.equal(first.status,202);assert.equal(second.status,202);
    await until(()=>calls.filter(c=>c.body.model===model).length===2,'未占满两个执行槽位');
    const waiting=await help(students[2]);assert.equal(waiting.status,202);assert.equal(waiting.data.guidance.status,'queued');
    const rejected=await help(students[3]);assert.equal(rejected.status,429);assert.equal((await state(students[3])).messages.length,0);
    assert.equal(database(db=>db.prepare('SELECT COUNT(*) AS n FROM guidance_runs WHERE student_id=?').get(students[3].id).n),0);
    const expired=await done(students[2],waiting.data.guidance.id);assert.equal(expired.guidance.status,'failed');assert.ok(expired.guidance.error);assert.equal(calls.filter(c=>c.body.model===model).length,2);
    gate.released.resolve();await done(students[0],first.data.guidance.id);await done(students[1],second.data.guidance.id);
    await selectModel(students[2],'runtime-after-queue-timeout');const next=await help(students[2]);assert.equal(next.status,202);assert.equal((await done(students[2],next.data.guidance.id)).guidance.status,'succeeded');
  }finally{gate.released.resolve();gates.delete(model);queueLimit=8;queueWaitMs=5000;await stop();await start();}
});

test('同阶段测评与实验操作更新同步版本，旧阶段问题不消耗模型调用',async()=>{
  const {students:[student]}=await setup({config:{assessmentEnabled:true}});
  const first=await state(student);
  await request('/student/draft',{cookie:student.cookie,body:{stage:0,data:hypothesis}});
  assert.equal((await state(student)).revision,first.revision,'普通草稿保存不应引发全量重读');
  const assessed=await request('/student/assessment',{cookie:student.cookie,body:{kind:'pretest',answers:[0,1,2,3]}});
  assert.equal(assessed.status,200);assert.ok(assessed.data.revision>first.revision);
  const heartbeat=await request('/student/heartbeat',{cookie:student.cookie,body:{}});
  assert.equal(heartbeat.data.stage,0);assert.equal(heartbeat.data.revision,assessed.data.revision);
  const advanced=await advance(student,0,hypothesis);
  assert.ok(advanced.data.revision>assessed.data.revision);
  const before=calls.length;
  const stale=await request('/student/help',{cookie:student.cookie,body:{stage:0,question:'仍在旧页面上提交的问题'}});
  assert.equal(stale.status,409);assert.match(stale.data.error,/阶段已变化/);
  assert.equal(calls.length,before);assert.equal((await state(student)).messages.length,0);
  const accepted=await request('/student/help',{cookie:student.cookie,body:{stage:1,question:'请检查当前阶段的证据'}});
  assert.equal(accepted.status,202);await done(student,accepted.data.guidance.id);
});

test('慢指导期间跳过的自动介入可追溯，教师可导出实际运行记录',async()=>{
  const {id,students:[student]}=await setup({conditions:['active-hint'],config:{repeatCount:2}});
  const model='held-intervention-audit',gate=hold(model);await selectModel(student,model);
  try{
    const accepted=await advance(student,0,hypothesis);assert.equal(accepted.status,200);
    await gate.entered.promise;
    await trial(student,{prediction:'wait'});await trial(student,{prediction:'wait'});
    const skipped=database(db=>db.prepare("SELECT data FROM events WHERE student_id=? AND type='guidance_skipped'").all(student.id).map(row=>JSON.parse(row.data)));
    assert.equal(skipped.length,2);assert.equal(skipped.at(-1).trigger,'repeat');
    assert.ok(skipped.every(row=>row.activeRunId===accepted.data.guidance.id&&row.reason.includes('尚未完成')));
    assert.equal(calls.filter(call=>call.body.model===model).length,1,'不增加改变介入剂量的隐藏模型调用');
    gate.released.resolve();await done(student,accepted.data.guidance.id);
    const exported=await request(`/admin/export?experiment=${id}&type=guidance_runs`,{cookie:admin});
    assert.equal(exported.status,200);assert.match(exported.data,/input_tokens/);assert.match(exported.data,/succeeded/);assert.match(exported.data,/123/);
    assert.ok(!exported.data.includes('test-only-personal-runtime-key'));
  }finally{gate.released.resolve();gates.delete(model);}
});
