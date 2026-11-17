import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { fetchJSON, post } from './api/index.js';
import LoginPage from './pages/LoginPage.jsx';
import StudentPage from './pages/StudentPage.jsx';
import TeacherPage from './pages/TeacherPage.jsx';
import './App.css';

export default function App() {
  const [role,setRole] = useState(undefined);
  const [error,setError] = useState('');
  const load = () => fetchJSON('/me').then(r => { setRole(r.role); setError(''); }).catch(e => setError(e.message));
  useEffect(() => { load(); },[]);
  async function logout() { await post('/logout',{}); setRole(null); }
  if (error) return <div className="page-loading"><p role="alert">无法连接实验服务：{error}</p><button className="primary" onClick={load}>重新连接</button></div>;
  if (role === undefined) return <div className="page-loading"><span className="loading-dot"/>正在连接实验室…</div>;
  return (
    <BrowserRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}>
      <Routes>
        <Route path="/" element={role ? <Navigate to={role === 'teacher' ? '/teacher' : '/lab'} replace/> : <LoginPage onLogin={setRole}/>}/>
        <Route path="/lab" element={role === 'student' ? <StudentPage onLogout={logout}/> : <Navigate to="/" replace/>}/>
        <Route path="/teacher" element={role === 'teacher' ? <TeacherPage onLogout={logout}/> : <Navigate to="/" replace/>}/>
        <Route path="*" element={<Navigate to="/" replace/>}/>
      </Routes>
    </BrowserRouter>
  );
}
