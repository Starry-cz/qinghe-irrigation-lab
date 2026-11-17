import { useEffect, useId, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Cpu, Play, RotateCcw, Save, Trash2 } from 'lucide-react';
import { fetchJSON, post } from '../api/index.js';
import './ModelSettingsPanel.css';

const sourceLabels={platform:'平台默认',experiment:'实验默认',personal:'我的模型'};
const thinkingLabels={'':'服务商默认',disabled:'关闭',enabled:'开启'};
const normalizedUrl=value=>value.trim().replace(/\/+$/,'');
const modelName=settings=>settings.provider==='scripted'?'预设教学指导':settings.model;

function initialForm(settings) {
  return {
    mode:settings.mode,
    baseUrl:settings.custom?.baseUrl || '',
    model:settings.custom?.model || '',
    thinking:settings.custom?.thinking || '',
    apiKey:''
  };
}

function ModelDetails({settings}) {
  return <dl className="model-details">
    <div><dt>模型</dt><dd>{modelName(settings)}</dd></div>
    {settings.provider!=='scripted'&&<><div><dt>接口地址</dt><dd>{settings.baseUrl}</dd></div><div><dt>思考模式</dt><dd>{thinkingLabels[settings.thinking || '']}</dd></div></>}
  </dl>;
}

export default function ModelSettingsPanel({experimentId,onChanged}) {
  const [data,setData]=useState(null);
  const [experiment,setExperiment]=useState(null);
  const [form,setForm]=useState(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [testResult,setTestResult]=useState(null);
  const [deleteConfirm,setDeleteConfirm]=useState(false);
  const modeId=useId();
  const teacher=Boolean(experimentId);
  const experimentPath=teacher?`/admin/experiments/${encodeURIComponent(experimentId)}/model`:null;

  useEffect(()=>{
    let active=true;
    setLoading(true);setData(null);setForm(null);setExperiment(null);setError('');setNotice('');setTestResult(null);setDeleteConfirm(false);
    Promise.all([fetchJSON('/model-settings'),experimentPath?fetchJSON(experimentPath):Promise.resolve(null)])
      .then(([settings,experimentSettings])=>{if(active){setData(settings);setForm(initialForm(settings));setExperiment(experimentSettings);}})
      .catch(e=>{if(active)setError(e.message);})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[experimentPath]);

  function change(key,value) {
    setForm(current=>({...current,[key]:value}));setError('');setNotice('');setTestResult(null);setDeleteConfirm(false);
  }
  function requestBody() {
    if(form.mode==='default')return {mode:'default'};
    // 密钥仅在本次输入时发送；留空表示继续使用服务端已保存的密钥。
    return {mode:'custom',baseUrl:form.baseUrl.trim(),model:form.model.trim(),thinking:form.thinking,...(form.apiKey.trim()?{apiKey:form.apiKey.trim()}:{})};
  }
  async function refreshPersonal() {
    const result=await fetchJSON('/model-settings');
    setData(result);setForm(initialForm(result));
  }
  async function submit(e) {
    e.preventDefault();
    const action=e.nativeEvent.submitter?.value==='test'?'test':'save';
    setBusy(action);setError('');setNotice('');setTestResult(null);
    try {
      if(action==='test') {
        // 测试使用当前填写内容，不更新个人或实验的实际配置。
        setTestResult(await post('/model-settings/test',requestBody()));
      } else {
        await fetchJSON('/model-settings',{method:'PUT',body:requestBody()});
        await refreshPersonal();await onChanged?.();
        setNotice(form.mode==='custom'?(teacher?'个人模型已保存并启用，可在下方发布为当前实验默认。':'个人模型已保存并启用，下一条指导将使用此配置。'):`已切换为${teacher?'平台':'实验'}默认模型，个人配置仍保留。`);
      }
    } catch(e) { setError(e.message); } finally { setBusy(''); }
  }
  async function removePersonal() {
    setBusy('delete');setError('');setNotice('');setTestResult(null);
    try {
      await fetchJSON('/model-settings',{method:'DELETE'});
      await refreshPersonal();setDeleteConfirm(false);await onChanged?.();
      setNotice('个人模型配置已删除，当前使用默认模型。');
    } catch(e) { setError(e.message); } finally { setBusy(''); }
  }
  async function publish(source) {
    setBusy('publish');setError('');setNotice('');
    try {
      await fetchJSON(experimentPath,{method:'PUT',body:{source}});
      setExperiment(await fetchJSON(experimentPath));await onChanged?.();
      setNotice(source==='personal'?'已将保存的个人模型设为本实验默认模型。':'本实验已恢复使用平台默认模型。');
    } catch(e) { setError(e.message); } finally { setBusy(''); }
  }

  if(loading)return <p className="model-settings-loading" role="status">正在读取模型设置…</p>;
  if(!data||!form)return <p className="error-message" role="alert">{error}</p>;
  const needsKey=!data.custom?.hasKey||normalizedUrl(form.baseUrl)!==normalizedUrl(data.custom.baseUrl);
  const dirty=form.mode!==data.mode||(form.mode==='custom'&&(!data.custom||normalizedUrl(form.baseUrl)!==normalizedUrl(data.custom.baseUrl)||form.model.trim()!==data.custom.model||form.thinking!==(data.custom.thinking||'')||Boolean(form.apiKey.trim())));

  return <div className="model-settings-panel">
    <section className="model-effective" aria-label="当前生效模型">
      <div className="model-effective-title"><Cpu size={21}/><div><span>当前生效</span><strong>{modelName(data.effective)}</strong></div><span className="model-source-badge">{sourceLabels[data.effective.source]}</span></div>
      <p>{teacher?'这是你的个人调用配置，可在下方发布为当前实验默认。':'实验助理的下一条指导将使用此模型。你可以使用老师设置的默认模型，也可以使用自己的模型。'}</p>
    </section>
    {error&&<p className="error-message" role="alert">{error}</p>}
    {notice&&<div className="success-banner" role="status"><CheckCircle2 size={17}/>{notice}</div>}

    <form className="model-settings-form" onSubmit={submit}>
      <fieldset className="model-mode-fieldset" disabled={Boolean(busy)}>
        <legend>我的模型来源</legend>
        <div className="model-mode-options">
          <label className={`model-mode-choice ${form.mode==='default'?'selected':''}`}><input type="radio" name={modeId} value="default" checked={form.mode==='default'} onChange={()=>change('mode','default')}/><span><strong>使用默认模型</strong><small>{teacher?'跟随平台配置':'跟随当前实验的配置'}</small></span></label>
          <label className={`model-mode-choice ${form.mode==='custom'?'selected':''}`}><input type="radio" name={modeId} value="custom" checked={form.mode==='custom'} onChange={()=>change('mode','custom')}/><span><strong>使用自己的模型</strong><small>填写自己的接口与密钥</small></span></label>
        </div>
      </fieldset>
      {form.mode==='default'?<div className="model-default-preview"><div className="model-subheading"><strong>默认配置</strong><span>{sourceLabels[data.default.source]}</span></div><ModelDetails settings={data.default}/></div>:<div className="model-custom-fields">
        <p className="model-field-intro">支持兼容 OpenAI Chat Completions 的服务。按照服务商提供的接入信息填写。</p>
        <label>API 地址（Base URL）<input type="url" value={form.baseUrl} onChange={e=>change('baseUrl',e.target.value)} disabled={Boolean(busy)} placeholder="例如：https://api.deepseek.com" autoComplete="off" required aria-describedby={`${modeId}-url-help`}/><small id={`${modeId}-url-help`}>填写接口根地址；不要附加 /chat/completions。服务商要求 /v1 时请保留。</small></label>
        <div className="model-field-grid">
          <label>模型名称（Model ID）<input value={form.model} onChange={e=>change('model',e.target.value)} disabled={Boolean(busy)} placeholder="填写服务商提供的模型 ID" autoComplete="off" required maxLength={200}/></label>
          <label>API 密钥（API Key）<input type="password" value={form.apiKey} onChange={e=>change('apiKey',e.target.value)} disabled={Boolean(busy)} placeholder={needsKey?'输入此接口的密钥':'已保存，留空表示保持不变'} autoComplete="off" required={needsKey} aria-describedby={`${modeId}-key-help`}/><small id={`${modeId}-key-help`}>{data.custom?.hasKey&&needsKey?'接口地址已变更，请重新填写对应密钥。':'密钥保存后不会在页面回显。'}</small></label>
        </div>
        <details className="model-advanced"><summary>高级设置</summary><label>思考模式<select value={form.thinking} onChange={e=>change('thinking',e.target.value)} disabled={Boolean(busy)}><option value="">服务商默认（通用）</option><option value="disabled">关闭</option><option value="enabled">开启</option></select><small>通用服务保留默认；服务商支持该参数时再选择开启或关闭，例如 DeepSeek。</small></label></details>
      </div>}
      {dirty&&<div className="model-unsaved" role="status"><span>更改尚未保存，当前仍使用上方显示的配置。</span><button type="button" disabled={Boolean(busy)} onClick={()=>{setForm(initialForm(data));setTestResult(null);setError('');}}>恢复已保存配置</button></div>}
      {/* 保存按钮放在首位，避免输入框按回车时意外触发付费连接测试。 */}
      <div className="model-form-actions"><button className="primary" type="submit" name="action" value="save" disabled={Boolean(busy)||!dirty}><Save size={16}/>{busy==='save'?'正在保存…':'保存并启用'}</button><button className="secondary" type="submit" name="action" value="test" disabled={Boolean(busy)}><Play size={16}/>{busy==='test'?'正在测试…':form.mode==='custom'?'测试填写配置':'测试默认模型'}</button></div>
      <p className="model-test-note">测试会向所选服务发送一条简短请求，可能产生少量调用费用；测试成功不会自动保存配置。</p>
      {testResult&&<div className="model-test-result" role="status"><div><CheckCircle2 size={18}/><strong>连接测试成功</strong></div><p>测试模型：{testResult.model}</p><blockquote>{testResult.reply}</blockquote><span>{dirty?(teacher?'确认配置后，先点击“保存并启用”；发布到实验后学生才会使用。':'确认配置后，点击“保存并启用”才会应用到指导。'):'本次测试未更改已保存的配置。'}</span></div>}
    </form>

    {data.custom&&<section className="model-remove-section" aria-label="删除个人模型配置">
      {deleteConfirm?<div className="model-delete-confirm"><p>确认删除个人模型配置？删除后将使用默认模型。{teacher&&'已发布到实验的配置不受影响。'}</p><div><button type="button" className="secondary" disabled={Boolean(busy)} onClick={()=>setDeleteConfirm(false)}>取消</button><button type="button" className="model-delete-button" disabled={Boolean(busy)} onClick={removePersonal}><Trash2 size={16}/>{busy==='delete'?'正在删除…':'确认删除'}</button></div></div>:<button type="button" className="model-delete-link" disabled={Boolean(busy)} onClick={()=>{setDeleteConfirm(true);setNotice('');}}><Trash2 size={15}/>删除已保存的个人配置</button>}
    </section>}

    {teacher&&experiment&&<section className="model-experiment-section" aria-labelledby={`${modeId}-experiment-title`}>
      <div className="model-experiment-heading"><h2 id={`${modeId}-experiment-title`}>当前实验的默认模型</h2><span className="model-source-badge">{experiment.source==='teacher'?'教师指定':'平台默认'}</span></div>
      <ModelDetails settings={experiment.settings}/>
      {experiment.source==='teacher'&&<p className="model-owner">由 {experiment.ownerName} 设置</p>}
      <p className="model-experiment-description">修改后，使用默认模型的学生从下一条指导起采用此配置。学生自己的模型配置不受影响。</p>
      <div className="model-experiment-actions"><button type="button" className="secondary" disabled={Boolean(busy)||!data.custom||dirty} onClick={()=>publish('personal')}><ArrowUpRight size={17}/>将已保存的个人模型用于本实验</button><button type="button" className="secondary" disabled={Boolean(busy)||experiment.source==='platform'} onClick={()=>publish('platform')}><RotateCcw size={16}/>恢复平台默认</button></div>
      <p className="model-experiment-help">{data.custom?'发布时复制已保存的个人配置。之后修改或删除个人配置，不会改变实验使用的模型；需要再次发布才会更新。':'先填写并保存自己的模型，才能将它设置为实验默认模型。'}{dirty&&data.custom&&' 请先保存更改或恢复已保存配置，再发布到实验。'}</p>
    </section>}
  </div>;
}
