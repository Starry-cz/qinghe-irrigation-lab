import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, ArrowRight, LogOut, BookOpen, CircleHelp, Save, CheckCircle2, Download, X, Clock3, Leaf, ClipboardList } from 'lucide-react';
import { fetchJSON, post } from '../api/index.js';
import Brand from '../components/Brand.jsx';
import LabScene from '../components/LabScene.jsx';
import Assessment from '../components/Assessment.jsx';
import GuidancePanel from '../components/GuidancePanel.jsx';
import TrialWorkspace from '../components/TrialWorkspace.jsx';
import ModelSettingsDialog from '../components/ModelSettingsDialog.jsx';
import { SlidersHorizontal } from 'lucide-react';
import { WEATHER } from '../../../shared/definitions.js';
import { guidancePending, mergeStudentSnapshot } from '../student-sync.js';
import { createDraftSaver } from '../draft-saver.js';
import { createActivitySync } from '../activity-sync.js';

const FIELDS = [
  [{name:'problem',label:'你认为系统可能存在哪些问题？',placeholder:'可以指出某条记录，也可以认为目前信息不足。'},
    {name:'variable',label:'你认为问题可能与什么有关？',type:'select'},
    {name:'reason',label:'你为什么这样认为？',placeholder:'结合你观察到的案例，简单说明理由。'}],
  [{name:'plan',label:'你准备怎样检验猜想？',placeholder:'写出要检查的变量和比较思路。'},
    {name:'evidence',label:'测试给了你什么证据？',placeholder:'结合测试记录，说明哪些现象支持或改变了你的猜想。'}],
  [{name:'reason',label:'你修改了什么，为什么这样修改？',placeholder:'把规则变化和你的测试证据联系起来。'}],
  [{name:'analysis',label:'新规则在不同条件下表现怎样？',placeholder:'引用测试编号，说明你得到了哪些结果。'},
    {name:'limitation',label:'它还有什么局限？',placeholder:'哪些情况尚未验证，或仍需要进一步考虑？'}],
  [{name:'conclusion',label:'写下你的实验结论',placeholder:'最初的问题是什么？你怎样测试、修改并验证？'},
    {name:'transfer',label:'换一种植物或环境，你会如何调整？',placeholder:'说明还需要采集什么信息，或重新验证哪些条件。'}],
];
const VARIABLE_NAMES = { moisture:'土壤湿度', weather:'天气预报', both:'两者共同作用', unsure:'暂时无法判断' };

function saveReport(data) {
  const lines = ['# 青禾灌溉实验报告','学号：'+(data.student.studentNo || '待补充'),`学生：${data.student.name}　班级：${data.student.className}`,''];
  data.config.stages.forEach(stage => {
    lines.push(`## ${stage.title}`);
    const draft = data.state.drafts[stage.id] || {};
    FIELDS[stage.id].forEach(field => lines.push(`${field.label}\n${field.name === 'variable' ? VARIABLE_NAMES[draft[field.name]] || '' : draft[field.name] || ''}\n`));
  });
  // 导出和页面都采用持久化测试编号，与助理引用的证据一一对应。
  lines.push('## 测试记录','| 编号 | 阶段 | 初始读数 | 天气 | 决策 | 供水量 | 结束读数 |','|---|---|---|---|---|---|---|');
  data.trials.forEach(t => lines.push(`|#${t.id}|${t.stage+1}|${t.data.input.moisture}|${WEATHER[t.data.input.weather]}|${t.data.decision ? '灌溉':'不灌溉'}|${t.data.waterMl} mL|${t.data.finalMoisture}|`));
  const url = URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/markdown;charset=utf-8'}));
  const a = document.createElement('a'); a.href=url; a.download='我的灌溉实验报告.md'; a.click(); URL.revokeObjectURL(url);
}

export default function StudentPage({ onLogout }) {
  const [data,setData] = useState(null);
  const [error,setError] = useState('');
  const [viewStage,setViewStage] = useState(0);
  const [draft,setDraft] = useState({});
  const [saved,setSaved] = useState('已连接');
  const [activityStatus,setActivityStatus] = useState('操作已同步');
  const [busy,setBusy] = useState(false);
  const [workspaceBusy,setWorkspaceBusy] = useState(false);
  const [modelOpen,setModelOpen] = useState(false);
  const [record,setRecord] = useState(0);
  const currentStage = useRef(0);
  const draftReady = useRef(false);
  const currentData = useRef(null);
  const snapshotVersion = useRef(0);
  const draftSaver = useRef(null);
  const activitySync = useRef(null);
  const initialViewStage=useRef(null);
  const alive = useRef(true);
  const draftEditVersion = useRef(0);
  const savedDraftVersion = useRef(0);
  const currentDraft = useRef({});
  const draftStage = useRef(0);
  useEffect(() => {
    alive.current = true;
    const saver = createDraftSaver((snapshot, signal) => fetchJSON('/student/draft', { method:'POST', body:snapshot, signal }));
    draftSaver.current = saver;
    return () => { alive.current = false; saver.dispose(); };
  }, []);
  const update = useCallback(next => {
    snapshotVersion.current += 1;
    const merged = mergeStudentSnapshot(currentData.current, next);
    if (!currentData.current || merged.stage !== currentStage.current) {
      draftSaver.current.cancelPending();
      activitySync.current?.reset(); setActivityStatus('操作已同步');
      draftEditVersion.current = 0; savedDraftVersion.current = 0;
      currentDraft.current = merged.state.drafts[merged.stage] || {}; draftStage.current = merged.stage;
      setViewStage(merged.stage); setDraft(currentDraft.current); setSaved('已同步实验记录');
      const observation=merged.config.scenarios.findIndex(item=>item.id===merged.state.workspace?.observationId);
      setRecord(observation>=0?observation:0);
    }
    currentStage.current = merged.stage;
    currentData.current = merged; setData(merged);
    if (next.guidanceError) setError(next.guidanceError);
    return merged;
  }, []);
  useEffect(() => {
    const sync=createActivitySync(async(snapshot,signal)=>{
      // 自动介入也先读取学生刚写下的思考，避免操作已更新而草稿仍是旧文本。
      await saveDraft();
      return fetchJSON('/student/activity',{method:'POST',body:snapshot,signal});
    },{
      onStatus:status=>{if(alive.current)setActivityStatus(status);},
      onError:error=>{if(alive.current)setError(error.message);},
      onSynced:next=>{
        const current=currentData.current;
        if(!alive.current || !current || next.workspace.stage!==current.stage)return;
        // 活动回包只更新操作快照与指导状态，不能覆盖正在编辑的表单。
        update({state:{...current.state,workspace:next.workspace},guidance:next.guidance,guidanceError:next.guidanceError});
      },
    });
    activitySync.current=sync;
    return ()=>sync.dispose();
  },[update]);
  const recordActivity=useCallback((patch,options)=>{
    const current=currentData.current;
    if(!current || current.completed || current.status!=='open')return;
    activitySync.current.change(current.stage,patch,options);
  },[]);
  useEffect(()=>{
    if(!data || data.completed || data.status!=='open' || initialViewStage.current===data.stage)return;
    if(data.stage===0 && data.config.assessmentEnabled && !data.state.preDone)return;
    initialViewStage.current=data.stage;
    // 首屏同步实际展示位置，不沿用刷新前的回看状态，也不因打开页面触发指导。
    recordActivity({viewStage:data.stage,
      ...(data.stage<=3?{deviceId:data.state.workspace?.deviceId || 'controller'}:{}),
      ...(data.stage===0?{observationId:data.config.scenarios[record].id}:{}),
    },{immediate:true,allowGuidance:false});
  },[data?.stage,data?.state.preDone,data?.completed,data?.status,recordActivity,record]);
  useEffect(() => {
    const controller = new AbortController();
    fetchJSON('/student/state', { signal: controller.signal }).then(next => {
      if (controller.signal.aborted) return;
      update(next); draftReady.current = true;
    }).catch(error => { if (error.name !== 'AbortError') setError(error.message); });
    return () => controller.abort();
  }, [update]);
  const pendingGuidance = guidancePending(data?.guidance);
  useEffect(() => {
    if (!data?.student.id || (data.completed && !pendingGuidance)) return;
    let active = true, inFlight = false, timer, controller;
    // 所有学生都可读取自己的指导状态；只有后端决定是否触发主动介入。
    const schedule = delay => { timer = setTimeout(poll, delay ?? (guidancePending(currentData.current?.guidance) ? 1500 : 5000)); };
    async function poll() {
      if (!active || inFlight) return;
      if (document.visibilityState !== 'visible') { schedule(); return; }
      inFlight = true;
      controller = new AbortController();
      let version = snapshotVersion.current;
      try {
        let synced=true;
        try { await activitySync.current.flush({allowGuidance:true,retryFailed:false}); }
        catch(error) {
          if(error.name==='AbortError')return;
          synced=false; setError(error.message);
        }
        if(!active)return;
        version=snapshotVersion.current;
        // 同步失败时仍读取暂停/阶段状态，但不以旧操作触发空闲指导，也不重试写入。
        const result = synced
          ? await fetchJSON('/student/heartbeat', { method:'POST', body:{}, signal:controller.signal })
          : await fetchJSON('/student/state', {signal:controller.signal});
        // 操作响应更新了页面后，丢弃此前发出的轮询，防止模型和阶段状态回退。
        if (!active || version !== snapshotVersion.current) return;
        if (result.stage !== currentData.current.stage || result.completed !== currentData.current.completed || result.revision !== currentData.current.revision) {
          const refreshed = await fetchJSON('/student/state', { signal:controller.signal });
          if (active && version === snapshotVersion.current) update(refreshed);
        } else {
          const merged = mergeStudentSnapshot(currentData.current, result);
          currentData.current = merged; setData(merged);
        }
      } catch (error) {
        if (active && version === snapshotVersion.current && error.name !== 'AbortError') setError(error.message);
      } finally {
        inFlight = false;
        if (active) schedule();
      }
    }
    function resume() {
      if (document.visibilityState === 'visible' && !inFlight) { clearTimeout(timer); schedule(0); }
    }
    schedule();
    document.addEventListener('visibilitychange', resume);
    return () => {
      active = false; clearTimeout(timer); controller?.abort();
      document.removeEventListener('visibilitychange', resume);
    };
  }, [data?.student.id, data?.completed, pendingGuidance, update]);
  async function saveDraft() {
    const current = currentData.current;
    if (!current || current.completed || draftStage.current !== current.stage || current.status !== 'open') return;
    if (draftEditVersion.current === savedDraftVersion.current) return;
    const stage = current.stage;
    const version = draftEditVersion.current;
    const saver = draftSaver.current;
    setSaved('保存中…');
    await saver.save({stage,data:currentDraft.current});
    if (alive.current && draftSaver.current === saver && currentStage.current === stage) {
      savedDraftVersion.current = Math.max(savedDraftVersion.current, version);
      if (draftEditVersion.current === version) setSaved('草稿已保存');
    }
  }
  function changeDraft(next) {
    draftEditVersion.current += 1;
    currentDraft.current = next;
    setDraft(next); setSaved('有未保存修改');
  }
  function saveError(error) {
    if (!alive.current || error.name === 'AbortError') return;
    setSaved('保存未成功'); setError(error.message);
  }
  async function syncBeforeAction() {
    // 先取消待发的自动介入，再等操作与草稿都保存；手动求助不会被这次同步抢占。
    await activitySync.current.flush({allowGuidance:false});
    await saveDraft();
  }
  useEffect(() => {
    // 提交阶段时取消待执行的自动保存，避免旧阶段草稿覆盖或报错。
    if (busy || !draftReady.current || !data || data.completed || viewStage !== data.stage || data.status !== 'open') return;
    const timer = setTimeout(() => { saveDraft().catch(saveError); },800);
    return () => clearTimeout(timer);
  },[draft,viewStage,data?.stage,busy,data?.status]);

  async function advance(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      // 已发出的草稿先完成，再提交阶段；阶段提交保存当前表单的最终版本。
      await syncBeforeAction(); await draftSaver.current.flush();
      update(await post('/student/advance',{stage:data.stage,data:draft}));setSaved('成果已保存');window.scrollTo({top:0,behavior:'smooth'});
    }
    catch(e) { setError(e.message); } finally { setBusy(false); }
  }
  async function navigateStage(stage) {
    setBusy(true);
    try {
      // 先读取目标阶段的已保存草稿，再切换页面，避免把回看内容保存到当前阶段。
      await syncBeforeAction();
      const refreshed=await fetchJSON('/student/state');
      const merged = update(refreshed);
      draftEditVersion.current = 0; savedDraftVersion.current = 0;
      currentDraft.current = merged.state.drafts[stage] || {}; draftStage.current = stage;
      setDraft(currentDraft.current); setViewStage(stage);
      recordActivity({viewStage:stage},{immediate:true});
    } catch(e) { if (e.name !== 'AbortError') setError(e.message); }
    finally { if (alive.current) setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError('');
    try {
      // 主动退出前保存最后一次输入，避免800ms自动保存尚未执行便丢失草稿。
      await syncBeforeAction(); await draftSaver.current.flush(); await onLogout();
    } catch (error) { saveError(error); }
    finally { if (alive.current) setBusy(false); }
  }
  if (!data) return <div className="page-loading">{error || '正在打开实验记录…'}</div>;
  const config = data.config;
  const current = config.stages[viewStage];
  const readonly = viewStage !== data.stage || data.completed || data.status !== 'open';
  const pretest = config.assessmentEnabled && !data.state.preDone && data.stage === 0;
  // 观察页呈现案例中记载的决策，不把静态记录误显示为正在运行的仿真。
  const selected = config.scenarios[record] || config.scenarios[0];
  return <div className="student-app">
    <header className="app-header"><Brand/><div className="header-divider"/><span className="header-context">信息科技 / 探究实验</span><div className="header-right"><span className="save-status"><CheckCircle2 size={14}/><span>{saved}<br/><small>{activityStatus}</small></span></span><span className="student-identity">{data.student.className}<b>{data.student.name}</b></span><button className="secondary model-settings-trigger" type="button" aria-label="模型设置" title="模型设置" onClick={()=>setModelOpen(true)}><SlidersHorizontal size={17}/><span>模型设置</span></button><button className="icon-button" title="退出登录" aria-label="退出登录" disabled={busy} onClick={logout}><LogOut size={18}/></button></div></header>
    <div className="lab-layout"><nav className="stage-sidebar"><div className="sidebar-kicker">本次实验</div><h2>自动灌溉<br/>探究之旅</h2><div className="progress-track"><span style={{width:`${data.completed ? 100:data.stage/5*100}%`}}/></div><p className="progress-caption">{data.completed ? '全部完成':`已完成 ${data.stage} / 5 个阶段`}</p><ol className="stage-list">{config.stages.map((stage,i) => <li key={stage.id}><button disabled={i>data.stage || busy || workspaceBusy} className={`${viewStage === i ? 'selected':''} ${i<data.stage || data.completed ? 'done':''}`} onClick={()=>navigateStage(i)}><span className="stage-number">{i<data.stage || data.completed ? <Check size={14}/>:String(i+1).padStart(2,'0')}</span><span><strong>{stage.short}</strong><small>{stage.title}</small></span>{viewStage === i && <ChevronRight size={15}/>}</button></li>)}</ol><div className="sidebar-bottom"><Leaf size={20}/><p>让证据带着你前进。</p><small>每一次尝试都有价值。</small></div></nav>
    <main className="student-main">
      {error && <div className="error-banner" role="alert"><span>{error}</span><button aria-label="关闭提示" onClick={()=>setError('')}><X size={16}/></button></div>}
      {data.status !== 'open' && <div className="notice"><Clock3 size={18}/>{data.status === 'paused' ? '老师已暂停实验，请等待继续开放。':'本次实验已结束，可以查看已有记录。'}<button className="text-button" onClick={()=>fetchJSON('/student/state').then(update).catch(e=>setError(e.message))}>刷新状态</button></div>}
      {data.completed && <div className="completion-banner"><CheckCircle2 size={28}/><div><h2>实验已完成</h2><p>你的思考、测试和改进过程已经保存。</p></div><button className="secondary" onClick={()=>saveReport(data)}><Download size={16}/>下载实验报告</button></div>}
      <div className="stage-heading"><span className="eyebrow">EXPERIMENT / {String(viewStage+1).padStart(2,'0')}</span><h1>{current.title}</h1><p>{current.description}</p></div>
      {pretest ? <Assessment questions={data.questions} kind="pretest" onUpdated={update} onError={setError} disabled={readonly}/> : <>
        {viewStage === 0 && <>
          <section className="observation"><div className="section-top"><h2><BookOpen size={18}/>校园植物角 · 运行记录</h2><span className="muted">点击记录查看设备情境</span></div><div className="record-options">{config.scenarios.map((r,i) => <button key={r.id} onClick={()=>{setRecord(i);recordActivity({observationId:r.id},{immediate:true});}} className={i === record ? 'selected':''}><span className="record-letter">{r.id}</span><span><small>土壤读数</small><b>{r.moisture}</b></span><span><small>天气预报</small><b>{WEATHER[r.weather]}</b></span><span><small>系统决策</small><b>{r.decision ? '灌溉':'不灌溉'}</b></span></button>)}</div><LabScene mode="observation" initialDeviceId={data.state.workspace?.deviceId} onDeviceSelect={id=>recordActivity({deviceId:id},{immediate:true})} decision={selected.decision} reading={selected.moisture} weather={selected.weather} pumpOn={false} fraction={config.higherMeansWetter ? (selected.moisture-config.sensorMin)/(config.sensorMax-config.sensorMin) : 1-(selected.moisture-config.sensorMin)/(config.sensorMax-config.sensorMin)}/><div className="observation-note"><CircleHelp size={17}/><span>这些决策都合理吗？先记录你的判断，不必急着找到唯一答案。<br/>当前传感器设定：读数越大表示越{config.higherMeansWetter ? '湿':'干'}。</span></div></section>
        </>}
        {viewStage >= 1 && viewStage <= 3 && viewStage === data.stage && !data.completed && <TrialWorkspace key={data.stage} data={data} onUpdated={update} onError={setError} beforeAction={syncBeforeAction} onActivity={recordActivity} onBusyChange={setWorkspaceBusy} locked={readonly || busy}/>}
        {viewStage >= 1 && viewStage <= 3 && (viewStage !== data.stage || data.completed) && <section className="past-trials"><div className="section-top"><h2>这一阶段的测试</h2><span className="muted">已保存的实验记录</span></div><div className="table-scroll"><table><thead><tr><th>编号</th><th>初始读数</th><th>天气</th><th>决策</th><th>供水量</th><th>结束读数</th></tr></thead><tbody>{data.trials.filter(t=>t.stage===viewStage).map(t=><tr key={t.id}><td className="mono">#{t.id}</td><td>{t.data.input.moisture}</td><td>{WEATHER[t.data.input.weather]}</td><td>{t.data.decision?'灌溉':'不灌溉'}</td><td>{t.data.waterMl} mL</td><td>{t.data.finalMoisture}</td></tr>)}</tbody></table></div></section>}
        <section className="task-sheet"><div className="section-top"><h2><ClipboardList size={19}/>{viewStage === 0 ? '记录你的初步猜想':'整理你的思考'}</h2><span className="muted">{readonly ? '已提交内容':'输入后自动保存草稿'}</span></div><form onSubmit={advance}>{FIELDS[viewStage].map((field,i) => <div className="task-field" key={field.name}><label htmlFor={`field-${field.name}`}><span>0{i+1}</span>{field.label}</label>{field.type === 'select' ? <select id={`field-${field.name}`} value={draft[field.name] || ''} onChange={e=>changeDraft({...draft,[field.name]:e.target.value})} required disabled={readonly || busy}><option value="" disabled>请选择你的初步判断</option>{Object.entries(VARIABLE_NAMES).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select> : <textarea id={`field-${field.name}`} value={draft[field.name] || ''} onChange={e=>changeDraft({...draft,[field.name]:e.target.value})} placeholder={field.placeholder} rows={3} maxLength={5000} required disabled={readonly || busy}/>}</div>)}{!readonly && <div className="task-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>saveDraft().catch(saveError)}><Save size={15}/>保存草稿</button><button className="primary" disabled={busy || workspaceBusy || (data.stage === 4 && config.assessmentEnabled && !data.state.postDone)}>{busy ? '提交中…' : data.stage === 4 ? '完成实验' : data.stage === 0 ? '提交初步猜想':'提交并进入下一阶段'}<ArrowRight size={16}/></button></div>}</form></section>
        {viewStage === 4 && config.assessmentEnabled && !data.state.postDone && <Assessment questions={data.questions} kind="posttest" onUpdated={update} onError={setError} disabled={readonly}/>}
        {viewStage === 4 && data.state.postDone && <div className="notice"><CheckCircle2 size={18}/>知识后测已提交。{!data.completed && '完善上方总结后，点击“完成实验”。'}</div>}
      </>}
      <footer className="workspace-footer"><span>青禾 · 物联花盆虚拟实验</span><span>所有结果以当前实验设定为准</span></footer>
    </main><ModelSettingsDialog open={modelOpen} onClose={()=>setModelOpen(false)} onChanged={()=>fetchJSON('/student/state').then(update)}/><GuidancePanel data={data} onUpdated={update} onError={setError} beforeAsk={syncBeforeAction} disabled={busy}/></div>
  </div>;
}
