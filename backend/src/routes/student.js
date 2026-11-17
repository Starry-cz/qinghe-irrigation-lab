import { Router } from 'express';
import { z } from 'zod';
import db, { transaction } from '../db.js';
import { requireRole } from '../auth.js';
import { event, getProgress, saveProgress, studentView, studentRevision, ensureWritable, httpError, now, rowsFor } from '../model.js';
import { guide, guideAfterSave, cancelObsoleteGuidance } from '../guidance.js';
import { trialSchema, ruleSchema, stageSchemas } from '../validation.js';
import { ASSESSMENT } from '../../../shared/definitions.js';
import { effectiveModelInfo } from '../model-settings.js';
import { latestGuidanceRun } from '../guidance-runs.js';
import { guidanceBlockedReason } from '../guidance-policy.js';
import { getExperiment } from '../model.js';
import { simulate } from '../../../shared/simulation.js';
import { activitySchema, updateWorkspace } from '../activity.js';

const router = Router();
const route = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
router.use(requireRole('student'));
router.get('/state', (req, res) => { cancelObsoleteGuidance(req.student); res.json(studentView(req.student)); });

router.post('/activity', route((req,res) => {
  const p=getProgress(req.student); ensureWritable(req.student,p);
  const {stage,data,allowGuidance}=activitySchema.parse(req.body);
  if (stage!==p.stage) throw httpError(409,'阶段已变化，请刷新后继续。');
  const change=updateWorkspace(req.student,p,data);
  if (change.changed) transaction(()=>{
    saveProgress(p);
    event(req.student.id,p.stage,'workspace_changed',{changes:change.changes});
  });
  // 查看设备只更新情境；调整实验条件后的介入仍经过分组、测评与冷却检查。
  const guidanceError=change.changed && change.operation && allowGuidance?guideAfterSave(req.student,p,'operation'):null;
  res.json({workspace:p.state.workspace ?? null,guidance:latestGuidanceRun(req.student.id),guidanceError});
}));

router.post('/draft', route((req, res) => {
  const p = getProgress(req.student); ensureWritable(req.student, p);
  const { stage, data } = z.object({ stage: z.number().int(), data: z.record(z.string().max(5000)) }).parse(req.body);
  if (stage !== p.stage) throw httpError(409, '阶段已变化，请刷新后继续。');
  p.state.drafts[stage] = data;
  saveProgress(p);
  event(req.student.id, p.stage, 'draft_saved', { fields: Object.keys(data) });
  res.json({ savedAt: now() });
}));

router.post('/assessment', route((req, res) => {
  const p = getProgress(req.student); ensureWritable(req.student, p);
  const { kind, answers } = z.object({ kind: z.enum(['pretest', 'posttest']), answers: z.array(z.number().int().min(0).max(3)).length(ASSESSMENT.length) }).parse(req.body);
  if (kind === 'pretest' && (p.stage !== 0 || p.state.preDone)) throw httpError(409, '前测已完成或当前阶段不允许提交。');
  if (kind === 'posttest' && (p.stage !== 4 || p.state.postDone)) throw httpError(409, '后测已完成或当前阶段不允许提交。');
  const score = answers.reduce((n, a, i) => n + (a === ASSESSMENT[i].answer ? 1 : 0), 0);
  transaction(() => {
    db.prepare('INSERT INTO submissions (student_id,stage,kind,data,created_at) VALUES (?,?,?,?,?)')
      .run(req.student.id, p.stage, kind, JSON.stringify({ answers, score, total: ASSESSMENT.length }), now());
    p.state[kind === 'pretest' ? 'preDone' : 'postDone'] = true;
    saveProgress(p); event(req.student.id, p.stage, kind + '_submitted');
  });
  res.json(studentView(req.student));
}));

router.post('/trial', route(async (req, res) => {
  const p = getProgress(req.student); ensureWritable(req.student, p);
  if (p.stage < 1 || p.stage > 3) throw httpError(409, '当前阶段不开放实验操作。');
  const input = trialSchema.parse(req.body);
  if (input.moisture < p.config.sensorMin || input.moisture > p.config.sensorMax) throw httpError(400, '读数超出当前传感器范围。');
  const data = simulate(input, p.state.rule, p.config);
  transaction(() => {
    const inserted=db.prepare('INSERT INTO trials (student_id,stage,data,created_at) VALUES (?,?,?,?)').run(req.student.id, p.stage, JSON.stringify(data), now());
    // 测试编号由数据库产生；最新条件与正在展示的结果保持对应。
    p.state.workspace={...p.state.workspace,stage:p.stage,input,ruleDraft:null,viewStage:p.stage,viewedTrialId:Number(inserted.lastInsertRowid),updatedAt:now()};
    saveProgress(p); event(req.student.id, p.stage, 'trial_run', input);
  });
  // 重复检测只读取本阶段所需的几条记录，不随实验累计次数反复加载完整历史。
  const recent = db.prepare('SELECT data FROM trials WHERE student_id=? AND stage=? ORDER BY id DESC LIMIT ?')
    .all(req.student.id,p.stage,p.config.repeatCount).map(row=>({data:JSON.parse(row.data)}));
  const same = recent.length === p.config.repeatCount && recent.every(t =>
    ['moisture','weather','actualRain','sensorConnected','pumpConnected'].every(k => t.data.input[k] === input[k]) && JSON.stringify(t.data.rule) === JSON.stringify(data.rule));
  const mismatch = input.prediction !== 'unsure' && (input.prediction === 'irrigate') !== data.decision;
  const trigger = same ? 'repeat' : mismatch ? 'anomaly' : 'test';
  const guidanceError = guideAfterSave(req.student, p, trigger);
  res.json({ ...studentView(req.student), guidanceError });
}));

router.post('/rule', route((req, res) => {
  const p = getProgress(req.student); ensureWritable(req.student, p);
  if (p.stage !== 2) throw httpError(409, '请在优化规则阶段修改规则。');
  const rule = ruleSchema.parse(req.body);
  if (rule.threshold < p.config.sensorMin || rule.threshold > p.config.sensorMax) throw httpError(400, '阈值超出传感器范围。');
  const before = p.state.rule;
  p.state.rule = rule;
  p.state.workspace={...p.state.workspace,stage:p.stage,ruleDraft:null,updatedAt:now()};
  transaction(() => { saveProgress(p); event(req.student.id, p.stage, 'rule_changed', { before, after: rule }); });
  res.json(studentView(req.student));
}));

router.post('/advance', route(async (req, res) => {
  const p = getProgress(req.student); ensureWritable(req.student, p);
  const { stage } = z.object({ stage: z.number().int().min(0).max(4) }).parse(req.body);
  if (stage !== p.stage) throw httpError(409, '该阶段已提交，请刷新后继续。');
  const data = stageSchemas[p.stage].parse(req.body.data);
  if (p.config.assessmentEnabled && p.stage === 0 && !p.state.preDone) throw httpError(400, '请先完成知识前测。');
  if (p.config.assessmentEnabled && p.stage === 4 && !p.state.postDone) throw httpError(400, '请先完成知识后测。');
  const trials = rowsFor('trials', req.student.id).filter(t => t.stage === p.stage);
  const minimum = p.stage === 1 ? p.config.minExploreTests : p.stage === 3 ? p.config.minVerifyTests : p.stage === 2 ? 1 : 0;
  if (trials.length < minimum) throw httpError(400, `当前阶段至少需要完成${minimum}次测试。`);
  // 修改规则后必须实际测试当前版本，旧规则的测试不能替代验证。
  if (p.stage === 2 && !trials.some(t => ['threshold','skipRain','minutes'].every(k => t.data.rule[k] === p.state.rule[k]))) {
    throw httpError(400, '当前规则尚未测试，请运行一次测试后再提交。');
  }
  if (p.stage === 3) {
    const combinations = new Set(trials.map(t => `${t.data.input.moisture}/${t.data.input.weather}/${t.data.input.actualRain}`));
    if (combinations.size < Math.min(2, minimum)) throw httpError(400, '请用至少两种不同条件验证方案。');
  }
  transaction(() => {
    db.prepare('INSERT INTO submissions (student_id,stage,kind,data,created_at) VALUES (?,?,?,?,?)')
      .run(req.student.id, p.stage, 'stage', JSON.stringify(data), now());
    p.state.drafts[p.stage] = data;
    event(req.student.id, p.stage, 'stage_submitted', data);
    if (p.stage < 4) p.stage += 1; else p.completed = 1;
    // 新阶段不继承旧页面的未提交条件和回放位置。
    p.state.workspace={stage:p.stage,viewStage:p.stage,updatedAt:now()};
    saveProgress(p);
  });
  cancelObsoleteGuidance(req.student,p);
  const guidanceError = p.completed ? null : guideAfterSave(req.student, p, 'stage');
  res.json({ ...studentView(req.student), guidanceError });
}));

router.post('/help', route(async (req, res) => {
  const p = getProgress(req.student); ensureWritable(req.student, p);
  const { question, stage } = z.object({ question: z.string().trim().min(1).max(1500), stage:z.number().int().min(0).max(4).optional() }).parse(req.body);
  // 新客户端携带提问时的阶段；兼容旧客户端，同时拒绝已切换阶段的旧问题。
  if (stage !== undefined && stage !== p.stage) throw httpError(409,'实验阶段已变化，请刷新后针对当前任务重新提问。');
  saveProgress(p);
  guide(req.student, p, 'help', question);
  res.status(202).json(studentView(req.student));
}));

router.post('/heartbeat', route(async (req, res) => {
  const p = getProgress(req.student);
  cancelObsoleteGuidance(req.student,p);
  const status=getExperiment(req.student.experiment_id).status;
  const currentGuidance=()=>{
    const config=effectiveModelInfo(req.user.id,req.student.experiment_id);
    return {guidanceMode:config.provider,guidanceModel:config.model,guidanceSource:config.source,
      stage:p.stage,completed:Boolean(p.completed),revision:studentRevision(req.student.id),status,canAsk:!guidanceBlockedReason(req.student,p,status,'help'),guidance:latestGuidanceRun(req.student.id)};
  };
  // 以最近一次真实保存或操作为计时起点，后台页面不发送心跳。
  if (Date.now() - Date.parse(p.state.lastActivityAt) >= p.config.idleSeconds * 1000) {
    const guidanceError = guideAfterSave(req.student, p, 'idle');
    return res.json({ messages: rowsFor('messages', req.student.id), guidanceError,...currentGuidance() });
  }
  res.json({ messages: rowsFor('messages', req.student.id),...currentGuidance() });
}));

router.post('/event', route((req, res) => {
  const p = getProgress(req.student); ensureWritable(req.student, p);
  const body = z.object({ type: z.enum(['environment_changed','device_toggled','trial_replayed','stage_viewed']), data: z.record(z.union([z.string().max(500),z.number(),z.boolean()])) }).parse(req.body);
  event(req.student.id, p.stage, body.type, body.data); saveProgress(p);
  res.json({ ok: true });
}));

export default router;
