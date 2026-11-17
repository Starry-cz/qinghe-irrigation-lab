import { z } from 'zod';
import db from './db.js';
import { httpError, now } from './model.js';

// 只接收实验界面的已知字段；测评答案不会通过操作同步进入指导材料。
const inputPatch = z.object({
  moisture:z.number().int(), weather:z.enum(['sunny','cloudy','rainy']), actualRain:z.boolean(),
  sensorConnected:z.boolean(), pumpConnected:z.boolean(),
  prediction:z.enum(['irrigate','wait','unsure']), question:z.string().max(1000),
}).partial().strict();
const ruleDraft = z.object({threshold:z.number().int().nullable(),minutes:z.number().int().nullable(),skipRain:z.boolean()}).strict();
export const activitySchema = z.object({
  stage:z.number().int().min(0).max(4),
  data:z.object({
    input:inputPatch.optional(), ruleDraft:ruleDraft.nullable().optional(),
    observationId:z.string().max(5000).optional(),
    deviceId:z.enum(['tank','pump','controller','driver','sensor','pot']).optional(),
    viewStage:z.number().int().min(0).max(4).optional(),
    viewedTrialId:z.number().int().positive().nullable().optional(),
  }).strict(),
  allowGuidance:z.boolean().default(true),
}).strict();

// 未保存的规则草案与已生效规则分开存放，不能将一次编辑解释成已运行的测试。
export function updateWorkspace(student, progress, data) {
  if (data.input && (progress.stage < 1 || progress.stage > 3)) throw httpError(409,'当前阶段不开放实验条件编辑。');
  if (data.ruleDraft !== undefined && progress.stage !== 2) throw httpError(409,'请在优化规则阶段编辑规则草案。');
  if (data.input?.moisture !== undefined && (data.input.moisture < progress.config.sensorMin || data.input.moisture > progress.config.sensorMax))
    throw httpError(400,'读数超出当前传感器范围。');
  if (data.viewStage !== undefined && data.viewStage > progress.stage) throw httpError(409,'尚未进入该实验阶段。');
  if (data.observationId !== undefined && !progress.config.scenarios.some(record=>record.id===data.observationId)) throw httpError(400,'观察记录不存在。');
  if (data.viewedTrialId != null && !db.prepare('SELECT id FROM trials WHERE student_id=? AND id=?').get(student.id,data.viewedTrialId))
    throw httpError(400,'测试记录不存在。');
  const previous=progress.state.workspace?.stage===progress.stage?progress.state.workspace:{stage:progress.stage};
  const changes={};
  for (const [key,value] of Object.entries(data)) {
    if (key==='input') {
      const changed=Object.fromEntries(Object.entries(value).filter(([field,next])=>previous.input?.[field]!==next));
      if (Object.keys(changed).length) changes.input=changed;
    } else if (key==='ruleDraft') {
      const same=value===null?previous.ruleDraft===null:previous.ruleDraft && ['threshold','minutes','skipRain'].every(field=>previous.ruleDraft[field]===value[field]);
      if (!same) changes.ruleDraft=value;
    } else if (previous[key]!==value) changes[key]=value;
  }
  // 编辑下一次测试的条件后退出历史结果定位；不能把新条件与旧结果当成同一次测试。
  if (changes.input) changes.viewedTrialId=null;
  if (!Object.keys(changes).length) return {changed:false,changes,operation:false};
  progress.state.workspace={...previous,...changes,...(changes.input?{input:{...previous.input,...changes.input}}:{}),updatedAt:now()};
  return {changed:true,changes,operation:Boolean(changes.input || changes.ruleDraft!==undefined)};
}

// 最近操作与证据查询均限定当前学生；只读取教学相关事件，不读取测评提交内容。
export function recentWorkspaceActions(studentId) {
  return db.prepare(`SELECT id,stage,type,data,created_at FROM events WHERE student_id=? AND type IN
    ('workspace_changed','rule_changed','trial_run','stage_viewed','environment_changed','device_toggled','trial_replayed')
    ORDER BY id DESC LIMIT 12`).all(studentId).reverse().map(row=>({...row,data:JSON.parse(row.data)}));
}
