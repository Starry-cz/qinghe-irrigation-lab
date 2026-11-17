import { useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, ClipboardCheck, RefreshCw, Search, X } from 'lucide-react';
import { fetchJSON, post } from '../api/index.js';
import './RegistrationPanel.css';

const statusLabels = { pending:'待审核', approved:'已通过', rejected:'未通过' };
const filters = [['pending','待审核'],['approved','已通过'],['rejected','未通过'],['all','全部申请']];
const formatTime = value => new Date(value).toLocaleString('zh-CN');

export default function RegistrationPanel({ experiments, conditions, experimentId, onChanged }) {
  const [status,setStatus] = useState('pending');
  const [role,setRole] = useState('all');
  const [query,setQuery] = useState('');
  const [data,setData] = useState(null);
  const [selected,setSelected] = useState([]);
  const [review,setReview] = useState(null);
  const [targetExperiment,setTargetExperiment] = useState('');
  const [condition,setCondition] = useState('');
  const [reviewNote,setReviewNote] = useState('');
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const reviewHeading = useRef(null);

  useEffect(() => {
    let active = true;
    setLoading(true);setError('');setSelected([]);setReview(null);
    fetchJSON(`/admin/registrations?status=${status}`).then(result => {
      if(active)setData(result);
    }).catch(e => { if(active)setError(e.message); }).finally(() => { if(active)setLoading(false); });
    return () => { active=false; };
  },[status]);

  // 审核表单只由用户点击打开；父页面的定时刷新不会清空填写内容。
  useEffect(() => { if(review)reviewHeading.current?.focus(); },[review]);

  async function refresh() {
    setLoading(true);setError('');
    try {
      const result=await fetchJSON(`/admin/registrations?status=${status}`);
      setData(result);
      setSelected(ids=>ids.filter(id=>result.requests.some(item=>item.id===id&&item.status!=='approved')));
    } finally { setLoading(false); }
  }
  function clearSelection() { setSelected([]);setReview(null); }
  function changeStatus(value) { setStatus(value);setNotice(''); }
  function toggle(id) { setSelected(ids=>ids.includes(id)?ids.filter(item=>item!==id):[...ids,id]);setReview(null); }
  function beginReview(ids,action) {
    setReview({ids,action});setCondition('');setReviewNote('');setError('');setNotice('');
    setTargetExperiment(experiments.some(item=>item.id===experimentId&&item.status==='open')?experimentId:'');
  }

  const requests=data?.requests || [];
  const filtered=requests.filter(item=>(role==='all'||item.role===role)&&`${item.name} ${item.username || ''} ${item.student_no || ''} ${item.class_name || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selectable=filtered.filter(item=>item.status!=='approved');
  const selectedRequests=requests.filter(item=>selected.includes(item.id));
  const reviewRequests=review?requests.filter(item=>review.ids.includes(item.id)):[];
  const studentCount=reviewRequests.filter(item=>item.role==='student').length;
  const teacherCount=reviewRequests.length-studentCount;
  const allSelected=selectable.length>0&&selectable.every(item=>selected.includes(item.id));
  const openExperiments=experiments.filter(item=>item.status==='open');

  async function submit(e) {
    e.preventDefault();setBusy(true);setError('');setNotice('');
    try {
      const result=await post('/admin/registrations/review',{
        ids:review.ids,action:review.action,reviewNote:reviewNote.trim(),
        ...(review.action==='approve'&&studentCount?{experimentId:targetExperiment,condition}:{})
      });
      setNotice(`已${review.action==='approve'?'通过':'退回'} ${result.reviewed} 份注册申请。`);
      setReview(null);setSelected([]);
      await refresh();await onChanged();
    } catch(e) { setError(e.message); } finally { setBusy(false); }
  }

  return <section className="registration-panel" aria-label="注册申请审核">
    <p className="registration-intro">学生和教师可在登录页提交注册申请。由管理员核对身份，通过后即可登录；学生的实验报名会同时建立。</p>
    <div className="registration-status-filters" aria-label="按审核状态筛选">
      {filters.map(([value,label])=><button key={value} type="button" aria-pressed={status===value} className={status===value?'active':''} onClick={()=>changeStatus(value)} disabled={busy}>
        {label}<span>{data?(value==='all'?Object.values(data.counts).reduce((sum,n)=>sum+n,0):data.counts[value]):'—'}</span>
      </button>)}
    </div>
    <div className="registration-toolbar">
      <div className="search-input"><Search size={17}/><input aria-label="搜索注册申请" placeholder="搜索姓名、账号、学号或班级" value={query} disabled={busy} onChange={e=>{setQuery(e.target.value);clearSelection();}}/></div>
      <label className="registration-role-filter"><span className="sr-only">申请身份</span><select aria-label="申请身份" value={role} disabled={busy} onChange={e=>{setRole(e.target.value);clearSelection();}}><option value="all">全部身份</option><option value="student">学生</option><option value="teacher">教师</option></select></label>
      <button type="button" className="secondary" onClick={()=>{setReview(null);refresh().catch(e=>setError(e.message));}} disabled={busy||loading}><RefreshCw size={16}/>{loading?'读取中…':'刷新申请'}</button>
    </div>
    {error&&<p className="error-message" role="alert">{error}</p>}
    {notice&&<div className="success-banner" role="status"><CheckCircle2 size={17}/>{notice}</div>}

    {review&&<form className="registration-review-form admin-form" onSubmit={submit} aria-labelledby="registration-review-title">
      <div className="registration-review-heading"><h2 id="registration-review-title" ref={reviewHeading} tabIndex={-1}>{review.action==='approve'?'确认通过申请':'填写未通过原因'}</h2><button type="button" className="icon-button" aria-label="取消本次审核" disabled={busy} onClick={()=>setReview(null)}><X size={18}/></button></div>
      <p className="registration-review-summary">本次审核 {reviewRequests.length} 人{studentCount?`，学生 ${studentCount} 人`:''}{teacherCount?`，教师 ${teacherCount} 人`:''}。</p>
      <ul className="registration-selected-names" aria-label="本次审核对象">{reviewRequests.map(item=><li key={item.id}>{item.name}<span>{item.role==='student'?item.student_no:item.username}</span></li>)}</ul>
      {review.action==='approve'&&studentCount>0&&<>
        <div className="form-grid">
          <label>学生加入的实验<select value={targetExperiment} required disabled={busy} onChange={e=>setTargetExperiment(e.target.value)}><option value="" disabled>请选择开放中的实验</option>{openExperiments.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <label>实验条件分配<select value={condition} required disabled={busy} onChange={e=>setCondition(e.target.value)}><option value="" disabled>请选择分配方式</option><option value="balanced">按当前人数均衡分配（临时）</option>{Object.entries(conditions).map(([value,item])=><option key={value} value={value}>{item.label}</option>)}</select></label>
        </div>
        <p className="registration-review-help">学生首次登录前可在“学生与分组”调整条件。均衡分配仅按当前组人数安排，不等同于正式的随机分组。</p>
        {openExperiments.length===0&&<p className="error-message">请先开放或新建一个实验，再通过学生申请。</p>}
      </>}
      {review.action==='approve'&&teacherCount>0&&<p className="registration-review-help">通过的教师可管理实验和学生；注册审核与创建教师账号仍由管理员负责。</p>}
      <label>{review.action==='reject'?'未通过原因（申请人登录时可查看）':'审核备注（可选）'}<textarea rows={2} maxLength={500} value={reviewNote} required={review.action==='reject'} disabled={busy} onChange={e=>setReviewNote(e.target.value)} placeholder={review.action==='reject'?'请说明需要核实或补充的内容':'例如：已核对班级名单'}/></label>
      <div className="registration-review-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>setReview(null)}>取消</button><button type="submit" className="primary" disabled={busy||(review.action==='approve'&&studentCount>0&&openExperiments.length===0)}>{review.action==='approve'?<Check size={16}/>:<X size={16}/>} {busy?'正在保存…':review.action==='approve'?`确认通过 ${reviewRequests.length} 人`:`确认退回 ${reviewRequests.length} 人`}</button></div>
    </form>}

    <div className="registration-selection-bar">
      <label className="check-label"><input type="checkbox" aria-label="选择当前筛选下全部可审核申请" checked={allSelected} disabled={busy||loading||selectable.length===0} onChange={()=>{setSelected(allSelected?[]:selectable.map(item=>item.id));setReview(null);}}/>选择当前列表</label>
      <span className="registration-selected-count">已选 {selected.length} 人</span>
      <div className="registration-batch-actions"><button className="secondary" type="button" disabled={busy||loading||selected.length===0||selectedRequests.some(item=>item.status!=='pending')} onClick={()=>beginReview(selected,'reject')}>批量退回</button><button className="primary" type="button" disabled={busy||loading||selected.length===0} onClick={()=>beginReview(selected,'approve')}><Check size={16}/>批量通过</button></div>
    </div>

    {loading?<p className="registration-empty" role="status">正在读取注册申请…</p>:<>
      <div className="registration-list" aria-label="注册申请列表">{filtered.map(item=><article className="registration-request" key={item.id}>
        <label className="registration-select"><input type="checkbox" aria-label={`选择${item.name}的申请`} checked={selected.includes(item.id)} disabled={busy||item.status==='approved'} onChange={()=>toggle(item.id)}/></label>
        <div className="registration-person"><div><strong>{item.name}</strong><span className="registration-role">{item.role==='student'?'学生':'教师'}</span></div><p>{item.role==='student'?'学号':'账号'}：<span>{item.role==='student'?item.student_no:item.username}</span></p></div>
        <div className="registration-context"><span>{item.role==='student'?'申请班级':'任教信息'}</span><p>{item.role==='student'?item.class_name:item.note||'未填写'}</p></div>
        <div className="registration-request-status"><span className={`registration-state ${item.status}`}>{statusLabels[item.status]}</span><time dateTime={item.created_at}>申请于 {formatTime(item.created_at)}</time>{item.reviewed_at&&<time dateTime={item.reviewed_at}>审核于 {formatTime(item.reviewed_at)}</time>}</div>
        <div className="registration-row-actions">{item.status==='pending'&&<button type="button" className="text-button" disabled={busy} onClick={()=>beginReview([item.id],'reject')}>退回</button>}{item.status!=='approved'&&<button type="button" className="secondary" disabled={busy} onClick={()=>beginReview([item.id],'approve')}><Check size={15}/>{item.status==='rejected'?'重新审核':'通过'}</button>}</div>
        {item.review_note&&<p className="registration-review-record"><span>审核说明</span>{item.review_note}</p>}
      </article>)}</div>
      {filtered.length===0&&<div className="registration-empty"><ClipboardCheck size={28}/><strong>{query||role!=='all'?'没有匹配的申请':status==='pending'?'暂无待审核申请':'暂无相关申请'}</strong><p>{status==='pending'?'新用户在登录页完成注册后，会显示在这里。':'可以切换审核状态或清除筛选条件。'}</p></div>}
    </>}
  </section>;
}
