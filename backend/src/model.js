import db from './db.js';
import { publicConfig, assessmentQuestions, CONDITIONS } from '../../shared/definitions.js';
import { effectiveModelInfo } from './model-settings.js';
import { guidanceBlockedReason } from './guidance-policy.js';
import { latestGuidanceRun } from './guidance-runs.js';

export const now = () => new Date().toISOString();
export function httpError(status, message) { return Object.assign(new Error(message), { status }); }
export function getExperiment(id = 'default') {
  const row = db.prepare('SELECT * FROM experiments WHERE id=?').get(id);
  if (!row) throw httpError(404, '实验不存在');
  return { ...row, config: JSON.parse(row.config) };
}
export function getProgress(student) {
  let row = db.prepare('SELECT * FROM progress WHERE student_id=?').get(student.id);
  if (!row) {
    const { config } = getExperiment(student.experiment_id);
    const state = { rule: config.initialRule, drafts: {}, preDone: false, postDone: false, lastActivityAt: now() };
    db.prepare('INSERT INTO progress (student_id,config_snapshot,state,updated_at) VALUES (?,?,?,?)')
      .run(student.id, JSON.stringify(config), JSON.stringify(state), now());
    row = db.prepare('SELECT * FROM progress WHERE student_id=?').get(student.id);
  }
  return { ...row, config: JSON.parse(row.config_snapshot), state: JSON.parse(row.state) };
}
export function saveProgress(progress, { activity = true } = {}) {
  if (activity) progress.state.lastActivityAt = now();
  db.prepare('UPDATE progress SET state=?,stage=?,completed=?,updated_at=? WHERE student_id=?')
    .run(JSON.stringify(progress.state), progress.stage, Number(progress.completed), now(), progress.student_id);
}
export function event(studentId, stage, type, data = {}) {
  db.prepare('INSERT INTO events (student_id,stage,type,data,created_at) VALUES (?,?,?,?,?)')
    .run(studentId, stage, type, JSON.stringify(data), now());
}
export function rowsFor(table, studentId) {
  // 表名只由服务器内固定调用点传入，外部输入始终用绑定参数。
  return db.prepare(`SELECT * FROM ${table} WHERE student_id=? ORDER BY id`).all(studentId)
    .map(row => row.data ? { ...row, data: JSON.parse(row.data) } : row);
}
export function publicStudent(student) {
  return { id: student.id, userId:student.user_id, name: student.name, studentNo:student.student_no, className: student.class_name };
}
export function studentRevision(studentId) {
  // 使用已有业务事件编号同步同阶段的测评、规则和测试；草稿保存不触发整页重读。
  return db.prepare(`SELECT id FROM events WHERE student_id=? AND type IN
    ('trial_run','rule_changed','pretest_submitted','posttest_submitted','stage_submitted') ORDER BY id DESC LIMIT 1`).get(studentId)?.id ?? 0;
}
export function studentView(student) {
  const p = getProgress(student);
  const guidance=effectiveModelInfo(student.user_id,student.experiment_id);
  const condition = CONDITIONS[student.condition];
  const status = getExperiment(student.experiment_id).status;
  const trials = rowsFor('trials', student.id).map(row => {
    if (p.stage >= 2) return row;
    const { rule, ...data } = row.data;
    return { ...row, data };
  });
  return {
    student: publicStudent(student), stage: p.stage, completed: Boolean(p.completed), revision:studentRevision(student.id),
    state: { ...p.state, rule: p.stage >= 2 ? p.state.rule : null },
    config: publicConfig(p.config), status,
    trials, submissions: rowsFor('submissions', student.id).map(row => {
      if (row.kind.endsWith('test')) { const { score, ...data } = row.data; return { ...row, data }; }
      return row;
    }),
    messages: rowsFor('messages', student.id), questions: assessmentQuestions(),
    canAsk: !guidanceBlockedReason(student,p,status,'help'), guidance:latestGuidanceRun(student.id),
    proactive: condition.active, guidanceMode:guidance.provider, guidanceModel:guidance.model, guidanceSource:guidance.source,
  };
}
export function ensureWritable(student, progress) {
  if (getExperiment(student.experiment_id).status !== 'open') throw httpError(409, '实验已暂停，请等待老师继续开放。');
  if (progress.completed) throw httpError(409, '实验已完成，可查看报告。');
}
