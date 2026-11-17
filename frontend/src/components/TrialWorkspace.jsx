import { useEffect, useRef, useState } from 'react';
import { Play, RotateCcw, SlidersHorizontal, CloudRain, Sun, Cloud, Cable, Save, ChevronDown, Check } from 'lucide-react';
import { post } from '../api/index.js';
import LabScene from './LabScene.jsx';
import { WEATHER } from '../../../shared/definitions.js';

// 图表刻度与正文使用同一深色层级，保证浅色背景上的读数清晰。
function Chart({ trial, frame, config }) {
  if (!trial) return <div className="chart-placeholder">运行测试后，查看 30 分钟内的读数变化。</div>;
  const points = trial.series.filter(p => p.minute <= frame).map(p => `${45+p.minute/30*630},${112-(p.reading-config.sensorMin)/(config.sensorMax-config.sensorMin)*90}`).join(' ');
  return <svg viewBox="0 0 720 155" className="reading-chart" role="img" aria-label="土壤湿度读数随模拟时间变化曲线"><text x="0" y="16" fill="#506458" fontSize="12">传感器读数</text>{[0,0.5,1].map(v => <g key={v}><line x1="45" y1={112-v*90} x2="675" y2={112-v*90} stroke="#e6ebe6" strokeDasharray="3 3"/><text x="35" y={116-v*90} textAnchor="end" fill="#506458" fontSize="12">{Math.round(config.sensorMin+v*(config.sensorMax-config.sensorMin))}</text></g>)}<polyline fill="none" stroke="#357a64" strokeWidth="2.5" points={points}/>{[0,10,20,30].map(t => <text key={t} x={45+t/30*630} y="137" textAnchor="middle" fill="#506458" fontSize="12">{t} min</text>)}</svg>;
}

export default function TrialWorkspace({ data, onUpdated, onError, beforeAction, onBusyChange, onActivity, locked = false }) {
  const config = data.config;
  const workspace=data.state.workspace?.stage===data.stage?data.state.workspace:null;
  // 恢复尚未运行的设置；它与已保存测试及其回放结果分别存放。
  const [input,setInput] = useState(()=>({moisture:config.scenarios[0].moisture,weather:'sunny',actualRain:false,sensorConnected:true,pumpConnected:true,prediction:'unsure',question:'',...workspace?.input}));
  const [rule,setRule] = useState(()=>workspace?.ruleDraft || data.state.rule);
  const inputRef=useRef(input), ruleRef=useRef(rule);
  const initialSynced=useRef(false);
  const savedRule=useRef(JSON.stringify(data.state.rule));
  const [resultId,setResultId]=useState(null);
  const [result,setResult] = useState(null);
  const [frame,setFrame] = useState(0);
  const [playing,setPlaying] = useState(false);
  const [busy,setBusy] = useState(false);
  const [showTable,setShowTable] = useState(true);
  const interval = useRef(null);
  const disabled = locked || data.status !== 'open' || busy || playing;
  const ruleDirty = rule && JSON.stringify(rule) !== JSON.stringify(data.state.rule);
  const ruleValid=!rule || (Number.isInteger(rule.threshold) && rule.threshold>=config.sensorMin && rule.threshold<=config.sensorMax && Number.isInteger(rule.minutes) && rule.minutes>=1 && rule.minutes<=30);
  useEffect(()=>{
    if(!initialSynced.current && !locked && data.status==='open') {
      initialSynced.current=true;
      onActivity({input:inputRef.current,viewedTrialId:null},{immediate:true,allowGuidance:false});
    }
  },[locked,data.status,onActivity]);
  // 未保存规则或正在测试时，主页面不能提交进入下一阶段。
  useEffect(() => { onBusyChange(Boolean(busy || playing || ruleDirty)); },[busy,playing,ruleDirty,onBusyChange]);
  useEffect(() => () => onBusyChange(false),[onBusyChange]);
  // 改变实验条件后显示新的初始状态，历史结果仍保留在测试记录中。
  useEffect(() => { setResult(null); setResultId(null); setFrame(0); },[input.moisture,input.weather,input.actualRain,input.sensorConnected,input.pumpConnected]);
  useEffect(() => {
    const next=JSON.stringify(data.state.rule);
    if(savedRule.current!==next) {savedRule.current=next;ruleRef.current=data.state.rule;setRule(data.state.rule);}
  },[data.state.rule]);
  useEffect(() => () => clearInterval(interval.current),[]);
  function change(key,value,immediate=true) {
    const next={...inputRef.current,[key]:value};inputRef.current=next;setInput(next);
    // 新测试的条件、目的或预测变化后，图示回到待测试状态，不沿用旧回放。
    setResult(null); setResultId(null); setFrame(0);
    onActivity({input:next,viewedTrialId:null},{immediate});
  }
  function changeRule(key,value,immediate=false) {
    const next={...ruleRef.current,[key]:value};ruleRef.current=next;setRule(next);
    onActivity({ruleDraft:next},{immediate});
  }
  function playback(trial) {
    clearInterval(interval.current); setResult(trial); setFrame(0); setPlaying(true);
    let minute = 0;
    interval.current = setInterval(() => { minute++; setFrame(minute); if (minute >= 30) { clearInterval(interval.current); setPlaying(false); } },100);
  }
  function replay(trial,id) {
    // 回放直接展示记录内条件，不修改下一次测试的输入。
    playback(trial);
    setResultId(id);
    if (!locked) onActivity({viewedTrialId:id},{immediate:true});
  }
  async function run() {
    setBusy(true);
    try {
      await beforeAction();
      const updated = await post('/student/trial',inputRef.current);
      const latest=updated.trials.at(-1);
      onUpdated(updated); setResultId(latest.id); playback(latest.data);
    } catch(e) { onError(e.message); } finally { setBusy(false); }
  }
  async function saveRule() {
    setBusy(true);
    try { await beforeAction(); onUpdated(await post('/student/rule',ruleRef.current)); }
    catch(e) { onError(e.message); } finally { setBusy(false); }
  }
  const current = result?.series[frame];
  const sceneInput = result?.input || input;
  // 回放的读数、天气和连线状态统一来自该次记录，避免混入下一次测试的设置。
  const reading = current?.reading ?? sceneInput.moisture;
  const fraction = (reading-config.sensorMin)/(config.sensorMax-config.sensorMin);
  // 编号沿用数据库中的测试 id，保证跨阶段回看与助理引用一致。
  const trials = data.trials.filter(t => t.stage === data.stage);
  return <>
    <section className="workbench"><div className="section-top"><h2><SlidersHorizontal size={18}/>虚拟设备工作台</h2><span className={`bench-status ${playing ? 'running' : ''}`}>{playing ? `模拟时间 ${frame} / 30 min` : '可交互实验设备'}</span></div>
      <LabScene mode="experiment" initialDeviceId={workspace?.deviceId} onDeviceSelect={id=>onActivity({deviceId:id},{immediate:true})} running={playing} hasResult={Boolean(result)} decision={result?.decision ?? null} reading={reading} weather={sceneInput.weather} pumpOn={playing && current?.pumpOn} waterMl={current?.waterMl || 0} fraction={config.higherMeansWetter ? fraction:1-fraction} sensorConnected={sceneInput.sensorConnected} pumpConnected={sceneInput.pumpConnected} actualRain={sceneInput.actualRain}/>
      <div className="device-inspector"><div><strong>{result ? '下一次测试的设备连接' : '本次测试的设备连接'}</strong><p>{result ? '图示展示已保存测试的条件；下方设置用于下一次测试，不会改写已有记录。' : '点击连接按钮设置设备，运行测试后观察系统的响应。'}</p></div><div className="connection-controls"><button disabled={disabled} className={input.sensorConnected ? 'connected' : ''} onClick={() => change('sensorConnected',!input.sensorConnected)}><Cable size={14}/>探头{input.sensorConnected ? '已连接':'未连接'}</button><button disabled={disabled} className={input.pumpConnected ? 'connected' : ''} onClick={() => change('pumpConnected',!input.pumpConnected)}><Cable size={14}/>水泵{input.pumpConnected ? '已连接':'未连接'}</button></div></div>
      <div className="environment-controls"><div className="moisture-control"><label htmlFor="moisture">初始土壤读数 <strong>{input.moisture}</strong></label><input id="moisture" aria-label="初始土壤读数" type="range" min={config.sensorMin} max={config.sensorMax} step="1" value={input.moisture} disabled={disabled} onChange={e => change('moisture',Number(e.target.value),false)} onPointerUp={() => change('moisture',inputRef.current.moisture)} onKeyUp={() => change('moisture',inputRef.current.moisture)}/><div className="range-labels"><span>{config.higherMeansWetter ? '偏干':'偏湿'} {config.sensorMin}</span><span>{config.higherMeansWetter ? '偏湿':'偏干'} {config.sensorMax}</span></div></div><div className="weather-control"><label>天气预报</label><div className="weather-options">{[['sunny',Sun],['cloudy',Cloud],['rainy',CloudRain]].map(([value,Icon]) => <button key={value} disabled={disabled} className={input.weather === value ? 'selected':''} onClick={() => change('weather',value)}><Icon size={16}/>{WEATHER[value]}</button>)}</div><label className="check-label"><input type="checkbox" checked={input.actualRain} disabled={disabled} onChange={e => change('actualRain',e.target.checked)}/>测试过程中实际降雨</label></div></div>
      <div className="test-plan"><label>本次想检查什么？<input value={input.question} disabled={disabled} maxLength={1000} onChange={e => change('question',e.target.value,false)} placeholder="例如：天气改变时，系统决策会变化吗？"/></label><label>预测系统会<select value={input.prediction} disabled={disabled} onChange={e => change('prediction',e.target.value)}><option value="unsure">暂不确定</option><option value="irrigate">灌溉</option><option value="wait">不灌溉</option></select></label></div>
      <div className="bench-actions"><span>{ruleDirty ? '规则有修改，请先保存后测试' : '每次测试从设定的初始读数开始'}</span><button className="secondary" disabled={busy || playing || !result} onClick={() => replay(result,resultId)}><RotateCcw size={15}/>回放</button><button className="primary" disabled={disabled || ruleDirty} onClick={run}><Play size={16}/>{busy ? '测试与保存中…' : playing ? '模拟运行中…' : '运行一次测试'}</button></div>
      {result && <div className="result-strip"><div><span>系统决策</span><strong>{result.connected ? result.decision ? '执行灌溉':'保持待机' : '连接未完成'}</strong></div><div><span>供水量</span><strong>{result.waterMl} <small>mL</small></strong></div><div><span>结束读数</span><strong>{result.finalMoisture}</strong></div><div><span>排水量</span><strong>{result.drainageMl} <small>mL</small></strong></div></div>}
      <Chart trial={result} frame={frame} config={config}/>
    </section>
    {rule && <section className="rule-editor"><div className="section-top"><h2><SlidersHorizontal size={18}/>当前控制规则</h2><span className="muted">{data.stage === 2 ? '修改后请保存并测试':'验证阶段保持规则不变'}</span></div><div className="rule-sentence"><span>当土壤读数</span><b>{config.higherMeansWetter ? '小于':'大于'}</b><input aria-label="灌溉阈值" type="number" min={config.sensorMin} max={config.sensorMax} value={rule.threshold??''} disabled={disabled || data.stage !== 2} onChange={e => changeRule('threshold',e.target.value===''?null:Number(e.target.value))}/><span>时，灌溉</span><input aria-label="灌溉时长" type="number" min="1" max="30" value={rule.minutes??''} disabled={disabled || data.stage !== 2} onChange={e => changeRule('minutes',e.target.value===''?null:Number(e.target.value))}/><span>分钟。</span></div><div className="rule-footer"><label className="check-label"><input type="checkbox" checked={rule.skipRain} disabled={disabled || data.stage !== 2} onChange={e => changeRule('skipRain',e.target.checked,true)}/>增加条件：预报有雨时不灌溉</label>{data.stage === 2 && <button className="secondary" disabled={disabled || !ruleValid} onClick={saveRule}><Save size={15}/>保存规则</button>}</div></section>}
    <section className="trial-history"><button className="section-top history-heading" onClick={() => setShowTable(!showTable)}><h2>本阶段测试记录 <span className="count">{trials.length}</span></h2><ChevronDown size={18} className={showTable ? '' : 'rotated'}/></button>{showTable && <div className="table-scroll"><table><thead><tr><th>编号</th><th>初始读数</th><th>天气</th><th>系统决策</th><th>供水量</th><th>结束读数</th><th/></tr></thead><tbody>{trials.map(t => <tr key={t.id}><td className="mono">#{t.id}</td><td>{t.data.input.moisture}</td><td>{WEATHER[t.data.input.weather]}</td><td><span className={`decision ${t.data.decision ? 'on':''}`}>{t.data.decision ? '灌溉':'不灌溉'}</span></td><td>{t.data.waterMl} mL</td><td>{t.data.finalMoisture}</td><td><button className="text-button" disabled={playing || busy} onClick={() => replay(t.data,t.id)}>回放</button></td></tr>)}{trials.length === 0 && <tr><td colSpan="7" className="empty-row">还没有测试记录，开始你的第一次实验。</td></tr>}</tbody></table></div>}</section>
  </>;
}
