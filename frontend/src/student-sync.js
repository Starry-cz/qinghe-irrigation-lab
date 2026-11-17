// 心跳和操作响应可能先后返回：用持久化消息编号合并，避免旧快照抹掉新消息。
export function mergeMessages(previous = [], incoming = []) {
  const messages = new Map(previous.map(message => [message.id, message]));
  for (const message of incoming) messages.set(message.id, message);
  return [...messages.values()].sort((left, right) => left.id - right.id);
}

export function guidancePending(guidance) {
  return guidance?.status === 'queued' || guidance?.status === 'running';
}

function mergeGuidance(previous, incoming) {
  if (!previous) return incoming ?? null;
  if (!incoming || incoming.id < previous.id) return previous;
  if (incoming.id > previous.id) return incoming;
  // 同一条指导只能前进，已完成的状态不能被较早的排队或生成快照覆盖。
  if (!guidancePending(previous)) return previous;
  if (previous.status === 'running' && incoming.status === 'queued') return previous;
  return incoming;
}

export function mergeStudentSnapshot(previous, incoming) {
  if (!previous) return { ...incoming, messages: mergeMessages([], incoming.messages), guidance: incoming.guidance ?? null };
  const olderProgress = incoming.stage < previous.stage || incoming.revision < previous.revision || (previous.completed && incoming.completed === false);
  return {
    ...previous,
    ...(olderProgress ? {} : incoming),
    messages: mergeMessages(previous.messages, incoming.messages),
    guidance: mergeGuidance(previous.guidance, incoming.guidance),
  };
}
