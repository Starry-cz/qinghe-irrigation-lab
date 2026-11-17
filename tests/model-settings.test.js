import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_CONFIG } from '../shared/definitions.js';
import { settleGuidance } from './helpers/guidance.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const dir=mkdtempSync(join(tmpdir(),'qinghe-model-settings-'));
const dbPath=join(dir,'lab.db'),keyPath=join(dir,'model-secrets.key');
const base='http://127.0.0.1:43185/api',upstream='http://127.0.0.1:43186';
const platformKey='test-only-platform-key',platformModel='platform-mock';
const credentials={role:'teacher',username:'models-admin',password:'Models-admin-test-2026'};
const calls=[],gates=new Map(),logs=[];
let server,admin;

// 使用本地OpenAI兼容服务记录真实HTTP请求，测试不调用任何租用模型。
const mock=createServer(async(req,res)=>{
  let text='';for await(const chunk of req)text+=chunk;
  const body=JSON.parse(text),call={path:req.url,authorization:req.headers.authorization,body};
  calls.push(call);
  const gate=gates.get(body.model);
  if(gate){gate.entered.resolve();await gate.released.promise;}
  res.setHeader('Content-Type','application/json');
  if(body.model==='unavailable-model'){
    res.writeHead(503);res.end(JSON.stringify({error:{message:'上游内部信息 '+req.headers.authorization}}));return;
  }
  res.end(JSON.stringify({choices:[{message:{content:`模型 ${body.model} 的测试指导。`}}]}));
});
async function request(path,{body,method=body?'POST':'GET',cookie}={}) {
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  const text=await response.text();
  return {status:response.status,data:response.headers.get('content-type')?.includes('json')?JSON.parse(text):text,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function start(){
  server=spawn(process.execPath,['backend/src/index.js'],{cwd:root,env:{...process.env,DB_PATH:dbPath,PORT:'43185',HOST:'127.0.0.1',TEACHER_USERNAME:credentials.username,TEACHER_PASSWORD:credentials.password,
    NODE_ENV:'test',ALLOW_LOCAL_MODEL_ENDPOINTS:'true',AI_PROVIDER:'openai',AI_BASE_URL:upstream+'/platform/v1',AI_MODEL:platformModel,AI_API_KEY:platformKey,AI_THINKING:''},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',d=>logs.push(d.toString()));server.stderr.on('data',d=>logs.push(d.toString()));
  for(let i=0;i<70;i++){try{if((await request('/health')).status===200)return;}catch{}await delay(100);}
  assert.fail('模型设置测试后端未启动：'+logs.join(''));
}
async function stop(){if(server.exitCode!==null)return;const exited=new Promise(resolve=>server.once('exit',resolve));server.kill();await exited;}
function readDatabase(fn){const db=new DatabaseSync(dbPath);try{return fn(db);}finally{db.close();}}
function settings(cookie){return request('/model-settings',{cookie});}
function save(cookie,body){return request('/model-settings',{cookie,method:'PUT',body});}
function custom(model,apiKey,path='personal'){return {mode:'custom',baseUrl:`${upstream}/${path}/v1`,model,thinking:'disabled',...(apiKey?{apiKey}:{})};}
async function experiment(conditions=['responsive-hint']){
  const created=await request('/admin/experiments',{cookie:admin,body:{title:'模型设置HTTP验证'}});assert.equal(created.status,201);const id=created.data.id;
  const configured=await request(`/admin/experiments/${id}`,{cookie:admin,method:'PUT',body:{status:'open',config:{...DEFAULT_CONFIG,assessmentEnabled:false,allowHelpBeforeHypothesis:true,cooldownSeconds:0,idleSeconds:10}}});assert.equal(configured.status,200);
  const enrolled=await request('/admin/students',{cookie:admin,body:{experimentId:id,students:conditions.map((condition,i)=>({name:`模型学生${i}`,studentNo:`${id}-${i}`,className:'模型验证班',condition}))}});assert.equal(enrolled.status,201);
  const students=[];
  for(const student of enrolled.data.students){const login=await request('/login',{body:{role:'student',name:student.name,studentNo:student.studentNo}});assert.equal(login.status,200);students.push({...student,cookie:login.cookie});}
  return {id,students};
}
async function teacher(username){
  const body={name:'模型配置教师',username,password:'Teacher-model-test-2026'};
  const created=await request('/admin/users/teachers',{cookie:admin,body});assert.equal(created.status,201);
  const login=await request('/login',{body:{role:'teacher',...body}});assert.equal(login.status,200);return {cookie:login.cookie,id:login.data.user.id};
}
async function help(student,expectedStatus='succeeded'){
  const accepted=await request('/student/help',{cookie:student.cookie,body:{question:'我应该怎样比较实验中的证据？'}});
  assert.equal(accepted.status,202,JSON.stringify(accepted.data));
  return settleGuidance(request,accepted,student.cookie,expectedStatus);
}
function lastAssistant(data){return data.messages.filter(message=>message.role==='assistant').at(-1);}
function assertModel(message,model,source){assert.equal(message.model,model);assert.equal(message.model_source,source);assert.equal(message.provider,'openai');}
before(async()=>{await new Promise(resolve=>mock.listen(43186,'127.0.0.1',resolve));await start();const login=await request('/login',{body:credentials});assert.equal(login.status,200);admin=login.cookie;});
after(async()=>{for(const gate of gates.values())gate.released.resolve();await stop();await new Promise(resolve=>mock.close(resolve));/* 只删除本套测试新建的临时目录。 */rmSync(dir,{recursive:true,force:true});});

test('个人配置隔离，连接测试不保存，密钥仅加密存储且不会回显',async()=>{
  assert.equal((await settings()).status,401);
  const pending={role:'student',name:'待审核模型学生',studentNo:'models-pending',className:'测试班'};
  const registered=await request('/register',{body:pending});assert.equal(registered.status,201);assert.equal(registered.cookie,undefined);assert.equal((await request('/login',{body:pending})).status,403);
  const {id,students:[alice,bob]}=await experiment(['responsive-hint','responsive-hint']);
  assert.equal((await request(`/admin/experiments/${id}/model`,{cookie:alice.cookie})).status,401);
  assert.equal((await request(`/admin/experiments/${id}/model`,{cookie:alice.cookie,method:'PUT',body:{source:'platform'}})).status,401);
  const initial=(await settings(alice.cookie)).data;assert.equal(initial.mode,'default');assert.equal(initial.custom,null);assert.equal(initial.effective.source,'platform');assert.equal(initial.effective.model,platformModel);
  const secret='test-alice-private-key',draftSecret='test-unsaved-private-key';
  const saved=await save(alice.cookie,custom('alice-model',secret,'alice'));assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.custom.hasKey,true);assert.equal(saved.data.effective.source,'personal');
  assert.ok(!JSON.stringify(saved.data).includes(secret));assert.equal(saved.data.custom.apiKey,undefined);
  assert.equal((await settings(bob.cookie)).data.custom,null);assert.equal((await settings(admin)).data.custom,null);
  const before=await settings(alice.cookie);
  const tested=await request('/model-settings/test',{cookie:alice.cookie,body:custom('draft-model',draftSecret,'draft')});assert.equal(tested.status,200);assert.equal(tested.data.ok,true);assert.equal(tested.data.model,'draft-model');
  assert.equal(calls.at(-1).authorization,`Bearer ${draftSecret}`);assert.equal(calls.at(-1).path,'/draft/v1/chat/completions');
  assert.deepEqual((await settings(alice.cookie)).data,before.data);assert.equal((await request('/student/state',{cookie:alice.cookie})).data.messages.length,0);
  // 地址变化必须显式提供新密钥，不能把已保存密钥发送给另一个服务商。
  assert.equal((await save(alice.cookie,custom('other-model',null,'other-provider'))).status,400);
  assert.equal((await request('/model-settings/test',{cookie:alice.cookie,body:custom('other-model',null,'other-provider')})).status,400);
  assert.equal((await save(alice.cookie,{...custom('bad-url',secret),'baseUrl':'http://example.com/v1'})).status,400);
  const reused=await save(alice.cookie,custom('alice-updated',null,'alice'));assert.equal(reused.status,200);
  const disabled=await save(alice.cookie,{mode:'default'});assert.equal(disabled.status,200);assert.equal(disabled.data.effective.model,platformModel);assert.equal(disabled.data.custom.model,'alice-updated');
  assert.equal((await save(alice.cookie,custom('alice-updated',null,'alice'))).status,200);
  assert.ok(existsSync(keyPath));
  readDatabase(db=>{
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    const all=JSON.stringify(tables.map(table=>db.prepare(`SELECT * FROM "${table.name}"`).all()));
    for(const key of [secret,draftSecret,platformKey])assert.ok(!all.includes(key),'数据库不得保存明文模型密钥');
  });
  const users=await request('/admin/users',{cookie:admin}),exported=await request(`/admin/export?experiment=${id}&type=all`,{cookie:admin});
  for(const data of [users.data,exported.data]){assert.ok(!JSON.stringify(data).includes(secret));assert.ok(!JSON.stringify(data).includes(draftSecret));}
});

test('学生个人模型优先于实验默认，教师发布后独立保存，自动指导同样遵循选择',async()=>{
  const owner=await teacher('model-owner');
  const {id,students:[personal,shared]}=await experiment(['active-hint','responsive-hint']);
  const teacherKey='test-teacher-published-key',personalKey='test-student-priority-key';
  assert.equal((await save(owner.cookie,custom('teacher-published',teacherKey,'teacher'))).status,200);
  assert.equal((await settings(admin)).data.custom,null);
  assert.equal((await save(owner.cookie,{mode:'default'})).data.custom.model,'teacher-published');
  const published=await request(`/admin/experiments/${id}/model`,{cookie:owner.cookie,method:'PUT',body:{source:'personal'}});assert.equal(published.status,200);assert.equal(published.data.source,'teacher');assert.equal(published.data.settings.model,'teacher-published');assert.ok(!JSON.stringify(published.data).includes(teacherKey));
  assert.equal((await settings(shared.cookie)).data.default.source,'experiment');assert.equal((await settings(shared.cookie)).data.effective.model,'teacher-published');
  assert.equal((await save(personal.cookie,custom('student-preferred',personalKey,'student'))).status,200);
  assert.equal((await save(owner.cookie,custom('teacher-changed',null,'teacher'))).status,200);
  assert.equal((await request('/model-settings',{cookie:owner.cookie,method:'DELETE'})).status,200);
  assert.equal((await request(`/admin/experiments/${id}/model`,{cookie:owner.cookie})).data.settings.model,'teacher-published');
  const manual=await help(shared);assert.equal(manual.status,202);assertModel(lastAssistant(manual.data),'teacher-published','experiment');assert.equal(calls.at(-1).authorization,`Bearer ${teacherKey}`);
  const advanced=await settleGuidance(request,await request('/student/advance',{cookie:personal.cookie,body:{stage:0,data:{problem:'比较不同天气的决策',variable:'weather',reason:'保持其他条件一致'}}}),personal.cookie);assert.equal(advanced.status,200);assertModel(lastAssistant(advanced.data),'student-preferred','personal');assert.equal(calls.at(-1).authorization,`Bearer ${personalKey}`);
  const manualPersonal=await help(personal);assert.equal(manualPersonal.status,202);assertModel(lastAssistant(manualPersonal.data),'student-preferred','personal');
  // 等待真实停滞时间，验证自动心跳和手动求助使用同一份模型选择。
  await delay(10100);
  const heartbeat=await settleGuidance(request,await request('/student/heartbeat',{cookie:personal.cookie,body:{}}),personal.cookie);assert.equal(heartbeat.status,200);assert.equal(lastAssistant(heartbeat.data).trigger,'idle');assertModel(lastAssistant(heartbeat.data),'student-preferred','personal');
  const deleted=await request('/model-settings',{cookie:personal.cookie,method:'DELETE'});assert.equal(deleted.status,200);assert.equal(deleted.data.custom,null);assert.equal(deleted.data.effective.source,'experiment');assert.equal(deleted.data.effective.model,'teacher-published');
  const inherited=await help(personal);assert.equal(inherited.status,202);assertModel(lastAssistant(inherited.data),'teacher-published','experiment');
  const {students:[platformStudent]}=await experiment();const platformAnswer=await help(platformStudent);assert.equal(platformAnswer.status,202);assertModel(lastAssistant(platformAnswer.data),platformModel,'platform');assert.equal(calls.at(-1).authorization,`Bearer ${platformKey}`);
  const archive=await request(`/admin/export?experiment=${id}&type=all`,{cookie:admin});assert.equal(archive.status,200);
  const records=archive.data.records.flatMap(record=>record.messages);assert.ok(records.some(message=>message.model==='student-preferred'&&message.model_source==='personal'));assert.ok(records.some(message=>message.model==='teacher-published'&&message.model_source==='experiment'));
  const csv=await request(`/admin/export?experiment=${id}&type=messages`,{cookie:admin});assert.equal(csv.status,200);assert.ok(csv.data.includes('model_source'));assert.ok(csv.data.includes('student-preferred'));
  for(const key of [teacherKey,personalKey])assert.ok(!JSON.stringify(archive.data).includes(key));
});

test('模型调用失败明确返回错误，不改用实验或平台模型',async()=>{
  const {id,students:[student]}=await experiment();const secret='test-upstream-failure-key';
  assert.equal((await save(student.cookie,custom('unavailable-model',secret,'failure'))).status,200);
  const before=calls.length,failed=await help(student,'failed');assert.equal(failed.status,202);assert.equal(failed.data.guidance.status,'failed');assert.equal(typeof failed.data.guidance.error,'string');assert.ok(failed.data.guidance.error.length>0);assert.equal(calls.length,before+1);assert.equal(calls.at(-1).body.model,'unavailable-model');
  assert.ok(!JSON.stringify(failed.data).includes(secret));assert.ok(!JSON.stringify(failed.data).includes('上游内部信息'));
  const state=await request('/student/state',{cookie:student.cookie});assert.equal(state.data.messages.filter(message=>message.role==='assistant').length,0);
  const archive=await request(`/admin/export?experiment=${id}&type=all`,{cookie:admin});assert.ok(!JSON.stringify(archive.data).includes(secret));
  const events=archive.data.records[0].events;assert.ok(events.some(event=>event.type==='guidance_error'));assert.ok(events.some(event=>event.type==='model_request'&&event.data.model==='unavailable-model'&&event.data.source==='personal'));
});

test('请求发出后切换个人模型，已在生成的消息仍保存原模型与来源',async()=>{
  const {id,students:[student]}=await experiment();const secret='test-in-flight-key';
  await save(student.cookie,custom('held-model',secret,'flight'));
  const gate={entered:Promise.withResolvers(),released:Promise.withResolvers()};gates.set('held-model',gate);
  const pending=help(student);
  try{
    await Promise.race([gate.entered.promise,delay(5000).then(()=>assert.fail('未收到延迟模型请求'))]);
    const changed=await save(student.cookie,custom('next-model',null,'flight'));assert.equal(changed.status,200);assert.equal(changed.data.effective.model,'next-model');
  }finally{gate.released.resolve();}
  const first=await pending;assert.equal(first.status,202);assertModel(lastAssistant(first.data),'held-model','personal');
  const next=await help(student);assert.equal(next.status,202);assertModel(lastAssistant(next.data),'next-model','personal');
  const archive=await request(`/admin/export?experiment=${id}&type=all`,{cookie:admin});
  const generated=archive.data.records[0].events.filter(event=>event.type==='guidance');assert.deepEqual(generated.map(event=>event.data.model),['held-model','next-model']);assert.ok(generated.every(event=>event.data.source==='personal'));
});

test('重启后个人密钥可解密，实验独立配置仍能指导学生',async()=>{
  const owner=await teacher('restart-model-owner');
  const {id,students:[personal,shared]}=await experiment(['responsive-hint','responsive-hint']);
  const personalKey='test-restart-personal-key',sharedKey='test-restart-shared-key';
  await save(owner.cookie,custom('restart-shared',sharedKey,'restart-shared'));
  assert.equal((await request(`/admin/experiments/${id}/model`,{cookie:owner.cookie,method:'PUT',body:{source:'personal'}})).status,200);
  await save(personal.cookie,custom('restart-personal',personalKey,'restart-personal'));
  const encryptionKey=readFileSync(keyPath);
  await stop();await start();
  assert.deepEqual(readFileSync(keyPath),encryptionKey);
  const personalAnswer=await help(personal);assert.equal(personalAnswer.status,202);assertModel(lastAssistant(personalAnswer.data),'restart-personal','personal');assert.equal(calls.at(-1).authorization,`Bearer ${personalKey}`);
  const sharedAnswer=await help(shared);assert.equal(sharedAnswer.status,202);assertModel(lastAssistant(sharedAnswer.data),'restart-shared','experiment');assert.equal(calls.at(-1).authorization,`Bearer ${sharedKey}`);
  assert.equal((await settings(personal.cookie)).data.custom.hasKey,true);assert.equal((await request(`/admin/experiments/${id}/model`,{cookie:owner.cookie})).data.source,'teacher');
  // 模拟备份遗漏主密钥：不能生成新主密钥，导致此前保存的其他账号配置全部失效。
  const stored=readDatabase(db=>({personal:db.prepare('SELECT * FROM personal_model_settings').all(),experiments:db.prepare('SELECT * FROM experiment_model_settings').all()}));
  unlinkSync(keyPath);
  try{
    const missingKey=await save(personal.cookie,custom('must-not-save','test-replacement-private-key','restart-personal'));assert.equal(missingKey.status,503);assert.equal(existsSync(keyPath),false);
    const unchanged=readDatabase(db=>({personal:db.prepare('SELECT * FROM personal_model_settings').all(),experiments:db.prepare('SELECT * FROM experiment_model_settings').all()}));assert.deepEqual(unchanged,stored);
  }finally{writeFileSync(keyPath,encryptionKey,{mode:0o600});}
  const restored=await help(personal);assert.equal(restored.status,202);assertModel(lastAssistant(restored.data),'restart-personal','personal');assert.equal(calls.at(-1).authorization,`Bearer ${personalKey}`);
});
