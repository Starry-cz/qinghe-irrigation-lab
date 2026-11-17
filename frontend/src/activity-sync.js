function cancelledActivity() {
  return Object.assign(new Error('实验阶段已变化，本次操作同步已取消。'), {name:'AbortError'});
}

// 连续编辑合并为当前状态，所有写入串行；求助前可等待最新版本落库。
export function createActivitySync(write, {delay=500,onStatus=()=>{},onSynced=()=>{},onError=()=>{}}={}) {
  let stage, latest={}, revision=0, savedRevision=0, generation=0, disposed=false;
  let timer, inFlight=null, controller=null, activeSnapshot=null, failure=null, suppressGuidance=0;
  function begin(allowGuidance) {
    const version=revision, capturedGeneration=generation;
    const snapshot={stage,data:structuredClone(latest),allowGuidance:allowGuidance && suppressGuidance===0};
    activeSnapshot=snapshot;
    const requestController=new AbortController(); controller=requestController;
    onStatus('正在同步操作…');
    const operation=Promise.resolve().then(()=>write(snapshot,requestController.signal)).then(result=>{
      if(disposed || capturedGeneration!==generation || requestController.signal.aborted) throw cancelledActivity();
      savedRevision=version; failure=null;
      if(savedRevision===revision) latest={};
      onSynced(result);
      onStatus(savedRevision===revision?'操作已同步':'正在同步操作…');
    }).catch(error=>{
      if(!disposed && capturedGeneration===generation && error.name!=='AbortError') {
        failure={error,version}; onStatus('操作同步未成功');
      }
      throw error;
    }).finally(()=>{
      if(inFlight===operation) inFlight=null;
      if(controller===requestController) controller=null;
      if(activeSnapshot===snapshot) activeSnapshot=null;
    });
    inFlight=operation;
    return operation;
  }
  async function flush({allowGuidance=false,retryFailed=true}={}) {
    clearTimeout(timer);
    if(disposed) throw cancelledActivity();
    const capturedGeneration=generation;
    if(!allowGuidance) {
      suppressGuidance+=1;
      // 自动同步可能仍在等待草稿保存；实际发出前可降为只保存，让手动求助优先。
      if(activeSnapshot) activeSnapshot.allowGuidance=false;
    }
    try {
      while(inFlight || savedRevision<revision) {
        if(disposed || capturedGeneration!==generation) throw cancelledActivity();
        if(inFlight) await inFlight;
        else {
          // 心跳不会悄悄重试失败请求；新编辑或明确的求助/保存才可重新同步。
          if(!retryFailed && failure && failure.version===revision) throw failure.error;
          await begin(allowGuidance);
        }
      }
    } finally { if(!allowGuidance) suppressGuidance-=1; }
  }
  function reset() {
    generation+=1; clearTimeout(timer); controller?.abort();
    controller=null; inFlight=null; activeSnapshot=null;
    stage=undefined; latest={}; revision=0; savedRevision=0; failure=null;
  }
  return {
    change(nextStage,patch,{immediate=false,allowGuidance=true}={}) {
      if(disposed) return;
      if(stage!==undefined && stage!==nextStage) reset();
      stage=nextStage;
      latest={...latest,...structuredClone(patch),...(patch.input?{input:{...latest.input,...patch.input}}:{})};
      revision+=1; onStatus('正在同步操作…'); clearTimeout(timer);
      // 离散操作在当前事件结束后发送，文本输入停顿500ms后合并发送。
      timer=setTimeout(()=>{flush({allowGuidance,retryFailed:false}).catch(error=>{if(error.name!=='AbortError')onError(error);});},immediate?0:delay);
    },
    flush,
    reset,
    dispose() { disposed=true; reset(); },
  };
}
