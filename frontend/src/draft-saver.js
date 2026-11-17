function cancelledSave() {
  return Object.assign(new Error('页面或实验阶段已变化，本次保存已取消。'), { name:'AbortError' });
}

// 自动保存、手动保存和求助前保存共用同一条队列，后一份草稿不会被迟到的旧请求覆盖。
export function createDraftSaver(write) {
  let tail = Promise.resolve(), generation = 0, disposed = false, activeController = null;
  function cancelPending() {
    generation += 1;
    activeController?.abort();
  }
  return {
    save(value) {
      const capturedGeneration = generation;
      // 固定这一次调用的文本；等待期间继续输入只影响后续保存。
      const snapshot = { ...value, data:{ ...value.data } };
      const operation = tail.then(async () => {
        if (disposed || generation !== capturedGeneration) throw cancelledSave();
        const controller = new AbortController();
        activeController = controller;
        try {
          const result = await write(snapshot, controller.signal);
          if (controller.signal.aborted) throw cancelledSave();
          return result;
        } finally {
          if (activeController === controller) activeController = null;
        }
      });
      // 失败由对应调用方处理；后续明确发起的保存仍能继续，不自动重试。
      tail = operation.catch(() => {});
      return operation;
    },
    flush: () => tail,
    cancelPending,
    dispose() { disposed = true; cancelPending(); },
  };
}
