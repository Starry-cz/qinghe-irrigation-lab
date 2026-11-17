import {useEffect,useState} from 'react';
import {Save,Plus} from 'lucide-react';
import {fetchJSON,post} from '../api/index.js';

export default function UsersPanel({onChanged}) {
  const [data,setData]=useState(null),[name,setName]=useState('');
  const [currentPassword,setCurrentPassword]=useState(''),[newPassword,setNewPassword]=useState('');
  const [teacher,setTeacher]=useState({name:'',username:'',password:''});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function load(){const result=await fetchJSON('/admin/users');setData(result);setName(result.currentUser.name);}
  useEffect(()=>{load().catch(e=>setError(e.message));},[]);
  async function save(e){e.preventDefault();setBusy(true);setError('');setNotice('');try{
    await fetchJSON('/admin/account',{method:'PATCH',body:{name,...(newPassword?{currentPassword,newPassword}:{})}});
    setCurrentPassword('');setNewPassword('');await load();await onChanged();setNotice('当前教师资料已保存。');
  }catch(e){setError(e.message);}finally{setBusy(false);}}
  async function add(e){e.preventDefault();setBusy(true);setError('');setNotice('');try{
    await post('/admin/users/teachers',teacher);setTeacher({name:'',username:'',password:''});await load();setNotice('教师账号已创建，可使用账号和密码登录。');
  }catch(e){setError(e.message);}finally{setBusy(false);}}
  if(!data)return <p>{error||'正在读取用户资料…'}</p>;
  return <div className="users-panel">
    {error&&<div className="error-message" role="alert">{error}</div>}{notice&&<div className="success-banner" role="status">{notice}</div>}
    <section className="settings-section"><h2>我的教师账号</h2><p className="muted">账号：{data.currentUser.username}</p>
      <form className="admin-form" onSubmit={save}><div className="form-grid three">
        <label>教师姓名<input value={name} onChange={e=>setName(e.target.value)} required maxLength={80}/></label>
        <label>当前密码<input type="password" autoComplete="current-password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} required={Boolean(newPassword)} placeholder="修改密码时填写"/></label>
        <label>新密码<input type="password" autoComplete="new-password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} minLength={8} placeholder="留空则保持原密码"/></label>
      </div><button className="primary" disabled={busy}><Save size={16}/>保存我的资料</button></form>
    </section>
    {Boolean(data.currentUser.is_admin)&&<section className="settings-section"><h2>添加教师账号</h2><p className="muted">管理员可直接创建教师账号，也可让教师自主注册后到“注册审核”中批准。</p>
      <form className="admin-form" onSubmit={add}><div className="form-grid three">
        <label>新教师姓名<input value={teacher.name} onChange={e=>setTeacher({...teacher,name:e.target.value})} required maxLength={80}/></label>
        <label>新教师账号<input value={teacher.username} onChange={e=>setTeacher({...teacher,username:e.target.value})} autoComplete="off" minLength={3} maxLength={80} required/></label>
        <label>初始密码<input type="password" value={teacher.password} onChange={e=>setTeacher({...teacher,password:e.target.value})} autoComplete="new-password" minLength={8} required/></label>
      </div><button className="secondary" disabled={busy}><Plus size={16}/>创建教师账号</button></form>
    </section>}
    <section className="settings-section"><div className="section-top"><h2>{data.currentUser.is_admin?'全部用户资料':'我的账号与学生资料'}</h2><span className="muted">共 {data.users.length} 人</span></div><p className="muted">已加入实验的学生资料可在“学生与分组”中编辑。{Boolean(data.currentUser.is_admin)&&'自主注册的申请请在“注册审核”中处理。'}</p>
      <div className="table-scroll"><table><thead><tr><th>姓名</th><th>身份</th><th>账号 / 学号</th><th>账号状态</th><th>登记时间</th><th>最近登录</th></tr></thead><tbody>{data.users.map(u=><tr key={u.id}><td>{u.name}</td><td>{u.is_admin?'管理员':u.role==='teacher'?'教师':'学生'}</td><td>{u.role==='teacher'?u.username:u.student_no||'待补充学号'}</td><td>{{approved:'已开通',pending:'待审核',rejected:'未通过'}[u.status]}</td><td>{new Date(u.created_at).toLocaleString('zh-CN')}</td><td>{u.last_login_at?new Date(u.last_login_at).toLocaleString('zh-CN'):'尚未登录'}</td></tr>)}</tbody></table></div>
    </section>
  </div>;
}
