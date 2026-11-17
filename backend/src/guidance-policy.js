import { CONDITIONS } from '../../shared/definitions.js';

// 前后测必须独立作答；“猜想前可求助”仅在完成前测后生效。
export function guidanceBlockedReason(student, progress, status, trigger) {
  if (status !== 'open') return '实验已暂停或结束，请等待老师继续开放。';
  if (progress.completed) return '实验已完成，可查看已有指导。';
  if (progress.config.assessmentEnabled && progress.stage === 0 && !progress.state.preDone) return '请先独立完成知识前测，再继续向助理求助。';
  if (progress.config.assessmentEnabled && progress.stage === 4 && !progress.state.postDone) return '请先独立完成知识后测，再继续向助理求助。';
  if (progress.stage === 0 && !progress.config.allowHelpBeforeHypothesis) return '请先独立提交初步猜想，再向助理求助。';
  const condition = CONDITIONS[student.condition];
  if (trigger !== 'help' && !condition.active) return '本次实验仅在主动求助时提供指导。';
  if (trigger === 'help' && condition.active && !progress.config.activeCanAsk) return '本次实验由助理在适当时机提供指导。';
  return null;
}
