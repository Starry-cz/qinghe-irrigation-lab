import bcrypt from 'bcryptjs';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import db, { transaction } from './db.js';
import { nameSchema, passwordSchema, studentNoSchema, usernameSchema } from './users.js';
import { conditionSchema } from './validation.js';
import { getExperiment, httpError, now } from './model.js';
import { CONDITIONS } from '../../shared/definitions.js';

const registrationSchema = z.discriminatedUnion('role', [
  z.object({ role:z.literal('student'), name:nameSchema, studentNo:studentNoSchema, className:nameSchema }),
  z.object({ role:z.literal('teacher'), name:nameSchema, username:usernameSchema, password:passwordSchema,
    note:z.string().trim().max(500).default('') }),
]);

export async function registerUser(body) {
  const data=registrationSchema.parse(body);
  const passwordHash=data.role==='teacher' ? await bcrypt.hash(data.password,12) : null;
  transaction(() => {
    // 唯一身份检查放在写入事务内，重复申请不会覆盖原账号资料和密码。
    const exists=data.role==='teacher'
      ? db.prepare('SELECT id FROM users WHERE username=?').get(data.username)
      : db.prepare('SELECT id FROM users WHERE student_no=?').get(data.studentNo);
    if (exists) throw httpError(409,data.role==='teacher'
      ? '该教师账号已存在或已提交申请，请直接登录查看审核结果。'
      : '该学号已登记或已提交申请，请直接登录查看审核结果。');
    const userId=randomUUID(), createdAt=now();
    // 自主注册固定为待审核、非管理员，不采纳客户端传来的权限或状态。
    db.prepare(`INSERT INTO users(id,role,username,password_hash,name,student_no,status,is_admin,created_at)
      VALUES (?,?,?,?,?,?,'pending',0,?)`).run(userId,data.role,data.username || null,passwordHash,data.name,data.studentNo || null,createdAt);
    db.prepare('INSERT INTO registration_requests(id,user_id,class_name,note,created_at) VALUES (?,?,?,?,?)')
      .run(randomUUID(),userId,data.className || null,data.note || '',createdAt);
  });
  return {ok:true,status:'pending',message:'注册申请已提交，请等待管理员审核。审核通过后可直接登录。'};
}

export function listRegistrations(queryStatus) {
  const status=z.enum(['pending','approved','rejected','all']).parse(queryStatus || 'pending');
  const fields=`r.id,r.user_id,u.role,u.name,u.username,u.student_no,r.class_name,r.note,u.status,
    r.created_at,r.review_note,r.reviewed_at`;
  const query=`SELECT ${fields} FROM registration_requests r JOIN users u ON u.id=r.user_id`;
  const requests=status==='all'
    ? db.prepare(`${query} ORDER BY r.created_at DESC,r.id`).all()
    : db.prepare(`${query} WHERE u.status=? ORDER BY r.created_at DESC,r.id`).all(status);
  const counts={pending:0,approved:0,rejected:0};
  for (const row of db.prepare(`SELECT u.status,COUNT(*) AS count FROM registration_requests r
    JOIN users u ON u.id=r.user_id GROUP BY u.status`).all()) counts[row.status]=row.count;
  return {requests,counts};
}

const reviewSchema=z.object({
  ids:z.array(z.string().min(1)).min(1,'请选择需要审核的申请').max(500)
    .refine(ids=>new Set(ids).size===ids.length,'不能重复选择同一申请'),
  action:z.enum(['approve','reject']), experimentId:z.string().min(1).optional(),
  condition:z.union([conditionSchema,z.literal('balanced')]).optional(),
  reviewNote:z.string().trim().max(1000).default(''),
});

export function reviewRegistrations(reviewer,body) {
  const data=reviewSchema.parse(body);
  if (data.action==='reject' && !data.reviewNote) throw httpError(400,'请填写未通过审核的原因。');
  return transaction(() => {
    const placeholders=data.ids.map(()=>'?').join(',');
    const requests=db.prepare(`SELECT r.*,u.role,u.name,u.status FROM registration_requests r
      JOIN users u ON u.id=r.user_id WHERE r.id IN (${placeholders}) ORDER BY r.created_at,r.id`).all(...data.ids);
    if (requests.length!==data.ids.length) throw httpError(404,'部分注册申请不存在，请刷新列表后重试。');
    if (requests.some(request=>request.status==='approved')) throw httpError(409,'已通过审核的申请不能再次审核。');
    const students=requests.filter(request=>request.role==='student');
    const counts=Object.fromEntries(Object.keys(CONDITIONS).map(condition=>[condition,0]));
    if (data.action==='approve' && students.length) {
      if (!data.experimentId || !data.condition) throw httpError(400,'通过学生申请时，请选择实验和分组方式。');
      if (getExperiment(data.experimentId).status!=='open') throw httpError(409,'请选择已开放的实验，审核通过后学生才能开始实验。');
      if (data.condition==='balanced') {
        for (const row of db.prepare('SELECT condition,COUNT(*) AS count FROM students WHERE experiment_id=? GROUP BY condition').all(data.experimentId)) {
          counts[row.condition]=row.count;
        }
      }
    }
    const reviewedAt=now(), status=data.action==='approve'?'approved':'rejected';
    for (const request of requests) {
      if (data.action==='approve' && request.role==='student') {
        let condition=data.condition;
        if (condition==='balanced') {
          // 只有管理员明确选择均衡分组时，才按本轮当前人数选择最少的一组；并列时随机选择。
          const minimum=Math.min(...Object.values(counts));
          const choices=Object.keys(CONDITIONS).filter(key=>counts[key]===minimum);
          condition=choices[randomInt(choices.length)];
          counts[condition]++;
        }
        // 报名、实验条件和审核状态一起提交，避免出现通过审核却无实验可进入的账号。
        db.prepare(`INSERT INTO students(id,experiment_id,user_id,code,name,class_name,condition,pre_score,created_at)
          VALUES (?,?,?,?,?,?,?,NULL,?)`).run(randomUUID(),data.experimentId,request.user_id,
          randomBytes(9).toString('base64url'),request.name,request.class_name,condition,reviewedAt);
      }
      db.prepare('UPDATE users SET status=? WHERE id=?').run(status,request.user_id);
      db.prepare('UPDATE registration_requests SET review_note=?,reviewed_by=?,reviewed_at=? WHERE id=?')
        .run(data.reviewNote,reviewer.id,reviewedAt,request.id);
    }
    return {reviewed:requests.length};
  });
}
