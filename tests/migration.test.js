import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DEFAULT_CONFIG} from '../shared/definitions.js';
import bcrypt from 'bcryptjs';

test('旧版数据库增量迁移，原始成果和学生会话不丢失',()=>{
  const dir=mkdtempSync(join(tmpdir(),'qinghe-migration-')),path=join(dir,'old.db');
  let db=new DatabaseSync(path);
  try{
    // 固定旧版表结构构建升级场景，而不是用新版建表逻辑生成待迁移数据。
    db.exec(`CREATE TABLE experiments(id TEXT PRIMARY KEY,title TEXT,status TEXT DEFAULT 'open',config TEXT,created_at TEXT);
      CREATE TABLE students(id TEXT PRIMARY KEY,experiment_id TEXT,code TEXT UNIQUE,name TEXT,class_name TEXT,condition TEXT,pre_score REAL,created_at TEXT);
      CREATE TABLE sessions(token TEXT PRIMARY KEY,role TEXT,student_id TEXT,expires_at TEXT);
      CREATE TABLE progress(student_id TEXT PRIMARY KEY,stage INTEGER,config_snapshot TEXT,state TEXT,completed INTEGER,updated_at TEXT);
      CREATE TABLE submissions(id INTEGER PRIMARY KEY,student_id TEXT,stage INTEGER,kind TEXT,data TEXT,created_at TEXT);`);
    db.prepare('INSERT INTO experiments(id,title,config,created_at) VALUES (?,?,?,?)').run('default','旧实验',JSON.stringify(DEFAULT_CONFIG),'2026-10-28');
    db.prepare('INSERT INTO students VALUES (?,?,?,?,?,?,?,?)').run('old-student','default','legacy-code','旧学生','旧班级','active-hint',null,'2026-10-28');
    db.prepare('INSERT INTO students VALUES (?,?,?,?,?,?,?,?)').run('demo-student','default','demo-ah','演示学生1','演示班','active-hint',null,'2026-10-28');
    db.prepare('INSERT INTO progress VALUES (?,?,?,?,?,?)').run('old-student',2,JSON.stringify(DEFAULT_CONFIG),JSON.stringify({drafts:{0:{problem:'原始猜想'}}}),0,'2026-10-28');
    db.prepare('INSERT INTO submissions VALUES (?,?,?,?,?,?)').run(1,'old-student',0,'stage',JSON.stringify({problem:'原始提交'}),'2026-10-28');
    db.exec("INSERT INTO sessions VALUES ('student-session','student','old-student','2099-01-01'); INSERT INTO sessions VALUES ('teacher-session','teacher',NULL,'2099-01-01');");
    db.close();db=null;
    const root=fileURLToPath(new URL('../',import.meta.url));
    const migrate=()=>execFileSync(process.execPath,['--input-type=module','-e',"import db from './backend/src/db.js'; db.close();"],{cwd:root,env:{...process.env,DB_PATH:path},stdio:'pipe'});
    migrate();migrate();
    db=new DatabaseSync(path);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n,2);
    assert.equal(db.prepare("SELECT student_no FROM users WHERE name='旧学生'").get().student_no,null);
    assert.equal(db.prepare("SELECT student_no FROM users WHERE name='演示学生1'").get().student_no,'20260001');
    assert.equal(db.prepare("SELECT stage FROM progress WHERE student_id='old-student'").get().stage,2);
    assert.equal(JSON.parse(db.prepare('SELECT data FROM submissions').get().data).problem,'原始提交');
    assert.ok(db.prepare("SELECT user_id FROM sessions WHERE token='student-session'").get().user_id);
    assert.equal(db.prepare("SELECT * FROM sessions WHERE token='teacher-session'").get(),undefined);
    assert.ok(db.prepare('SELECT status FROM users').all().every(user=>user.status==='approved'));
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,5);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guidance_runs').get().n,0);
  }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});

// 分别覆盖默认admin与自定义初始账号，两次启动均不能重置现有密码或实验成果。
for(const scenario of [{username:'admin',configuredUsername:'other-teacher'},{username:'custom-teacher',configuredUsername:'custom-teacher'}]){
  test(`账号版数据库升级后保留${scenario.username}管理员、登录资料和实验成果`,()=>{
    const dir=mkdtempSync(join(tmpdir(),'qinghe-account-migration-')),path=join(dir,'v2.db');
    const passwordHash=bcrypt.hashSync('Existing-teacher-password-2026',4);
    let db=new DatabaseSync(path);
    try{
      // 独立定义v2结构，避免迁移测试直接复用待验证的新建表代码。
      db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT NOT NULL,username TEXT UNIQUE,password_hash TEXT,name TEXT NOT NULL,student_no TEXT UNIQUE,created_at TEXT NOT NULL,last_login_at TEXT);
        CREATE TABLE experiments(id TEXT PRIMARY KEY,title TEXT,status TEXT DEFAULT 'open',config TEXT,created_at TEXT);
        CREATE TABLE students(id TEXT PRIMARY KEY,experiment_id TEXT,code TEXT UNIQUE,name TEXT,class_name TEXT,condition TEXT,pre_score REAL,created_at TEXT,user_id TEXT);
        CREATE UNIQUE INDEX student_enrollment ON students(experiment_id,user_id);
        CREATE TABLE sessions(token TEXT PRIMARY KEY,role TEXT,student_id TEXT,expires_at TEXT,user_id TEXT);
        CREATE TABLE progress(student_id TEXT PRIMARY KEY,stage INTEGER,config_snapshot TEXT,state TEXT,completed INTEGER,updated_at TEXT);
        CREATE TABLE submissions(id INTEGER PRIMARY KEY,student_id TEXT,stage INTEGER,kind TEXT,data TEXT,created_at TEXT);
        CREATE TABLE messages(id INTEGER PRIMARY KEY,student_id TEXT,stage INTEGER,role TEXT,content TEXT,trigger TEXT,provider TEXT,created_at TEXT);
        PRAGMA user_version=2;`);
      db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)').run('other-id','teacher','other-teacher',passwordHash,'协作教师',null,'2026-01-01','2026-10-27');
      db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)').run('admin-id','teacher',scenario.username,passwordHash,'原管理员姓名',null,'2026-02-01','2026-10-28');
      db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)').run('student-user-id','student',null,null,'原学生','001234','2026-03-01','2026-10-28');
      db.prepare('INSERT INTO experiments(id,title,config,created_at) VALUES (?,?,?,?)').run('default','保留的旧实验',JSON.stringify(DEFAULT_CONFIG),'2026-01-01');
      db.prepare('INSERT INTO students VALUES (?,?,?,?,?,?,?,?,?)').run('student-id','default','internal-code','原学生','原班级','active-detailed',8,'2026-03-01','student-user-id');
      db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?)').run('teacher-token','teacher',null,'2099-01-01','admin-id');
      db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?)').run('student-token','student','student-id','2099-01-01','student-user-id');
      db.prepare('INSERT INTO progress VALUES (?,?,?,?,?,?)').run('student-id',2,JSON.stringify(DEFAULT_CONFIG),JSON.stringify({drafts:{0:{problem:'升级前的草稿'}}}),0,'2026-10-28');
      db.prepare('INSERT INTO submissions VALUES (?,?,?,?,?,?)').run(1,'student-id',0,'stage',JSON.stringify({problem:'升级前的提交'}),'2026-10-28');
      db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)').run(1,'student-id',1,'assistant','升级前的指导','help','scripted','2026-10-28');
      db.close();db=null;
      const root=fileURLToPath(new URL('../',import.meta.url));
      const initialize=()=>execFileSync(process.execPath,['--input-type=module','-e',"import db from './backend/src/db.js'; import { initializeTeacher } from './backend/src/users.js'; await initializeTeacher(); db.close();"],{cwd:root,env:{...process.env,DB_PATH:path,TEACHER_USERNAME:scenario.configuredUsername,TEACHER_PASSWORD:'Must-not-replace-existing-password'},stdio:'pipe'});
      initialize();initialize();
      db=new DatabaseSync(path);
      assert.equal(db.prepare('PRAGMA user_version').get().user_version,5);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guidance_runs').get().n,0);
      const users=db.prepare('SELECT * FROM users ORDER BY id').all();assert.equal(users.length,3);assert.ok(users.every(user=>user.status==='approved'));
      assert.deepEqual(users.filter(user=>user.is_admin===1).map(user=>user.id),['admin-id']);
      const admin=users.find(user=>user.id==='admin-id');assert.equal(admin.username,scenario.username);assert.equal(admin.name,'原管理员姓名');assert.equal(admin.password_hash,passwordHash);assert.equal(admin.last_login_at,'2026-10-28');
      assert.equal(users.find(user=>user.id==='student-user-id').student_no,'001234');
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM registration_requests').get().n,0);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM students').get().n,1);
      assert.equal(db.prepare("SELECT user_id FROM sessions WHERE token='teacher-token'").get().user_id,'admin-id');
      assert.equal(db.prepare("SELECT student_id FROM sessions WHERE token='student-token'").get().student_id,'student-id');
      const progress=db.prepare('SELECT * FROM progress').get();assert.equal(progress.stage,2);assert.equal(JSON.parse(progress.state).drafts[0].problem,'升级前的草稿');
      assert.equal(JSON.parse(db.prepare('SELECT data FROM submissions').get().data).problem,'升级前的提交');
      const message=db.prepare('SELECT * FROM messages').get();assert.equal(message.content,'升级前的指导');assert.equal(message.model,null);assert.equal(message.model_source,null);
    }finally{db?.close();/* 仅删除本测试创建的临时数据库目录。 */rmSync(dir,{recursive:true,force:true});}
  });
}
