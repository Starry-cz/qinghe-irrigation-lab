// 基于Rediwed模板改编，使用Node 24内置SQLite免去原生依赖编译。
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from './config.js';
import { DEFAULT_CONFIG } from '../../shared/definitions.js';

mkdirSync(dirname(env.dbPath), { recursive: true });
const db = new DatabaseSync(env.dbPath);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('teacher','student')),
    username TEXT UNIQUE, password_hash TEXT, name TEXT NOT NULL,
    student_no TEXT UNIQUE, created_at TEXT NOT NULL, last_login_at TEXT
  );
  CREATE TABLE IF NOT EXISTS experiments (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
    config TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL REFERENCES experiments(id),
    code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, class_name TEXT NOT NULL,
    condition TEXT NOT NULL, pre_score REAL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, role TEXT NOT NULL, student_id TEXT REFERENCES students(id),
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS progress (
    student_id TEXT PRIMARY KEY REFERENCES students(id), stage INTEGER NOT NULL DEFAULT 0,
    config_snapshot TEXT NOT NULL, state TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL REFERENCES students(id),
    stage INTEGER NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trials (
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL REFERENCES students(id),
    stage INTEGER NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL REFERENCES students(id),
    type TEXT NOT NULL, stage INTEGER NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL REFERENCES students(id),
    stage INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, trigger TEXT,
    provider TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS trial_student ON trials(student_id, id);
  CREATE INDEX IF NOT EXISTS event_student ON events(student_id, id);
  CREATE INDEX IF NOT EXISTS message_student ON messages(student_id, id);
`);
// 增量迁移保留学生id和所有实验记录；学号缺失时留空，交由教师补充。
if (db.prepare('PRAGMA user_version').get().user_version < 2) {
  db.exec('BEGIN');
  try {
    if (!db.prepare('PRAGMA table_info(students)').all().some(c => c.name === 'user_id')) db.exec('ALTER TABLE students ADD COLUMN user_id TEXT REFERENCES users(id)');
    if (!db.prepare('PRAGMA table_info(sessions)').all().some(c => c.name === 'user_id')) db.exec('ALTER TABLE sessions ADD COLUMN user_id TEXT REFERENCES users(id)');
    const demoNumbers={'demo-ah':'20260001','demo-ad':'20260002','demo-rh':'20260003','demo-rd':'20260004'};
    for (const student of db.prepare('SELECT * FROM students WHERE user_id IS NULL').all()) {
      const userId=`student:${student.id}`;
      db.prepare('INSERT INTO users(id,role,name,student_no,created_at) VALUES (?,?,?,?,?)').run(userId,'student',student.name,demoNumbers[student.code] || null,student.created_at);
      db.prepare('UPDATE students SET user_id=? WHERE id=?').run(userId,student.id);
    }
    db.exec("UPDATE sessions SET user_id=(SELECT user_id FROM students WHERE students.id=sessions.student_id) WHERE role='student'");
    // 旧教师会话没有账号身份，升级后重新登录；学生会话仍关联原实验。
    db.exec("DELETE FROM sessions WHERE role='teacher' AND user_id IS NULL");
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS student_enrollment ON students(experiment_id,user_id); PRAGMA user_version=2; COMMIT');
  } catch(error) { db.exec('ROLLBACK'); throw error; }
}
// 老账号直接保留使用资格，新增审核字段不会改变已有报名和实验成果。
if (db.prepare('PRAGMA user_version').get().user_version < 3) {
  transaction(() => {
    db.exec(`ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('pending','approved','rejected'));
      ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0 CHECK(is_admin IN (0,1));
      CREATE TABLE registration_requests (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
        class_name TEXT, note TEXT NOT NULL DEFAULT '', review_note TEXT NOT NULL DEFAULT '',
        reviewed_by TEXT REFERENCES users(id), reviewed_at TEXT, created_at TEXT NOT NULL
      );`);
    // 现有 admin 优先成为管理员；测试和自定义部署沿用配置的初始教师账号。
    const administrator = db.prepare("SELECT id FROM users WHERE role='teacher' AND username='admin'").get()
      || db.prepare("SELECT id FROM users WHERE role='teacher' AND username=?").get(env.teacherUsername);
    if (administrator) db.prepare('UPDATE users SET is_admin=1 WHERE id=?').run(administrator.id);
    db.exec('PRAGMA user_version=3');
  });
}
// 模型设置单独保存，实验保存教师配置的快照；旧消息缺失的模型来源保持空值。
if (db.prepare('PRAGMA user_version').get().user_version < 4) {
  transaction(() => {
    db.exec(`CREATE TABLE personal_model_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id), mode TEXT NOT NULL CHECK(mode IN ('default','custom')),
      base_url TEXT NOT NULL, model TEXT NOT NULL, thinking TEXT NOT NULL DEFAULT '',
      api_key_ciphertext TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE experiment_model_settings (
      experiment_id TEXT PRIMARY KEY REFERENCES experiments(id), owner_user_id TEXT NOT NULL REFERENCES users(id),
      base_url TEXT NOT NULL, model TEXT NOT NULL, thinking TEXT NOT NULL DEFAULT '',
      api_key_ciphertext TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    ALTER TABLE messages ADD COLUMN model TEXT;
    ALTER TABLE messages ADD COLUMN model_source TEXT;
    PRAGMA user_version=4;`);
  });
}
// 指导任务与学生成果分开保存，刷新可查询状态，服务重启也不会留下永久“生成中”。
if (db.prepare('PRAGMA user_version').get().user_version < 5) {
  transaction(() => {
    db.exec(`CREATE TABLE guidance_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL REFERENCES students(id),
      stage INTEGER NOT NULL, trigger TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
      provider TEXT NOT NULL, model TEXT, model_source TEXT, prompt_version TEXT,
      user_message_id INTEGER REFERENCES messages(id),
      created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
      queue_ms INTEGER, duration_ms INTEGER, context_chars INTEGER,
      input_tokens INTEGER, output_tokens INTEGER, error TEXT
    );
    CREATE INDEX guidance_run_student ON guidance_runs(student_id,id);
    PRAGMA user_version=5;`);
  });
}
// 启动只创建默认实验，不生成演示学生，也不重置已有数据库。
db.prepare('INSERT OR IGNORE INTO experiments (id,title,config,created_at) VALUES (?,?,?,?)')
  .run('default', DEFAULT_CONFIG.title, JSON.stringify(DEFAULT_CONFIG), new Date().toISOString());
export function transaction(fn) {
  db.exec('BEGIN');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export default db;
