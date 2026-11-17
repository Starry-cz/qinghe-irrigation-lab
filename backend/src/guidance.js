import db, { transaction } from './db.js';
import PQueue from 'p-queue';
import { CONDITIONS, WEATHER } from '../../shared/definitions.js';
import { now, event, httpError, getExperiment, getProgress } from './model.js';
import { resolveModelConfig, effectiveModelInfo } from './model-settings.js';
import { requestModelResult } from './model-client.js';
import { env } from './config.js';
import { buildGuidancePrompt } from './guidance-context.js';
import { guidanceBlockedReason } from './guidance-policy.js';
import { latestGuidanceRun } from './guidance-runs.js';
import { getGuidanceEvidence } from './guidance-evidence.js';
import { recentWorkspaceActions } from './activity.js';

for (const value of [env.aiMaxConcurrent,env.aiQueueLimit,env.aiQueueWaitMs]) {
  if (!Number.isSafeInteger(value) || value<1) throw new Error('智能体并发、排队容量与等待时间必须为正整数。');
}
// 直接复用 p-queue 的并发和取消能力；完整研究记录留在 SQLite，队列不保存密钥。
const queue = new PQueue({concurrency:env.aiMaxConcurrent});
const running = new Map();
db.prepare("UPDATE guidance_runs SET status='failed',error=?,finished_at=? WHERE status IN ('queued','running')")
  .run('服务已重启，上次指导未完成，请重新发起求助。',now());
export function scriptedGuidance({ detailed, stage, trigger, question, latest, workspace }) {
  const input=workspace?.input;
  const context = trigger==='operation' ? input?.moisture!==undefined && input?.weather ? `你当前设置了读数${input.moisture}、${WEATHER[input.weather]}；这些是待测试条件，还不是新的实验结果。` : '你刚调整了实验设置；保存的规则与编辑中的草案需要分别判断。' : latest ? `最近一次已保存测试的条件是读数${latest.input.moisture}、${WEATHER[latest.input.weather]}，系统${latest.decision ? '执行了灌溉' : '没有灌溉'}。` : '';
  let topic = 'test';
  if (trigger === 'anomaly') topic = 'anomaly';
  else if (trigger === 'repeat') topic = 'repeat';
  else if (trigger === 'operation') topic = 'operation';
  else if (/天气|下雨|降雨|预报/.test(question)) topic = 'weather';
  else if (/湿度|传感器|读数/.test(question)) topic = 'sensor';
  else if (/规则|阈值|修改/.test(question) || stage === 2) topic = 'rule';
  else if (stage >= 3) topic = 'evidence';
  const hints = {
    test: '先明确你想检查哪个变量，再想一想：怎样的两次测试更容易比较？',
    anomaly: '实际结果与你测试前的预测不同。你能指出不同在哪里，并寻找能区分两种解释的证据吗？',
    repeat: '最近几次测试的条件相同。下一次改变哪个条件，可能帮助你获得新的证据？',
    operation:'这次调整想检验什么猜想？运行之前，可以先写下预测，再用结果检查自己的判断。',
    weather: '天气预报与实际降雨是同一件事吗？观察它们分别可能影响系统的哪个环节。',
    sensor: '先查看实验中的读数说明，再比较不同读数下的系统决策。注意传感器负责采集什么信息。',
    rule: '你准备改动哪个判断条件？先写出修改理由，再用之前的记录检验它。',
    evidence: '你的结论能对应到哪些测试编号？还有哪种条件尚未被这些证据覆盖？',
  };
  const detailedTexts = {
    test: '测试的作用是用可比较的结果检查猜想。如果一次同时改动多个条件，即使结果变化，也难以判断是哪一个因素造成的。可以先说明本次要研究的变量，再对照记录中的输入与输出，考虑是否还需要另一组证据。具体测试条件由你选择。',
    anomaly: '预测与实际结果不一致，是重新审视猜想的证据，而不必立即认定某个变量就是原因。可以分别检查输入条件、设备连接和系统输出，找出原有解释不能覆盖的部分。接着思考还需要什么证据来支持或修正解释。最终判断需要由你的测试来支持。',
    repeat: '在规则、输入条件和连接状态都相同的情况下，这个仿真会得到相同结果。继续重复通常不会增加区分不同解释的信息。你可以先回顾已有证据，找出尚未检验的因素，再说明为什么下一次测试能帮助回答问题。',
    operation:'条件设置只是接下来准备怎样测试，不能直接证明系统会怎样运行。可以先说明这次调整与原有猜想的联系，检查还有哪些条件同时变化，再留下你的预测。若修改的是规则草案，保存后还需要测试新规则，已有测试仍对应它们运行时的条件和规则。',
    weather: '天气预报是控制器可使用的信息，实际降雨则会影响土壤水分；预报有雨并不等于此刻已经下雨。分析时需要区分“系统怎样作决定”和“土壤随后怎样变化”。把这两类现象与已有记录联系起来，可以帮助你判断现有规则是否充分考虑了情境。',
    sensor: '传感器把土壤状态转换成可读取的数据，控制器再依据规则决定是否启动水泵。读数大小的含义取决于当前实验的标定设置，不能脱离说明直接判断。比较记录时，可以把传感器输入、控制决策和灌溉后的读数变化分别列出，再分析它们的联系。',
    rule: '控制规则描述的是“在什么条件下采取什么动作”。修改阈值会改变哪些读数触发灌溉，加入天气条件会改变不同天气下的判断，灌溉时长则影响执行后的水量。每次修改都应有对应证据，并检验它是否对未参与修改的其他情境也适用。最终条件和数值由你确定。',
    evidence: '一个有证据支持的解释，需要把结论、测试条件和观察结果连接起来。成功的一个案例只能说明方案在该条件下可行；不同读数、天气或连接状态可能呈现不同结果。整理已验证与尚未验证的范围，有助于说明方案的适用条件和局限。',
  };
  return `${context}${context ? '\n\n' : ''}${detailed ? detailedTexts[topic] : hints[topic]}`;
}

function finishJob(job,status,error=null) {
  if (job.terminal) return;
  job.terminal=true;
  clearTimeout(job.waitTimer);
  const finished=Date.now();
  db.prepare('UPDATE guidance_runs SET status=?,error=?,finished_at=?,queue_ms=?,duration_ms=? WHERE id=?')
    .run(status,error,now(),(job.startedAt||finished)-job.createdAt,job.startedAt?finished-job.startedAt:0,job.id);
  if (status!=='succeeded') event(job.student.id,job.stage,status==='failed'?'guidance_error':'guidance_cancelled',
    {runId:job.id,trigger:job.trigger,...job.metadata,reason:error});
}

// 阶段推进、进入独立测评或教师暂停时，中止旧调用，不能把迟到答案带到新任务。
export function cancelObsoleteGuidance(student,progress=getProgress(student)) {
  const job=running.get(student.id);
  if (!job) return;
  if (job.stage!==progress.stage || guidanceBlockedReason(student,progress,getExperiment(student.experiment_id).status,job.trigger)) {
    finishJob(job,'cancelled','实验阶段或开放状态已变化，上一条指导已停止。');
    job.controller.abort(new Error('guidance-cancelled'));
    running.delete(student.id);
  }
}

export function cancelExperimentGuidance(experimentId) {
  for (const job of running.values()) if (job.student.experiment_id===experimentId) cancelObsoleteGuidance(job.student);
}

function skipAutomatic(student,progress,trigger,reason) {
  // 测试等离散事件只留一次跳过原因，便于核对四组实际介入剂量；不为每次空闲轮询灌日志。
  if (trigger!=='idle') event(student.id,progress.stage,'guidance_skipped',
    {trigger,reason,activeRunId:running.get(student.id)?.id ?? null});
  return null;
}

export function guide(student,progress,trigger,question='') {
  cancelObsoleteGuidance(student,progress);
  const help=trigger==='help';
  const blocked=guidanceBlockedReason(student,progress,getExperiment(student.experiment_id).status,trigger);
  if (blocked) { if(help) throw httpError(409,blocked); return skipAutomatic(student,progress,trigger,blocked); }
  if (running.has(student.id)) { if(help) throw httpError(409,'上一条指导正在生成，请稍候。'); return skipAutomatic(student,progress,trigger,'上一条指导尚未完成，本次不叠加介入。'); }
  if (!help) {
    const previous=db.prepare("SELECT created_at FROM messages WHERE student_id=? AND role='assistant' ORDER BY id DESC LIMIT 1").get(student.id);
    const repeated=db.prepare("SELECT id FROM messages WHERE student_id=? AND stage=? AND trigger=? AND role='assistant' LIMIT 1").get(student.id,progress.stage,trigger);
    // 自动指导失败后也留出间隔，心跳不能每隔几秒反复调用付费服务。
    const failed=db.prepare("SELECT created_at FROM guidance_runs WHERE student_id=? AND stage=? AND trigger=? AND status='failed' ORDER BY id DESC LIMIT 1").get(student.id,progress.stage,trigger);
    if (repeated) return skipAutomatic(student,progress,trigger,'本阶段同类自动指导已提供。');
    if (previous && Date.now()-Date.parse(previous.created_at)<progress.config.cooldownSeconds*1000)
      return skipAutomatic(student,progress,trigger,'尚在教学介入冷却期。');
    if (failed && Date.now()-Date.parse(failed.created_at)<Math.max(30,progress.config.cooldownSeconds)*1000)
      return skipAutomatic(student,progress,trigger,'上次同类自动指导失败，尚在重试间隔内。');
  }
  if (queue.size>=env.aiQueueLimit) { if(help) throw httpError(429,'当前求助较多，请稍后再发送。'); return skipAutomatic(student,progress,trigger,'指导等待队列已满。'); }
  const metadata=effectiveModelInfo(student.user_id,student.experiment_id);
  const job={student,stage:progress.stage,trigger,metadata,createdAt:Date.now(),startedAt:null,controller:new AbortController(),terminal:false};
  let userMessageId=null;
  transaction(()=>{
    if(help) userMessageId=Number(db.prepare('INSERT INTO messages(student_id,stage,role,content,trigger,provider,model,model_source,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(student.id,progress.stage,'user',question,trigger,metadata.provider,metadata.model,metadata.source,now()).lastInsertRowid);
    job.id=Number(db.prepare("INSERT INTO guidance_runs(student_id,stage,trigger,status,provider,model,model_source,user_message_id,created_at) VALUES (?,?,?,'queued',?,?,?,?,?)")
      .run(student.id,progress.stage,trigger,metadata.provider,metadata.model,metadata.source,userMessageId,now()).lastInsertRowid);
  });
  running.set(student.id,job);
  let config;
  try {
    // 受理时固定模型来源；实验状态在实际开始生成时读取，避免排队造成上下文过时。
    config=resolveModelConfig(student.user_id,student.experiment_id);
  } catch(error) {
    finishJob(job,'failed',error.status?error.message:'指导暂不可用，请稍后重试。');running.delete(student.id);
    return latestGuidanceRun(student.id);
  }
  job.waitTimer=setTimeout(()=>{
    finishJob(job,'failed','等待指导超时，请稍后重新求助。');
    job.controller.abort(new Error('queue-wait-timeout'));
  },env.aiQueueWaitMs);
  // HTTP只返回任务已受理；模型工作留在有界队列中，不阻塞仿真与成果保存。
  void queue.add(async()=>{
    clearTimeout(job.waitTimer);
    const current=getProgress(student);
    cancelObsoleteGuidance(student,current);
    if(job.terminal) return;
    const evidence=getGuidanceEvidence(db,student.id,question);
    const trials=evidence.recentTrials;
    const history=db.prepare('SELECT role,content,stage,trigger FROM messages WHERE student_id=? ORDER BY id DESC LIMIT 12').all(student.id).reverse();
    const prompt=buildGuidancePrompt({student,progress:current,trigger,question,history,...evidence,recentActions:recentWorkspaceActions(student.id)});
    db.prepare('UPDATE guidance_runs SET prompt_version=?,context_chars=? WHERE id=?').run(prompt.promptVersion,prompt.contextChars,job.id);
    job.startedAt=Date.now();
    db.prepare("UPDATE guidance_runs SET status='running',started_at=?,queue_ms=? WHERE id=?").run(now(),job.startedAt-job.createdAt,job.id);
    const condition=CONDITIONS[student.condition];
    let result;
    if(config.provider==='scripted') result={content:scriptedGuidance({detailed:condition.detailed,stage:current.stage,trigger,question,latest:trials.at(-1)?.data,workspace:current.state.workspace}),inputTokens:null,outputTokens:null};
    else {
      event(student.id,progress.stage,'model_request',{runId:job.id,...metadata,promptVersion:prompt.promptVersion,thinking:config.thinking||'default',contextChars:prompt.contextChars});
      result=await requestModelResult(config,prompt.messages,{maxTokens:condition.detailed?700:220,signal:job.controller.signal});
    }
    cancelObsoleteGuidance(student);
    if(job.terminal) return;
    transaction(()=>{
      const inserted=db.prepare('INSERT INTO messages(student_id,stage,role,content,trigger,provider,model,model_source,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(student.id,progress.stage,'assistant',result.content,trigger,config.provider,config.model,config.source,now());
      db.prepare('UPDATE guidance_runs SET input_tokens=?,output_tokens=? WHERE id=?').run(result.inputTokens,result.outputTokens,job.id);
      finishJob(job,'succeeded');
      event(student.id,progress.stage,'guidance',{runId:job.id,trigger,...metadata,messageId:Number(inserted.lastInsertRowid),
        promptVersion:prompt.promptVersion,queueMs:job.startedAt-job.createdAt,durationMs:Date.now()-job.startedAt,inputTokens:result.inputTokens,outputTokens:result.outputTokens});
    });
  // 四组使用同一先进先出队列，不给某种实验条件额外的响应优先级。
  },{signal:job.controller.signal,id:String(job.id)}).catch(error=>{
    if(!job.terminal) finishJob(job,'failed',error.status?error.message:'指导暂不可用，请稍后重试。');
  }).finally(()=>{
    clearTimeout(job.waitTimer);
    if(running.get(student.id)===job) running.delete(student.id);
  });
  return latestGuidanceRun(student.id);
}

// 自动指导的失败不能撤销已提交成果，也不能偷偷换模型或换反馈条件。
export function guideAfterSave(student,progress,trigger) {
  try { guide(student,progress,trigger); return null; }
  catch(error) { return error.status?error.message:'指导暂不可用，实验结果已保存。'; }
}

export async function stopGuidance() {
  queue.pause();
  for(const job of running.values()) {
    finishJob(job,'failed','服务已重启，上次指导未完成，请重新发起求助。');
    job.controller.abort(new Error('server-stopping'));
  }
  await queue.onIdle();
}

