import { useState } from 'react';
import { ClipboardCheck, ArrowRight } from 'lucide-react';
import { post } from '../api/index.js';

export default function Assessment({ questions, kind, onUpdated, onError, disabled }) {
  const [answers,setAnswers] = useState({});
  const [busy,setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setBusy(true);
    try { onUpdated(await post('/student/assessment',{kind,answers:questions.map((_,i) => answers[i])})); }
    catch(e) { onError(e.message); } finally { setBusy(false); }
  }
  return <section className="assessment"><div className="section-heading"><ClipboardCheck size={21}/><div><h2>{kind === 'pretest' ? '开始前，了解一下' : '完成知识后测'}</h2><p>请独立作答。提交后继续实验，结果由老师查看。</p></div></div>
    <form onSubmit={submit}>{questions.map((q,i) => <fieldset key={q.id}><legend><span>0{i+1}</span>{q.question}</legend><div className="assessment-options">{q.choices.map((choice,j) => <label key={j} className={answers[i] === j ? 'selected' : ''}><input type="radio" name={`q-${i}`} value={j} checked={answers[i] === j} onChange={() => setAnswers({...answers,[i]:j})} required disabled={disabled}/><span>{String.fromCharCode(65+j)}.</span>{choice}</label>)}</div></fieldset>)}
      <button className="primary" disabled={busy || disabled}>{busy ? '正在提交…' : '提交测评'}<ArrowRight size={17}/></button>
    </form>
  </section>;
}
