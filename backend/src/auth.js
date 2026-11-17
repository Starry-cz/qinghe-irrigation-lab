import { randomBytes } from 'node:crypto';
import db from './db.js';
import { env } from './config.js';
import { now, httpError } from './model.js';
import { publicUser } from './users.js';

const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: env.secureCookie, path: '/', maxAge: 12 * 60 * 60 * 1000 };
// 使用随机会话码和服务端会话表；教师密钥不下发到网页。
export function createSession(res, role, userId, studentId = null) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now());
  db.prepare('INSERT INTO sessions (token,role,user_id,student_id,expires_at) VALUES (?,?,?,?,?)')
    .run(token, role, userId, studentId, new Date(Date.now() + cookieOptions.maxAge).toISOString());
  res.cookie('qinghe_session', token, cookieOptions);
}
export function getSession(req) {
  const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('qinghe_session='));
  if (!cookie) return null;
  const token = cookie.slice('qinghe_session='.length);
  // 每次恢复会话都核对审核状态，已有会话不能绕过当前账号资格。
  return db.prepare(`SELECT s.* FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token=? AND s.expires_at>? AND u.status='approved' AND u.role=s.role`).get(token, now()) || null;
}
export function requireRole(role) {
  return (req, res, next) => {
    const session = getSession(req);
    if (!session || (role && session.role !== role)) return next(httpError(401, '请先登录对应账号。'));
    req.session = session;
    req.user = publicUser(session.user_id);
    if (session.role === 'student') req.student = db.prepare('SELECT s.*,u.student_no FROM students s JOIN users u ON u.id=s.user_id WHERE s.id=?').get(session.student_id);
    next();
  };
}
// 个人模型设置允许两种已批准身份登录后访问，用户id始终取服务端会话。
export const requireLogin=requireRole();
// 教师的教学权限与管理员的账号审核权限分别校验。
export function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) return next(httpError(403,'仅管理员可以执行此操作。'));
  next();
}
export function logout(req, res) {
  const session = getSession(req);
  if (session) db.prepare('DELETE FROM sessions WHERE token=?').run(session.token);
  res.clearCookie('qinghe_session', { path: '/' });
  res.json({ ok: true });
}
