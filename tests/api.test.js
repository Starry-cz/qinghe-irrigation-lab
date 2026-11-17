import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { DEFAULT_CONFIG, CONDITIONS } from '../shared/definitions.js';
import { DatabaseSync } from 'node:sqlite';
import { settleGuidance } from './helpers/guidance.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const dir=mkdtempSync(join(tmpdir(),'qinghe-test-'));
const base='http://127.0.0.1:43181/api';
let server,teacher;
const logs=[];
async function request(path,{body,method=body?'POST':'GET',cookie}={}) {
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const text=await response.text();
  return {status:response.status,data:response.headers.get('content-type')?.includes('json')?JSON.parse(text):text,
    cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function login(role,credentials){const body=role==='teacher'?{role,username:'teacher-test',password:credentials}:{role,name:credentials.name,studentNo:credentials.studentNo,experimentId:credentials.experimentId};const r=await request('/login',{body});assert.equal(r.status,200,JSON.stringify(r.data));return r.cookie;}
async function setupExperiment(config={}) {
  const created=await request('/admin/experiments',{cookie:teacher,body:{title:'自动化验证'}});
  const id=created.data.id;
  await request(`/admin/experiments/${id}`,{method:'PUT',cookie:teacher,body:{status:'open',config:{...DEFAULT_CONFIG,assessmentEnabled:false,cooldownSeconds:0,...config}}});
  const roster=await request('/admin/students',{cookie:teacher,body:{experimentId:id,students:Object.keys(CONDITIONS).map((condition,i)=>({name:`学生${i}`,studentNo:`${id}-${i}`,className:'测试班',condition}))}});
  assert.equal(roster.status,201);
  return {id,students:roster.data.students};
}
before(async()=>{
  // 在独立临时数据库启动真实后端，测试不会污染演示或研究数据。
  server=spawn(process.execPath,['backend/src/index.js'],{cwd:root,env:{...process.env,DB_PATH:join(dir,'lab.db'),PORT:'43181',TEACHER_USERNAME:'teacher-test',TEACHER_PASSWORD:'teacher-for-tests',AI_PROVIDER:'scripted',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',d=>logs.push(d.toString()));server.stderr.on('data',d=>logs.push(d.toString()));
  for(let i=0;i<50;i++){try{if((await request('/health')).status===200)break;}catch{} await delay(100);}
  assert.equal((await request('/health')).status,200,logs.join(''));
  teacher=await login('teacher','teacher-for-tests');
});
after(async()=>{
  server.kill();await new Promise(resolve=>server.once('exit',resolve));
  // 删除的目标是本测试刚创建的临时目录，不涉及项目和用户数据。
  rmSync(dir,{recursive:true,force:true});
});

test('身份隔离、实验快照与四种指导条件',async()=>{
  assert.equal((await request('/admin/overview')).status,401);
  assert.equal((await request('/login',{body:{role:'teacher',username:'teacher-test',password:'incorrect'}})).status,401);
  const {id,students}=await setupExperiment();
  const sessions=[];
  for(const s of students){
    const cookie=await login('student',s);sessions.push(cookie);
    assert.equal((await request('/admin/overview',{cookie})).status,401);
    let state=(await request('/student/state',{cookie})).data;
    assert.equal(state.stage,0);assert.equal(state.state.rule,null);assert.equal(state.config.initialRule,undefined);assert.equal(state.config.referenceRule,undefined);
    assert.equal((await request('/student/help',{cookie,body:{question:'请告诉我答案'}})).status,409);
    assert.equal((await request('/student/rule',{cookie,body:DEFAULT_CONFIG.referenceRule})).status,409);
    assert.equal((await request('/student/advance',{cookie,body:{stage:2,data:{reason:'跳步'}}})).status,409);
    const advanced=await request('/student/advance',{cookie,body:{stage:0,data:{problem:'有雨还灌溉是否合理',variable:'weather',reason:'B记录值得进一步检查'}}});
    assert.equal(advanced.status,200);
    state=CONDITIONS[s.condition].active?(await settleGuidance(request,advanced,cookie)).data:advanced.data;
    assert.equal(state.messages.length,CONDITIONS[s.condition].active?1:0);
    const helped=await settleGuidance(request,await request('/student/help',{cookie,body:{question:'天气预报与实际降雨有什么关系？'}}),cookie);
    assert.equal(helped.status,202);
    const content=helped.data.messages.at(-1).content;
    assert.ok(CONDITIONS[s.condition].detailed?content.length>100:content.length<100);
    assert.equal(helped.data.messages.at(-1).provider,'scripted');
  }
  const locked=await request(`/admin/students/${students[0].id}`,{method:'PATCH',cookie:teacher,body:{condition:'responsive-hint'}});
  assert.equal(locked.status,409);
  await request(`/admin/experiments/${id}`,{method:'PUT',cookie:teacher,body:{status:'paused',config:{...DEFAULT_CONFIG,assessmentEnabled:false,idleSeconds:300}}});
  const snapshot=(await request('/student/state',{cookie:sessions[0]})).data;
  assert.equal(snapshot.config.idleSeconds,120);assert.equal(snapshot.status,'paused');
  assert.equal((await request('/student/draft',{cookie:sessions[0],body:{stage:1,data:{plan:'测试'}}})).status,409);
});

test('学生从前测到报告的完整闭环、刷新恢复和数据导出',async()=>{
  const {id,students}=await setupExperiment({assessmentEnabled:true});
  const cookie=await login('student',students[2]);
  const draft={problem:'我想检查天气因素',variable:'weather',reason:'B的天气与A不同'};
  assert.equal((await request('/student/advance',{cookie,body:{stage:0,data:draft}})).status,400);
  const pre=await request('/student/assessment',{cookie,body:{kind:'pretest',answers:[0,1,2,3]}});
  assert.equal(pre.status,200);assert.equal(pre.data.submissions[0].data.score,undefined);
  await request('/student/draft',{cookie,body:{stage:0,data:draft}});
  assert.deepEqual((await request('/student/state',{cookie})).data.state.drafts[0],draft);
  const result=await request('/student/advance',{cookie,body:{stage:0,data:draft}});assert.equal(result.data.stage,1);
  const input={moisture:1800,weather:'sunny',actualRain:false,sensorConnected:true,pumpConnected:true,prediction:'irrigate',question:'测试天气变量'};
  assert.equal((await request('/student/trial',{cookie,body:{...input,moisture:-1}})).status,400);
  const a=await request('/student/trial',{cookie,body:input});assert.equal(a.status,200);assert.equal(a.data.trials[0].data.rule,undefined);
  assert.equal(a.data.messages.length,0);
  await request('/student/trial',{cookie,body:{...input,weather:'rainy'}});
  let current=await request('/student/advance',{cookie,body:{stage:1,data:{plan:'保持湿度比较天气',evidence:'两次都灌溉'}}});assert.equal(current.data.stage,2);
  assert.ok(current.data.state.rule);
  current=await request('/student/rule',{cookie,body:DEFAULT_CONFIG.referenceRule});assert.equal(current.status,200);
  current=await request('/student/trial',{cookie,body:{...input,weather:'rainy',prediction:'wait'}});assert.equal(current.data.trials.at(-1).data.decision,false);
  // 测试过旧规则后再修改，必须重新测试；恢复已测试规则可以继续。
  await request('/student/rule',{cookie,body:{...DEFAULT_CONFIG.referenceRule,threshold:2700}});
  assert.equal((await request('/student/advance',{cookie,body:{stage:2,data:{reason:'再次调整阈值'}}})).status,400);
  await request('/student/rule',{cookie,body:DEFAULT_CONFIG.referenceRule});
  current=await request('/student/advance',{cookie,body:{stage:2,data:{reason:'引入天气判断'}}});assert.equal(current.data.stage,3);
  await request('/student/trial',{cookie,body:input});await request('/student/trial',{cookie,body:input});
  const analysis={analysis:'比较不同情境',limitation:'还需要不同植物验证'};
  assert.equal((await request('/student/advance',{cookie,body:{stage:3,data:analysis}})).status,400);
  await request('/student/trial',{cookie,body:{...input,moisture:3200,weather:'rainy'}});
  current=await request('/student/advance',{cookie,body:{stage:3,data:analysis}});assert.equal(current.data.stage,4);
  assert.equal(current.data.canAsk,false);
  assert.equal((await request('/student/help',{cookie,body:{question:'帮我回答后测'}})).status,409);
  await request('/student/assessment',{cookie,body:{kind:'posttest',answers:[0,1,2,3]}});
  current=await request('/student/advance',{cookie,body:{stage:4,data:{conclusion:'证据支持考虑天气',transfer:'更换植物后重新确定适用条件'}}});assert.equal(current.data.completed,true);
  assert.equal((await request('/student/trial',{cookie,body:input})).status,409);
  const relogged=await login('student',students[2]);assert.equal((await request('/student/state',{cookie:relogged})).data.completed,true);
  const archive=await request(`/admin/export?experiment=${id}&type=all`,{cookie:teacher});assert.equal(archive.status,200);
  const record=archive.data.records.find(r=>r.student.id===students[2].id);
  assert.equal(record.trials.length,6);assert.equal(record.submissions.length,7);assert.ok(record.events.some(e=>e.type==='rule_changed'));
  assert.equal(record.student.code,undefined);assert.equal(record.progress.config_snapshot.initialRule.threshold,2800);
  const csv=await request(`/admin/export?experiment=${id}&type=summary`,{cookie:teacher});assert.equal(csv.status,200);assert.ok(csv.data.includes('condition'));
  const detail=await request(`/admin/students/${students[2].id}`,{cookie:teacher});assert.equal(detail.data.submissions[0].data.score,4);
});

test('主动停滞提示只出现一次，响应组保持静默',async()=>{
  const {students}=await setupExperiment({idleSeconds:10});
  const cookies=[];
  for(const s of [students[0],students[2]]){
    const cookie=await login('student',s);cookies.push(cookie);
    await request('/student/advance',{cookie,body:{stage:0,data:{problem:'问题',variable:'unsure',reason:'需要测试'}}});
  }
  await delay(10500);
  const active=await settleGuidance(request,await request('/student/heartbeat',{cookie:cookies[0],body:{}}),cookies[0]);
  assert.equal(active.data.messages.filter(m=>m.trigger==='idle').length,1);
  const again=await request('/student/heartbeat',{cookie:cookies[0],body:{}});
  assert.equal(again.data.messages.filter(m=>m.trigger==='idle').length,1);
  const responsive=await request('/student/heartbeat',{cookie:cookies[1],body:{}});
  assert.equal(responsive.data.messages.length,0);
});

test('130名学生并发登录和独立保存，记录不会串号',async()=>{
  const exp=await request('/admin/experiments',{cookie:teacher,body:{title:'130人并发验证'}});
  const id=exp.data.id;
  const roster=await request('/admin/students',{cookie:teacher,body:{experimentId:id,students:Array.from({length:130},(_,i)=>({name:`并发${i}`,studentNo:`concurrent-${i}`,className:`班${i%3}`,condition:'responsive-hint'}))}});
  assert.equal(roster.status,201);
  const start=Date.now();
  await Promise.all(roster.data.students.map(async(s,i)=>{
    const cookie=await login('student',s);
    const result=await request('/student/draft',{cookie,body:{stage:0,data:{problem:`独立记录${i}`}}});
    assert.equal(result.status,200);
    const state=(await request('/student/state',{cookie})).data;
    assert.equal(state.student.id,s.id);assert.equal(state.state.drafts[0].problem,`独立记录${i}`);
  }));
  console.log(`130人登录＋保存＋读取：${Date.now()-start}ms（本机，未调用模型）`);
  const overview=await request(`/admin/overview?experiment=${id}`,{cookie:teacher});
  assert.equal(overview.data.students.filter(s=>s.stage===0).length,130);
});

test('后端进程重启后，账号会话、草稿和配置仍保留',async()=>{
  const {students}=await setupExperiment();
  const cookie=await login('student',students[1]);
  await request('/student/draft',{cookie,body:{stage:0,data:{problem:'重启后保留的原始内容'}}});
  const exited=new Promise(resolve=>server.once('exit',resolve));server.kill();await exited;
  server=spawn(process.execPath,['backend/src/index.js'],{cwd:root,env:{...process.env,DB_PATH:join(dir,'lab.db'),PORT:'43181',TEACHER_USERNAME:'teacher-test',TEACHER_PASSWORD:'teacher-for-tests',AI_PROVIDER:'scripted',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',d=>logs.push(d.toString()));server.stderr.on('data',d=>logs.push(d.toString()));
  for(let i=0;i<50;i++){try{if((await request('/health')).status===200)break;}catch{}await delay(100);}
  const state=await request('/student/state',{cookie});
  assert.equal(state.status,200);assert.equal(state.data.state.drafts[0].problem,'重启后保留的原始内容');
  assert.equal(state.data.config.sensorMax,4095);
});

test('姓名和学号匹配、前导零、多轮实验与资料修正',async()=>{
  const {id,students}=await setupExperiment();
  const profile={name:'学号验证学生',studentNo:'000123',className:'资料验证班',condition:'responsive-hint'};
  const add=await request('/admin/students',{cookie:teacher,body:{experimentId:id,students:[profile]}});
  assert.equal(add.status,201);
  const student=add.data.students[0];
  assert.equal((await request('/login',{body:{role:'student',name:'错误姓名',studentNo:'000123'}})).status,401);
  assert.equal((await request('/login',{body:{role:'student',name:profile.name,studentNo:'123'}})).status,401);
  const cookie=await login('student',student);
  assert.equal((await request('/student/state',{cookie})).data.student.studentNo,'000123');
  await request('/student/draft',{cookie,body:{stage:0,data:{problem:'跨轮资料修改保留此记录'}}});
  const second=(await request('/admin/experiments',{cookie:teacher,body:{title:'第二轮身份验证'}})).data;
  const again=await request('/admin/students',{cookie:teacher,body:{experimentId:second.id,students:[profile]}});
  assert.equal(again.status,201);assert.equal(again.data.students[0].userId,student.userId);
  const select=await request('/login',{body:{role:'student',name:profile.name,studentNo:'000123'}});
  assert.equal(select.data.selectExperiment,true);assert.equal(select.data.experiments.length,2);assert.equal(select.cookie,undefined);
  assert.equal((await request('/login',{body:{role:'student',name:profile.name,studentNo:'000123',experimentId:'other'}})).status,403);
  const first=await login('student',{...student,experimentId:id});
  assert.equal((await request('/student/state',{cookie:first})).data.state.drafts[0].problem,'跨轮资料修改保留此记录');
  const updated=await request('/admin/students/'+student.id,{cookie:teacher,method:'PATCH',body:{name:'修正后姓名',studentNo:'000124',className:'修正班'}});
  assert.equal(updated.status,200);
  const relogged=await login('student',{name:'修正后姓名',studentNo:'000124',experimentId:id});
  assert.equal((await request('/student/state',{cookie:relogged})).data.state.drafts[0].problem,'跨轮资料修改保留此记录');
  const all=(await request('/admin/users',{cookie:teacher})).data.users;
  const saved=all.find(u=>u.id===student.userId);assert.equal(saved.name,'修正后姓名');assert.equal(saved.student_no,'000124');assert.ok(saved.last_login_at);
  const duplicate=await request('/admin/students',{cookie:teacher,body:{experimentId:id,students:[{...profile,name:'修正后姓名',studentNo:'000124'}]}});
  assert.equal(duplicate.status,409);
  // 批量导入失败时整体回滚，不留下只保存了一半的名单。
  const batch=await request('/admin/students',{cookie:teacher,body:{experimentId:id,students:[{...profile,studentNo:'rollback-new'},{...profile,studentNo:students[0].studentNo}]}});
  assert.equal(batch.status,409);
  assert.ok(!(await request('/admin/users',{cookie:teacher})).data.users.some(u=>u.student_no==='rollback-new'));
});

test('教师账号资料持久化、bcrypt密码与修改密码',async()=>{
  const created=await request('/admin/users/teachers',{cookie:teacher,body:{name:'验证教师',username:'teacher-two',password:'Initial-password-2026'}});
  assert.equal(created.status,201);assert.equal(created.data.password_hash,undefined);
  const body={role:'teacher',username:'teacher-two',password:'Initial-password-2026'};
  const first=await request('/login',{body}),second=await request('/login',{body});
  assert.equal(first.status,200);assert.equal(first.data.user.id,created.data.id);
  const wrong=await request('/admin/account',{cookie:first.cookie,method:'PATCH',body:{name:'改名教师',currentPassword:'wrong',newPassword:'Changed-password-2026'}});
  assert.equal(wrong.status,400);
  const changed=await request('/admin/account',{cookie:first.cookie,method:'PATCH',body:{name:'改名教师',currentPassword:body.password,newPassword:'Changed-password-2026'}});
  assert.equal(changed.status,200);assert.equal(changed.data.name,'改名教师');
  assert.equal((await request('/admin/users',{cookie:second.cookie})).status,401);
  assert.equal((await request('/login',{body})).status,401);
  assert.equal((await request('/login',{body:{...body,password:'Changed-password-2026'}})).status,200);
  const raw=new DatabaseSync(join(dir,'lab.db'));
  const row=raw.prepare('SELECT * FROM users WHERE id=?').get(created.data.id);raw.close();
  assert.match(row.password_hash,/^\$2[aby]\$/);assert.notEqual(row.password_hash,'Changed-password-2026');
  const output=(await request('/admin/users',{cookie:teacher})).data;
  assert.ok(!JSON.stringify(output).includes('password_hash'));assert.ok(!JSON.stringify(output).includes('Changed-password'));
});
