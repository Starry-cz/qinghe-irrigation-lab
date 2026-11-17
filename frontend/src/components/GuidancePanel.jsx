import { useEffect, useRef, useState } from 'react';
import { Bot, Send, MessageCircle, Sparkles } from 'lucide-react';
import { post } from '../api/index.js';
import { guidancePending } from '../student-sync.js';

export default function GuidancePanel({ data, onUpdated, onError, beforeAsk, disabled = false }) {
  const [question,setQuestion] = useState('');
  const [busy,setBusy] = useState(false);
  const messageList = useRef(null);
  const questionInput = useRef(null);
  const sending = useRef(false);
  const pending = guidancePending(data.guidance);
  const working = busy || pending;
  // 只滚动对话容器，避免历史消息或新提示把整个实验页面拉到下方。
  useEffect(() => { messageList.current.scrollTop = messageList.current.scrollHeight; },[data.messages.length,working,data.guidance?.status]);
  const available = !disabled && data.canAsk && !data.completed && data.status === 'open';
  const independentAssessment = data.config.assessmentEnabled && ((data.stage === 0 && !data.state.preDone) ? '前测' : (data.stage === 4 && !data.state.postDone) ? '后测' : null);
  const failed = data.guidance?.status === 'failed' && data.guidance.stage === data.stage;
  const lastQuestion = data.messages.findLast(message => message.role === 'user' && message.stage === data.guidance?.stage);
  async function send(e) {
    e.preventDefault(); if (!question.trim() || !available || working || sending.current) return;
    sending.current = true; setBusy(true);
    try {
      // 把学生刚写的实验思考保存后再提问，指导能读取最新草稿。
      await beforeAsk();
      onUpdated(await post('/student/help',{question,stage:data.stage})); setQuestion('');
    }
    catch(e) { if (e.name !== 'AbortError') onError(e.message); } finally { sending.current = false; setBusy(false); }
  }
  function editQuestion() {
    setQuestion(lastQuestion.content);
    questionInput.current.focus();
  }
  return <aside className="guidance-panel">
    <div className="assistant-header"><span className="assistant-avatar"><Bot size={22}/></span><div><h2>实验助理</h2><span className="guidance-model-name">{data.guidanceMode === 'scripted' ? '预设教学指导' : data.guidanceModel}</span><span className="guidance-model-source">{{platform:'平台默认',experiment:'教师为本实验设置',personal:'我的模型'}[data.guidanceSource]}</span></div><span className="live-dot"/></div>
    <div className="guidance-intro"><Sparkles size={14}/><span>帮助你思考，留给你发现。</span></div>
    <div className="message-list" ref={messageList} aria-live="polite">
      {data.messages.length === 0 && <div className="assistant-empty"><MessageCircle size={32} strokeWidth={1.3}/><p>{independentAssessment ? `请先独立完成知识${independentAssessment}。` : data.stage === 0 && !data.canAsk ? '先独立完成你的初步猜想。' : '你的实验思考，可以从这里继续。'}</p><small>{independentAssessment ? '测评期间暂不提供实验指导。' : data.stage === 0 && !data.canAsk ? '提交后开放指导。' : available ? '遇到问题时，在下方描述你的疑问。' : '助理会在适当时机提供指导。'}</small></div>}
      {data.messages.map(m => <div key={m.id} className={`message ${m.role}`}><div className="message-meta">{m.role === 'assistant' ? '实验助理' : '我的问题'}<time>{new Date(m.created_at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time></div><span className="message-stage">{data.config.stages[m.stage]?.short || `阶段 ${m.stage+1}`}</span><p>{m.content}</p></div>)}
      {working && <div className="message assistant guidance-progress" role="status"><p className="typing">{busy ? '正在提交问题' : data.guidance.status === 'queued' ? '正在等待指导' : '正在整理指导'}<span>…</span></p><small>{data.status === 'open' && !data.completed ? '可以继续记录思考和操作实验。' : '指导状态将自动更新。'}</small></div>}
      {failed && !working && <div className="guidance-failure" role="alert"><strong>这次指导未能生成</strong><p>{data.guidance.error || '请稍后重新提问。'}</p>{available && data.guidance.trigger === 'help' && lastQuestion && data.guidance.stage === data.stage && <button type="button" className="text-button" onClick={editQuestion}>重新编辑这个问题</button>}</div>}
    </div>
    <form className="chat-form" onSubmit={send}><label htmlFor="help-question" className="sr-only">向实验助理提问</label><textarea ref={questionInput} id="help-question" value={question} onChange={e => setQuestion(e.target.value)} rows={3} maxLength={1500} disabled={!available || working} placeholder={data.completed ? '实验已完成，可回看指导记录' : working ? '指导生成中，请稍候…' : available ? '描述你的发现或疑问…' : '当前阶段暂未开放求助'}/><div><small>{working ? '指导完成后可继续提问' : available ? '围绕当前实验提出问题' : '继续完成当前实验任务'}</small><button type="submit" aria-label="发送问题" disabled={!available || working || !question.trim()}><Send size={17}/></button></div></form>
  </aside>;
}
