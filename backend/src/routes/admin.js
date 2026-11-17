import { Router } from 'express';
import { randomBytes, randomUUID, randomInt } from 'node:crypto';
import { z } from 'zod';
import db, { transaction } from '../db.js';
import { requireRole, requireAdmin } from '../auth.js';
import { CONDITIONS, DEFAULT_CONFIG } from '../../../shared/definitions.js';
import { conditionSchema, configSchema } from '../validation.js';
import { now, getExperiment, getProgress, rowsFor, httpError } from '../model.js';
import { experimentModelInfo, getExperimentModel, saveExperimentModel } from '../model-settings.js';
import { decideIrrigation } from '../../../shared/simulation.js';
import bcrypt from 'bcryptjs';
import { createTeacher, publicUser, userColumns, passwordSchema, usernameSchema, nameSchema, studentNoSchema } from '../users.js';
import { listRegistrations, reviewRegistrations } from '../registrations.js';
import { cancelExperimentGuidance } from '../guidance.js';

const router = Router();
const route = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
router.use(requireRole('teacher'));

function studentsFor(experimentId) {
  return db.prepare(`SELECT s.id,s.experiment_id,s.user_id,s.name,s.class_name,s.condition,s.pre_score,s.created_at,u.student_no,u.last_login_at,p.stage,p.completed,p.updated_at,
    (SELECT COUNT(*) FROM trials t WHERE t.student_id=s.id) AS trial_count,
    (SELECT COUNT(*) FROM messages m WHERE m.student_id=s.id AND m.role='assistant') AS guidance_count
    FROM students s JOIN users u ON u.id=s.user_id LEFT JOIN progress p ON p.student_id=s.id WHERE s.experiment_id=? ORDER BY s.class_name,s.name`).all(experimentId)
    .map(s => {
      const submissions = rowsFor('submissions', s.id);
      return { ...s, pretest: submissions.find(r => r.kind === 'pretest')?.data.score ?? null,
        posttest: submissions.find(r => r.kind === 'posttest')?.data.score ?? null };
    });
}

router.get('/overview', route((req, res) => {
  const experiment = getExperiment(req.query.experiment || 'default');
  const students = studentsFor(experiment.id);
  res.json({ experiment, students, currentUser:req.user,
    ...(req.user.is_admin ? {pendingRegistrations:db.prepare("SELECT COUNT(*) AS count FROM registration_requests r JOIN users u ON u.id=r.user_id WHERE u.status='pending'").get().count} : {}),
    experiments: db.prepare('SELECT id,title,status,created_at FROM experiments ORDER BY created_at DESC').all(),
    guidance: experimentModelInfo(experiment.id),
    conditions: CONDITIONS,
  });
}));

router.post('/experiments', route((req, res) => {
  const { title } = z.object({ title: z.string().trim().min(1).max(100) }).parse(req.body);
  const id = randomUUID();
  const config = { ...DEFAULT_CONFIG, title };
  db.prepare('INSERT INTO experiments (id,title,config,created_at) VALUES (?,?,?,?)').run(id,title,JSON.stringify(config),now());
  res.status(201).json(getExperiment(id));
}));
router.get('/experiments/:id/model',route((req,res)=>{
  res.json(getExperimentModel(req.params.id));
}));
router.put('/experiments/:id/model',route((req,res)=>{
  res.json(saveExperimentModel(req.user.id,req.params.id,req.body));
}));
router.put('/experiments/:id', route((req, res) => {
  getExperiment(req.params.id);
  const { config, status } = z.object({ config: configSchema, status: z.enum(['open','paused','closed']) }).parse(req.body);
  db.prepare('UPDATE experiments SET title=?,config=?,status=? WHERE id=?').run(config.title,JSON.stringify(config),status,req.params.id);
  if (status!=='open') cancelExperimentGuidance(req.params.id);
  res.json(getExperiment(req.params.id));
}));

const studentInput = z.object({ name:nameSchema, studentNo:studentNoSchema, className: z.string().trim().min(1).max(80),
  condition: conditionSchema, preScore: z.number().min(0).max(1000).nullable().default(null) });
router.post('/students', route((req, res) => {
  const { experimentId, students } = z.object({ experimentId: z.string(), students: z.array(studentInput).min(1).max(500) }).parse(req.body);
  getExperiment(experimentId);
  const created = transaction(() => students.map(s => {
    let user=db.prepare("SELECT * FROM users WHERE role='student' AND student_no=?").get(s.studentNo);
    if (user && user.status!=='approved') throw httpError(409,`学号${s.studentNo}的注册申请尚未通过，请联系管理员审核后再导入。`);
    if (user && user.name!==s.name) throw httpError(409,`学号${s.studentNo}已登记为${user.name}，请核对姓名。`);
    if (!user) {
      user={id:randomUUID()};
      db.prepare('INSERT INTO users(id,role,name,student_no,created_at) VALUES (?,?,?,?,?)').run(user.id,'student',s.name,s.studentNo,now());
    }
    if(db.prepare('SELECT id FROM students WHERE experiment_id=? AND user_id=?').get(experimentId,user.id))throw httpError(409,`学号${s.studentNo}已加入本轮实验。`);
    const student = { id: randomUUID(), userId:user.id, ...s };
    // code字段仅为旧表结构保留，不再用于任何登录或对外返回。
    db.prepare('INSERT INTO students (id,experiment_id,user_id,code,name,class_name,condition,pre_score,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(student.id,experimentId,user.id,randomBytes(9).toString('base64url'),s.name,s.className,s.condition,s.preScore,now());
    return student;
  }));
  res.status(201).json({ students: created });
}));

router.patch('/students/:id', route((req, res) => {
  const s = db.prepare('SELECT * FROM students WHERE id=?').get(req.params.id);
  if (!s) throw httpError(404, '学生不存在');
  const data=z.object({condition:conditionSchema.optional(),name:nameSchema.optional(),studentNo:studentNoSchema.optional(),className:nameSchema.optional()}).parse(req.body);
  if (data.condition && data.condition!==s.condition && db.prepare('SELECT student_id FROM progress WHERE student_id=?').get(s.id)) throw httpError(409, '学生已开始实验，不能更改实验条件。');
  if (data.studentNo && db.prepare('SELECT id FROM users WHERE student_no=? AND id<>?').get(data.studentNo,s.user_id)) throw httpError(409,'该学号已属于另一用户，请核对学生身份。');
  transaction(()=>{
    if(data.condition)db.prepare('UPDATE students SET condition=? WHERE id=?').run(data.condition,s.id);
    if(data.className)db.prepare('UPDATE students SET class_name=? WHERE id=?').run(data.className,s.id);
    // 姓名和学号属于用户本人，修改后跨实验同步，实验成果仍关联原学生id。
    if(data.name){db.prepare('UPDATE users SET name=? WHERE id=?').run(data.name,s.user_id);db.prepare('UPDATE students SET name=? WHERE user_id=?').run(data.name,s.user_id);}
    if(data.studentNo)db.prepare('UPDATE users SET student_no=? WHERE id=?').run(data.studentNo,s.user_id);
  });
  res.json({ ok: true });
}));

function shuffle(values) {
  const a = [...values];
  for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
router.post('/assign', route((req, res) => {
  const { experimentId } = z.object({ experimentId: z.string() }).parse(req.body);
  const students = studentsFor(experimentId);
  if (students.some(s => s.stage !== null)) throw httpError(409, '已有学生开始实验，不能重新随机分组。');
  const classes = [...new Set(students.map(s => s.class_name))];
  const conditions = Object.keys(CONDITIONS);
  const mapping = [];
  const counts = Object.fromEntries(conditions.map(c => [c,0]));
  // 在班级内按前测形成四人区组，区组内随机分配；保存实际分配结果供研究复核。
  for (const className of classes) {
    const ordered = shuffle(students.filter(s => s.class_name === className)).sort((a,b) => (b.pre_score ?? -1) - (a.pre_score ?? -1));
    for (let i = 0; i < ordered.length; i += 4) {
      const block = ordered.slice(i,i+4);
      const choices = shuffle(conditions);
      if (block.length < 4) choices.sort((a,b) => counts[a] - counts[b]);
      block.forEach((s,j) => { mapping.push({ id:s.id, condition:choices[j] }); counts[choices[j]]++; });
    }
  }
  transaction(() => mapping.forEach(s => db.prepare('UPDATE students SET condition=? WHERE id=?').run(s.condition,s.id)));
  res.json({ assigned: mapping.length, counts });
}));

router.get('/students/:id', route((req, res) => {
  const student = db.prepare('SELECT s.id,s.user_id,s.experiment_id,s.name,s.class_name,s.condition,s.pre_score,s.created_at,u.student_no,u.last_login_at FROM students s JOIN users u ON u.id=s.user_id WHERE s.id=?').get(req.params.id);
  if (!student) throw httpError(404, '学生不存在');
  const progressRow = db.prepare('SELECT * FROM progress WHERE student_id=?').get(student.id);
  const progress = progressRow ? { ...progressRow, state:JSON.parse(progressRow.state), config:JSON.parse(progressRow.config_snapshot) } : null;
  const trials = rowsFor('trials',student.id).map(t => ({ ...t,
    matchesReference: progress ? t.data.decision === decideIrrigation(t.data.input.moisture,t.data.input.weather,progress.config.referenceRule,progress.config) : null,
  }));
  res.json({ student, progress, trials, submissions:rowsFor('submissions',student.id), events:rowsFor('events',student.id), messages:rowsFor('messages',student.id), guidanceRuns:rowsFor('guidance_runs',student.id) });
}));

function csv(rows, keys) {
  const cell = value => {
    let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    // 文本以公式符号开头时按纯文本导出，保证学生原话在表格中可安全阅读。
    if (/^[=+@-]/.test(text)) text = "'" + text;
    return `"${text.replaceAll('"','""')}"`;
  };
  return '\uFEFF' + [keys,...rows.map(row => keys.map(key => row[key]))].map(row => row.map(cell).join(',')).join('\r\n');
}
router.get('/export', route((req, res) => {
  const experiment = getExperiment(req.query.experiment || 'default');
  const students = studentsFor(experiment.id);
  const type = z.enum(['roster','summary','trials','submissions','messages','events','guidance_runs','all']).parse(req.query.type || 'summary');
  if (type === 'all') {
    const records = students.map(({ code, ...student }) => {
      const p = db.prepare('SELECT * FROM progress WHERE student_id=?').get(student.id);
      return { student, progress: p ? { ...p, config_snapshot:JSON.parse(p.config_snapshot), state:JSON.parse(p.state) } : null,
        trials:rowsFor('trials',student.id), submissions:rowsFor('submissions',student.id), messages:rowsFor('messages',student.id), events:rowsFor('events',student.id), guidanceRuns:rowsFor('guidance_runs',student.id) };
    });
    res.attachment('qinghe-research-data.json').type('json').send(JSON.stringify({ version:1, exportedAt:now(), experiment, records },null,2));
    return;
  }
  let rows, keys;
  if (type === 'roster' || type === 'summary') {
    rows = students;
    keys = type === 'roster' ? ['id','user_id','name','student_no','class_name','condition','pre_score'] : ['id','user_id','name','student_no','class_name','condition','pre_score','stage','completed','trial_count','guidance_count','pretest','posttest','updated_at'];
  } else {
    rows = students.flatMap(s => rowsFor(type,s.id).map(row => ({ ...row, student_name:s.name,student_no:s.student_no,class_name:s.class_name,condition:s.condition })));
    keys = type === 'messages' ? ['id','student_id','student_name','student_no','class_name','condition','stage','role','content','trigger','provider','model','model_source','created_at']
      : type === 'guidance_runs' ? ['id','student_id','student_name','student_no','class_name','condition','stage','trigger','status','provider','model','model_source','prompt_version','queue_ms','duration_ms','context_chars','input_tokens','output_tokens','error','created_at','started_at','finished_at']
      : ['id','student_id','student_name','student_no','class_name','condition','stage',type === 'events' ? 'type' : 'kind','data','created_at'];
  }
  res.attachment(`qinghe-${type}.csv`).type('text/csv; charset=utf-8').send(csv(rows,keys));
}));
router.get('/users',route((req,res)=>{
  // 普通教师可查看已登记学生和自己，其他教师及申请资料仅供管理员管理。
  const users=req.user.is_admin
    ? db.prepare(`SELECT ${userColumns} FROM users ORDER BY role,name`).all()
    : db.prepare(`SELECT ${userColumns} FROM users WHERE id=? OR (role='student' AND status='approved') ORDER BY role,name`).all(req.user.id);
  res.json({currentUser:req.user,users});
}));
router.get('/registrations',requireAdmin,route((req,res)=>{
  res.json(listRegistrations(req.query.status));
}));
router.post('/registrations/review',requireAdmin,route((req,res)=>{
  res.json(reviewRegistrations(req.user,req.body));
}));
router.post('/users/teachers',requireAdmin,route(async(req,res)=>{
  const {username,password,name}=z.object({username:usernameSchema,password:passwordSchema,name:nameSchema}).parse(req.body);
  res.status(201).json(await createTeacher({username,password,name}));
}));
router.patch('/account',route(async(req,res)=>{
  const {name,currentPassword,newPassword}=z.object({name:nameSchema,currentPassword:z.string().optional(),newPassword:passwordSchema.optional()}).parse(req.body);
  let passwordHash;
  if(newPassword){
    const user=db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
    if(!currentPassword || bcrypt.truncates(currentPassword) || !await bcrypt.compare(currentPassword,user.password_hash))throw httpError(400,'当前密码不正确。');
    passwordHash=await bcrypt.hash(newPassword,12);
  }
  transaction(()=>{
    db.prepare('UPDATE users SET name=? WHERE id=?').run(name,req.user.id);
    if(passwordHash){
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash,req.user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(req.user.id,req.session.token);
    }
  });
  res.json(publicUser(req.user.id));
}));
export default router;
