import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import db from './db.js';
import { env } from './config.js';
import { httpError } from './model.js';

export const passwordSchema=z.string().min(8,'密码至少8个字符').refine(value=>!bcrypt.truncates(value),'密码最多72个UTF-8字节');
export const usernameSchema=z.string().trim().min(3,'账号至少3个字符').max(80);
export const nameSchema=z.string().trim().min(1,'请填写姓名').max(80);
export const studentNoSchema=z.string().trim().min(1,'请填写学号').max(80);
export const userColumns='id,role,username,name,student_no,status,is_admin,created_at,last_login_at';
export function publicUser(id) { return db.prepare(`SELECT ${userColumns} FROM users WHERE id=?`).get(id); }

// 状态检查在验证登录资料后执行，明确告知申请人等待审核或退回原因。
export function assertApproved(user) {
  if (user.status === 'pending') throw httpError(403,'注册申请正在等待管理员审核，通过后即可登录。');
  if (user.status === 'rejected') {
    const request=db.prepare('SELECT review_note FROM registration_requests WHERE user_id=?').get(user.id);
    throw httpError(403,`注册申请未通过审核：${request.review_note}。请联系管理员。`);
  }
}

// bcrypt仅用于用户明确授权的登录密码存储，不做文件哈希校验。
export async function createTeacher({username,password,name}) {
  const data=z.object({username:usernameSchema,password:passwordSchema,name:nameSchema}).parse({username,password,name});
  const passwordHash=await bcrypt.hash(data.password,12);
  // 密码处理完成后再检查唯一性，避免与同时提交的自主注册争用同一账号。
  if (db.prepare('SELECT id FROM users WHERE username=?').get(data.username)) throw httpError(409,'教师账号已存在。');
  const id=randomUUID();
  db.prepare('INSERT INTO users(id,role,username,password_hash,name,created_at) VALUES (?,?,?,?,?,?)')
    .run(id,'teacher',data.username,passwordHash,data.name,new Date().toISOString());
  return publicUser(id);
}
export async function initializeTeacher() {
  // 只初始化首位教师；以后修改密码或重启服务不会被.env中的初始值覆盖。
  if (db.prepare("SELECT id FROM users WHERE role='teacher' LIMIT 1").get()) return;
  if (!env.teacherPassword || env.teacherPassword==='replace-with-your-teacher-password') throw new Error('请先执行npm run setup并配置初始教师账号与密码。');
  const teacher=await createTeacher({username:env.teacherUsername,password:env.teacherPassword,name:env.teacherName});
  // 只有初始化的教师取得管理员权限，普通创建和自主注册均保持非管理员。
  db.prepare('UPDATE users SET is_admin=1 WHERE id=?').run(teacher.id);
}
export async function verifyTeacher(username,password) {
  const user=db.prepare("SELECT * FROM users WHERE role='teacher' AND username=?").get(username);
  if (!user || bcrypt.truncates(password) || !await bcrypt.compare(password,user.password_hash)) return null;
  return user;
}
