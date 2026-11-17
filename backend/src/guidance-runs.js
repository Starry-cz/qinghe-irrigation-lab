import db from './db.js';

export function latestGuidanceRun(studentId) {
  // 仅返回界面需要的状态；凭证、提示词及其他学生的数据均不进入响应。
  const row = db.prepare('SELECT id,status,stage,trigger,error,created_at,finished_at FROM guidance_runs WHERE student_id=? ORDER BY id DESC LIMIT 1').get(studentId);
  return row ? { id:row.id, status:row.status, stage:row.stage, trigger:row.trigger, error:row.error,
    createdAt:row.created_at, finishedAt:row.finished_at } : null;
}
