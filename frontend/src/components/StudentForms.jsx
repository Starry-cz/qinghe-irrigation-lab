import { useState } from 'react';
import { Plus, Save, X } from 'lucide-react';
import { fetchJSON, post } from '../api/index.js';

export function AddStudents({conditions,experimentId,onClose,onCreated}) {
  const [name,setName]=useState(''),[studentNo,setStudentNo]=useState('');
  const [className,setClassName]=useState('八年级1班'),[condition,setCondition]=useState('active-hint');
  const [batch,setBatch]=useState(''),[mode,setMode]=useState('single');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(e){
    e.preventDefault();setBusy(true);setError('');
    try{
      // 学号按文本读取，保留前导零；同一学生在多轮实验中共享用户资料。
      const students=mode==='single'?[{name,studentNo,className,condition,preScore:null}]:batch.trim().split(/\r?\n/).filter(Boolean).map(line=>{
        const [n,no,cl,score]=line.split('\t');
        return {name:n.trim(),studentNo:no?.trim() || '',className:cl?.trim() || className,condition,preScore:score?.trim()?Number(score):null};
      });
      await post('/admin/students',{experimentId,students});await onCreated();onClose();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <div className="modal-backdrop" onClick={onClose}><section className="small-modal" role="dialog" aria-modal="true" aria-labelledby="add-title" onClick={e=>e.stopPropagation()}>
    <div className="modal-heading"><h2 id="add-title">添加实验学生</h2><button className="icon-button" aria-label="关闭添加学生" onClick={onClose}><X size={20}/></button></div>
    <div className="detail-tabs"><button className={mode==='single'?'active':''} onClick={()=>setMode('single')}>单个添加</button><button className={mode==='batch'?'active':''} onClick={()=>setMode('batch')}>批量粘贴</button></div>
    <form onSubmit={submit} className="admin-form">
      {mode==='single'?<><label>学生姓名<input value={name} onChange={e=>setName(e.target.value)} required maxLength={80}/></label><label>学号<input value={studentNo} onChange={e=>setStudentNo(e.target.value)} required maxLength={80} placeholder="按原始学号填写，保留开头的0"/></label></>:<label>名单内容<textarea value={batch} onChange={e=>setBatch(e.target.value)} rows={7} required placeholder={'从Excel复制四列：姓名、学号、班级、前测成绩\n列之间使用Tab，成绩可留空。'}/><small>姓名和学号必填。学号列请使用文本格式。</small></label>}
      <label>{mode==='single'?'班级':'默认班级'}<input value={className} onChange={e=>setClassName(e.target.value)} required/></label>
      <label>初始实验条件<select value={condition} onChange={e=>setCondition(e.target.value)}>{Object.entries(conditions).map(([value,item])=><option key={value} value={value}>{item.label}</option>)}</select></label>
      <p className="muted">学生使用登记的姓名和学号登录。开始实验前可以调整分组。</p>
      {error&&<p className="error-message" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>{busy?'正在保存…':'保存学生信息'}<Plus size={16}/></button>
    </form>
  </section></div>;
}

export function EditStudent({student,onClose,onSaved}) {
  const [name,setName]=useState(student.name),[studentNo,setStudentNo]=useState(student.student_no || ''),[className,setClassName]=useState(student.class_name);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(e){e.preventDefault();setBusy(true);setError('');try{await fetchJSON('/admin/students/'+student.id,{method:'PATCH',body:{name,studentNo,className}});await onSaved();onClose();}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <div className="modal-backdrop" onClick={onClose}><form className="small-modal admin-form" role="dialog" aria-modal="true" aria-labelledby="edit-student-title" onSubmit={submit} onClick={e=>e.stopPropagation()}>
    <div className="modal-heading"><h2 id="edit-student-title">编辑学生资料</h2><button type="button" className="icon-button" aria-label="关闭编辑学生" onClick={onClose}><X size={20}/></button></div>
    <label>学生姓名<input value={name} onChange={e=>setName(e.target.value)} required maxLength={80}/></label>
    <label>学号<input value={studentNo} onChange={e=>setStudentNo(e.target.value)} required maxLength={80}/></label>
    <label>本轮实验班级<input value={className} onChange={e=>setClassName(e.target.value)} required maxLength={80}/></label>
    <p className="muted">姓名和学号会同步到该用户参加的各轮实验，已有实验成果保留。</p>
    {error&&<p className="error-message" role="alert">{error}</p>}
    <button className="primary" disabled={busy}><Save size={16}/>{busy?'保存中…':'保存资料'}</button>
  </form></div>;
}
