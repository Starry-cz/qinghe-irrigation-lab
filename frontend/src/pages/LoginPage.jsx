import { useState } from 'react';
import { ArrowRight, KeyRound, UserRound, IdCard, GraduationCap, FlaskConical, School, CheckCircle2 } from 'lucide-react';
import { post } from '../api/index.js';
import Brand from '../components/Brand.jsx';
import LabScene from '../components/LabScene.jsx';

export default function LoginPage({ onLogin }) {
  const [role,setRole]=useState('student');
  const [mode,setMode]=useState('login');
  const [username,setUsername]=useState('');
  const [password,setPassword]=useState('');
  const [name,setName]=useState('');
  const [studentNo,setStudentNo]=useState('');
  const [className,setClassName]=useState('');
  const [note,setNote]=useState('');
  const [confirmPassword,setConfirmPassword]=useState('');
  const [submitted,setSubmitted]=useState(false);
  const [experiments,setExperiments]=useState([]);
  const [experimentId,setExperimentId]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const registering=mode==='register';
  function switchRole(next){setRole(next);setPassword('');setConfirmPassword('');setSubmitted(false);setError('');setExperiments([]);setExperimentId('');}
  function switchMode(next){setMode(next);setPassword('');setConfirmPassword('');setSubmitted(false);setError('');setExperiments([]);setExperimentId('');}
  function changeStudent(setter,value){setter(value);setExperiments([]);setExperimentId('');}
  async function submit(e){
    e.preventDefault();setBusy(true);setError('');
    try{
      if(registering){
        if(role==='teacher'&&password!==confirmPassword)throw new Error('两次输入的密码不一致，请重新确认。');
        const body=role==='teacher'?{role,name,username,password,note}:{role,name,studentNo,className};
        // 提交申请只保存待审核账号，通过后再由原登录入口建立会话。
        await post('/register',body);
        setPassword('');setConfirmPassword('');setSubmitted(true);return;
      }
      const body=role==='teacher'?{role,username,password}:{role,name,studentNo,...(experimentId?{experimentId}:{})};
      const result=await post('/login',body);
      // 同一姓名和学号对应多轮实验时，选择要继续的实验，避免混用记录。
      if(result.selectExperiment){setExperiments(result.experiments);setExperimentId('');return;}
      onLogin(result.role);
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <div className={`login-page${registering?' registration-page':''}`}>
    <header className="login-header"><Brand/><span className="muted">信息科技 · 探究实验</span></header>
    <main className="login-layout">
      <section className="login-form-area">
        <span className="eyebrow">校园植物角 / VIRTUAL LAB</span>
        <h1>{registering?'加入青禾实验平台':<>让每一次灌溉，<br/><span>都有据可循。</span></>}</h1>
        <p className="login-intro">{registering?'填写真实资料，管理员审核通过后即可登录。':<>观察设备，提出猜想。<br/>用你的实验，找到更合理的灌溉方式。</>}</p>
        <div className="role-tabs" aria-label="选择身份"><button className={role==='student'?'active':''} aria-pressed={role==='student'} disabled={busy} onClick={()=>switchRole('student')}><GraduationCap size={17}/>{registering?'学生注册':'学生进入'}</button><button className={role==='teacher'?'active':''} aria-pressed={role==='teacher'} disabled={busy} onClick={()=>switchRole('teacher')}><FlaskConical size={17}/>{registering?'教师注册':'教师管理'}</button></div>
        {submitted?<section className="registration-success" role="status"><CheckCircle2 size={32}/><h2>注册申请已提交</h2><p>{role==='student'?`${name}，请等待管理员审核并安排实验。通过后使用姓名和学号登录。`:`${name}，请等待管理员审核。通过后使用刚才设置的教师账号和密码登录。`}</p><button className="primary login-submit" onClick={()=>switchMode('login')}>返回登录<ArrowRight size={18}/></button></section>:<form onSubmit={submit} className="login-form">
          {role==='teacher'?<>
            {registering&&<><label htmlFor="teacher-name">姓名</label><div className="input-with-icon"><UserRound size={18}/><input id="teacher-name" value={name} onChange={e=>setName(e.target.value)} autoComplete="name" placeholder="填写真实姓名，便于管理员审核" maxLength={80} required disabled={busy}/></div></>}
            <label htmlFor="teacher-username">账号</label><div className="input-with-icon"><UserRound size={18}/><input id="teacher-username" value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" placeholder="输入教师账号" maxLength={80} required disabled={busy}/></div>
            <label htmlFor="teacher-password">密码</label><div className="input-with-icon"><KeyRound size={18}/><input id="teacher-password" type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete={registering?'new-password':'current-password'} minLength={registering?8:undefined} placeholder={registering?'设置至少 8 位的登录密码':'输入登录密码'} required disabled={busy}/></div>
            {registering&&<><label htmlFor="teacher-password-confirm">确认密码</label><div className="input-with-icon"><KeyRound size={18}/><input id="teacher-password-confirm" type="password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} autoComplete="new-password" placeholder="再次输入登录密码" required disabled={busy}/></div><label htmlFor="registration-note">任教信息 <span className="muted">（选填）</span></label><textarea id="registration-note" value={note} onChange={e=>setNote(e.target.value)} placeholder="例如：学校、任教班级或学科" rows={2} maxLength={500} disabled={busy}/></>}
          </>:<>
            <label htmlFor="student-name">姓名</label><div className="input-with-icon"><UserRound size={18}/><input id="student-name" value={name} onChange={e=>changeStudent(setName,e.target.value)} autoComplete="name" placeholder="输入你的姓名" maxLength={80} required disabled={busy}/></div>
            <label htmlFor="student-number">学号</label><div className="input-with-icon"><IdCard size={18}/><input id="student-number" value={studentNo} onChange={e=>changeStudent(setStudentNo,e.target.value)} autoComplete="username" placeholder="输入你的学号" maxLength={80} required disabled={busy}/></div>
            {registering&&<><label htmlFor="student-class">班级</label><div className="input-with-icon"><School size={18}/><input id="student-class" value={className} onChange={e=>setClassName(e.target.value)} placeholder="例如：八年级 1 班" maxLength={80} required disabled={busy}/></div></>}
            {!registering&&experiments.length>0&&<><label htmlFor="login-experiment">选择实验</label><select id="login-experiment" value={experimentId} onChange={e=>setExperimentId(e.target.value)} required disabled={busy}><option value="" disabled>选择本次要进入的实验</option>{experiments.map(e=><option key={e.id} value={e.id}>{e.title}{e.status==='paused'?'（暂停）':e.status==='closed'?'（已结束）':''}</option>)}</select></>}
          </>}
          {error&&<div className="error-message" role="alert">{error}</div>}
          <button className="primary login-submit" disabled={busy}>{busy?(registering?'正在提交…':'正在进入…'):registering?'提交注册申请':role==='student'?'进入实验室':'进入管理台'}<ArrowRight size={18}/></button>
        </form>}
        {!submitted&&<div className="auth-mode-switch"><span>{registering?'已有账号？':'还没有账号？'}</span><button className="text-button" disabled={busy} onClick={()=>switchMode(registering?'login':'register')}>{registering?'返回登录':'自主注册'}</button></div>}
        <p className="login-note">{registering?'注册资料仅用于账号审核与实验管理。':role==='student'?'老师已导入的学生可直接登录；自主注册需等待审核。实验记录会自动保存。':'使用已开通或已审核通过的教师账号登录。'}</p>
      </section>
      <section className="login-visual" aria-label="自动灌溉虚拟实验场景"><LabScene/></section>
    </main>
  </div>;
}

