import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_CONFIG, CONDITIONS } from '../shared/definitions.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const dir=mkdtempSync(join(tmpdir(),'qinghe-registration-'));
const dbPath=join(dir,'lab.db'),base='http://127.0.0.1:43183/api';
const credentials={role:'teacher',username:'registration-admin',password:'Registration-admin-2026'};
let server,admin;
const logs=[];
async function request(path,{body,method=body?'POST':'GET',cookie}={}) {
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function start() {
  // 所有注册与审核均在临时数据库中通过真实HTTP接口执行，不创建生产测试账号。
  server=spawn(process.execPath,['backend/src/index.js'],{cwd:root,env:{...process.env,DB_PATH:dbPath,PORT:'43183',HOST:'127.0.0.1',TEACHER_USERNAME:credentials.username,TEACHER_PASSWORD:credentials.password,AI_PROVIDER:'scripted'},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',d=>logs.push(d.toString()));server.stderr.on('data',d=>logs.push(d.toString()));
  for(let i=0;i<70;i++){try{if((await request('/health')).status===200)return;}catch{}await delay(100);}
  assert.fail('注册测试后端启动失败：'+logs.join(''));
}
async function stop() {
  if(server.exitCode!==null)return;
  const exited=new Promise(resolve=>server.once('exit',resolve));server.kill();await exited;
}
function readDatabase(fn){const db=new DatabaseSync(dbPath);try{return fn(db);}finally{db.close();}}
async function register(body) {
  const result=await request('/register',{body});
  assert.equal(result.status,201,JSON.stringify(result.data));assert.equal(result.cookie,undefined);
  const listed=await request('/admin/registrations?status=all',{cookie:admin});
  assert.equal(listed.status,200);
  const row=listed.data.requests.find(r=>body.role==='student'?r.student_no===body.studentNo:r.username===body.username);
  assert.ok(row);assert.equal(row.status,'pending');return row;
}
async function experiment(title) {
  const result=await request('/admin/experiments',{cookie:admin,body:{title}});
  assert.equal(result.status,201);return result.data;
}
async function review(ids,options,cookie=admin){return request('/admin/registrations/review',{cookie,body:{ids,...options}});}
before(async()=>{await start();const login=await request('/login',{body:credentials});assert.equal(login.status,200);assert.equal(login.data.user.is_admin,1);admin=login.cookie;});
after(async()=>{await stop();/* 只清理本测试创建的独立临时目录。 */rmSync(dir,{recursive:true,force:true});});

test('学生与教师自行注册后必须审核，重复身份不能覆盖原资料',async()=>{
  const student={role:'student',name:'自行注册学生',studentNo:'000-reg-01',className:'七年级1班'};
  const teacher={role:'teacher',name:'自行注册教师',username:'pending-teacher',password:'Pending-teacher-2026',note:'测试学校信息科技教师'};
  // 公开注册请求即使附带权限字段，也不能得到管理员或直接通过审核。
  const studentRow=await register({...student,is_admin:1,status:'approved'});
  const teacherRow=await register({...teacher,is_admin:1,status:'approved'});
  assert.equal((await request('/register',{body:{...student,name:'试图覆盖姓名'}})).status,409);
  assert.equal((await request('/register',{body:{...teacher,password:'Replacement-2026'}})).status,409);
  for(const body of [student,teacher]){
    const login=await request('/login',{body});assert.equal(login.status,403);assert.equal(login.cookie,undefined);assert.match(login.data.error,/审核/);
  }
  assert.equal((await request('/login',{body:{...teacher,password:'Replacement-2026'}})).status,401);
  assert.equal((await request('/admin/registrations')).status,401);
  const pending=await request('/admin/registrations',{cookie:admin});
  assert.equal(pending.status,200);assert.ok(pending.data.requests.every(r=>r.status==='pending'));assert.ok(pending.data.counts.pending>=2);
  const overview=await request('/admin/overview',{cookie:admin});assert.equal(overview.data.pendingRegistrations,pending.data.counts.pending);
  assert.ok(!JSON.stringify(pending.data).includes('password_hash'));assert.ok(!JSON.stringify(pending.data).includes(teacher.password));
  readDatabase(db=>{
    for(const row of [studentRow,teacherRow]){const user=db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id);assert.equal(user.status,'pending');assert.equal(user.is_admin,0);}
    const saved=db.prepare('SELECT * FROM users WHERE id=?').get(teacherRow.user_id);assert.match(saved.password_hash,/^\$2[aby]\$/);assert.equal(saved.name,teacher.name);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM students WHERE user_id=?').get(studentRow.user_id).n,0);
  });
});

test('批量审核整体提交，驳回可复核，学生通过时同时完成实验报名',async()=>{
  const first={role:'student',name:'审核学生甲',studentNo:'reg-review-01',className:'审核班'};
  const second={role:'student',name:'审核学生乙',studentNo:'reg-review-02',className:'审核班'};
  const teacher={role:'teacher',name:'审核教师',username:'review-teacher',password:'Review-teacher-2026'};
  const requests=[await register(first),await register(second),await register(teacher)];
  const ids=requests.map(r=>r.id),exp=await experiment('注册审核实验');
  const assertStillPending=()=>readDatabase(db=>{for(const r of requests){assert.equal(db.prepare('SELECT status FROM users WHERE id=?').get(r.user_id).status,'pending');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM students WHERE user_id=?').get(r.user_id).n,0);}});
  assert.equal((await review(ids,{action:'approve',experimentId:exp.id})).status,400);assertStillPending();
  assert.equal((await review(ids,{action:'approve',experimentId:exp.id,condition:'not-a-condition'})).status,400);assertStillPending();
  const missing=await review(ids,{action:'approve',experimentId:'missing-experiment',condition:'responsive-hint'});assert.ok([400,404,409].includes(missing.status));assertStillPending();
  await request('/admin/experiments/'+exp.id,{cookie:admin,method:'PUT',body:{status:'paused',config:{...DEFAULT_CONFIG,title:exp.title}}});
  const paused=await review(ids,{action:'approve',experimentId:exp.id,condition:'responsive-hint'});assert.ok([400,409].includes(paused.status));assertStillPending();
  await request('/admin/experiments/'+exp.id,{cookie:admin,method:'PUT',body:{status:'open',config:{...DEFAULT_CONFIG,title:exp.title}}});
  const invalidMember=await review([ids[0],'missing-registration'],{action:'approve',experimentId:exp.id,condition:'responsive-hint'});assert.ok([400,404,409].includes(invalidMember.status));assertStillPending();
  assert.equal((await review([ids[0]],{action:'reject',reviewNote:'   '})).status,400);
  const rejected=await review([ids[0]],{action:'reject',reviewNote:'请联系管理员核对班级'});assert.equal(rejected.status,200);
  const denied=await request('/login',{body:first});assert.equal(denied.status,403);assert.equal(denied.cookie,undefined);assert.match(denied.data.error,/核对班级/);
  const rejectedList=await request('/admin/registrations?status=rejected',{cookie:admin});assert.ok(rejectedList.data.requests.some(r=>r.id===ids[0]&&r.review_note.includes('核对班级')));
  const approved=await review(ids,{action:'approve',experimentId:exp.id,condition:'responsive-hint',reviewNote:'班级已核实'});assert.equal(approved.status,200,JSON.stringify(approved.data));assert.equal(approved.data.reviewed,3);
  for(const body of [first,second,teacher]){const login=await request('/login',{body});assert.equal(login.status,200,JSON.stringify(login.data));assert.ok(login.cookie);assert.equal(login.data.user.status,'approved');assert.equal(login.data.user.is_admin,0);}
  assert.equal((await review(ids,{action:'approve',experimentId:exp.id,condition:'responsive-hint'})).status,409);
  readDatabase(db=>{
    for(const r of requests.slice(0,2)){
      const enrolled=db.prepare('SELECT * FROM students WHERE user_id=?').all(r.user_id);assert.equal(enrolled.length,1);assert.equal(enrolled[0].experiment_id,exp.id);assert.equal(enrolled[0].class_name,'审核班');assert.equal(enrolled[0].condition,'responsive-hint');
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM students WHERE user_id=?').get(requests[2].user_id).n,0);
  });
  const approvedList=await request('/admin/registrations?status=approved',{cookie:admin});
  for(const r of requests){const saved=approvedList.data.requests.find(item=>item.id===r.id);assert.ok(saved.reviewed_at);assert.equal(saved.review_note,'班级已核实');}
});

test('均衡分配按当前人数分组，注册学生无权自行指定实验条件',async()=>{
  const exp=await experiment('批量均衡审核');
  const imported=await request('/admin/students',{cookie:admin,body:{experimentId:exp.id,students:[{name:'已登记学生',studentNo:'balanced-existing',className:'均衡班',condition:'active-hint'}]}});assert.equal(imported.status,201);
  const ids=[];
  for(let i=0;i<7;i++){const row=await register({role:'student',name:`均衡学生${i}`,studentNo:`balanced-reg-${i}`,className:'均衡班',condition:'active-hint'});ids.push(row.id);}
  const result=await review(ids,{action:'approve',experimentId:exp.id,condition:'balanced'});assert.equal(result.status,200);assert.equal(result.data.reviewed,7);
  const overview=await request('/admin/overview?experiment='+exp.id,{cookie:admin});
  const counts=Object.fromEntries(Object.keys(CONDITIONS).map(c=>[c,overview.data.students.filter(s=>s.condition===c).length]));
  assert.deepEqual(Object.values(counts),[2,2,2,2]);assert.ok(overview.data.students.every(s=>s.stage===null));
});

test('普通教师保留教学管理，但不能审核、创建教师或通过导入激活待审核身份',async()=>{
  const teacherBody={role:'teacher',name:'普通教师',username:'ordinary-teacher',password:'Ordinary-teacher-2026'};
  const created=await request('/admin/users/teachers',{cookie:admin,body:teacherBody});assert.equal(created.status,201);assert.equal(created.data.is_admin,0);
  const login=await request('/login',{body:teacherBody});assert.equal(login.status,200);const cookie=login.cookie;
  const pendingBody={role:'student',name:'未审核学生',studentNo:'ordinary-pending',className:'权限班'};
  const pending=await register(pendingBody);
  assert.equal((await request('/admin/registrations',{cookie})).status,403);
  assert.equal((await review([pending.id],{action:'reject',reviewNote:'不允许普通教师审核'},cookie)).status,403);
  assert.equal((await request('/admin/users/teachers',{cookie,body:{name:'越权教师',username:'forbidden-teacher',password:'Forbidden-teacher-2026'}})).status,403);
  const users=await request('/admin/users',{cookie});assert.equal(users.status,200);
  assert.equal(users.data.users.filter(u=>u.role==='teacher').length,1);assert.equal(users.data.users.find(u=>u.role==='teacher').id,login.data.user.id);assert.ok(users.data.users.every(u=>u.status==='approved'));assert.ok(!users.data.users.some(u=>u.id===pending.user_id));
  const updated=await request('/admin/account',{cookie,method:'PATCH',body:{name:'更名普通教师',is_admin:1}});assert.equal(updated.status,200);assert.equal(updated.data.is_admin,0);
  const exp=await experiment('普通教师导入验证');
  const importedBody={experimentId:exp.id,students:[{...pendingBody,condition:'active-hint'}]};
  assert.equal((await request('/admin/students',{cookie,body:importedBody})).status,409);
  await review([pending.id],{action:'reject',reviewNote:'资料待补充'});
  assert.equal((await request('/admin/students',{cookie,body:importedBody})).status,409);
  const fresh={name:'教师导入新学生',studentNo:'ordinary-imported',className:'权限班',condition:'active-detailed'};
  const imported=await request('/admin/students',{cookie,body:{experimentId:exp.id,students:[fresh]}});assert.equal(imported.status,201);
  const studentLogin=await request('/login',{body:{role:'student',...fresh}});assert.equal(studentLogin.status,200);assert.equal(studentLogin.data.user.status,'approved');
  assert.equal((await request('/admin/registrations',{cookie:studentLogin.cookie})).status,401);
  assert.equal((await request('/login',{body:pendingBody})).status,403);
});

test('重启后审核记录、已批准会话和实验草稿仍保留，未批准身份仍不能登录',async()=>{
  const student={role:'student',name:'重启学生',studentNo:'restart-approved',className:'持久化班'};
  const teacher={role:'teacher',name:'重启教师',username:'restart-approved-teacher',password:'Restart-teacher-2026'};
  const pending={role:'student',name:'重启待审',studentNo:'restart-pending',className:'持久化班'};
  const rejected={role:'student',name:'重启驳回',studentNo:'restart-rejected',className:'持久化班'};
  const studentRequest=await register(student),teacherRequest=await register(teacher);
  await register(pending);const rejectedRequest=await register(rejected);
  const exp=await experiment('重启审核验证');
  assert.equal((await review([studentRequest.id,teacherRequest.id],{action:'approve',experimentId:exp.id,condition:'active-detailed'})).status,200);
  assert.equal((await review([rejectedRequest.id],{action:'reject',reviewNote:'请核对学籍信息'})).status,200);
  const studentLogin=await request('/login',{body:student}),teacherLogin=await request('/login',{body:teacher});
  await request('/student/draft',{cookie:studentLogin.cookie,body:{stage:0,data:{problem:'审核后实验记录'}}});
  await stop();await start();
  const state=await request('/student/state',{cookie:studentLogin.cookie});assert.equal(state.status,200);assert.equal(state.data.state.drafts[0].problem,'审核后实验记录');
  assert.equal((await request('/me',{cookie:teacherLogin.cookie})).data.role,'teacher');
  assert.equal((await request('/login',{body:teacher})).status,200);
  for(const body of [pending,rejected])assert.equal((await request('/login',{body})).status,403);
  const list=await request('/admin/registrations?status=all',{cookie:admin});assert.equal(list.status,200);assert.equal(list.data.requests.find(r=>r.id===studentRequest.id).status,'approved');assert.equal(list.data.requests.find(r=>r.id===rejectedRequest.id).review_note,'请核对学籍信息');
});
