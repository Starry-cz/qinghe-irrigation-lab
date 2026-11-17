import express from 'express';
import { z, ZodError } from 'zod';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import db from './db.js';
import { env, rootDir } from './config.js';
import { createSession, getSession, logout, requireLogin } from './auth.js';
import { publicStudent, getProgress, event, httpError } from './model.js';
import studentRoutes from './routes/student.js';
import adminRoutes from './routes/admin.js';
import { initializeTeacher, verifyTeacher, assertApproved, publicUser, usernameSchema, nameSchema, studentNoSchema } from './users.js';
import { registerUser } from './registrations.js';
import { getModelSettings, saveModelSettings, deleteModelSettings, testModelSettings } from './model-settings.js';
import { stopGuidance } from './guidance.js';

await initializeTeacher();
if (!['scripted','openai'].includes(env.aiProvider)) throw new Error('AI_PROVIDER仅支持scripted或openai。');
if (env.aiProvider === 'openai' && (!env.aiKey || !env.aiModel)) throw new Error('使用真实模型时必须设置AI_API_KEY和AI_MODEL。');
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit:'1mb' }));
app.use('/api', (req,res,next) => { res.set('Cache-Control','no-store'); next(); });
app.get('/api/health', (req,res) => res.json({ status:'ok', service:'qinghe-lab', time:new Date().toISOString() }));

// 注册只保存申请，不创建登录会话；审批通过后沿用原有学生和教师登录入口。
app.post('/api/register', async (req,res,next) => {
  try { res.status(201).json(await registerUser(req.body)); }
  catch (error) { next(error); }
});

app.post('/api/login', async (req,res,next) => {
  try {
    const { role } = z.object({ role:z.enum(['student','teacher']) }).parse(req.body);
    if (role === 'teacher') {
      const {username,password}=z.object({username:usernameSchema,password:z.string().min(1).max(200)}).parse(req.body);
      const user=await verifyTeacher(username,password);
      if (!user) throw httpError(401,'教师账号或密码不正确。');
      assertApproved(user);
      db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(new Date().toISOString(),user.id);
      createSession(res,'teacher',user.id); res.json({ role:'teacher',user:publicUser(user.id) });
    } else {
      const {name,studentNo,experimentId}=z.object({name:nameSchema,studentNo:studentNoSchema,experimentId:z.string().optional()}).parse(req.body);
      const user=db.prepare("SELECT * FROM users WHERE role='student' AND student_no=? AND name=?").get(studentNo,name);
      if (!user) throw httpError(401,'姓名或学号不正确，请向老师确认已登记的资料。');
      assertApproved(user);
      const enrollments=db.prepare('SELECT s.*,e.title,e.status FROM students s JOIN experiments e ON e.id=s.experiment_id WHERE s.user_id=? ORDER BY e.created_at DESC').all(user.id);
      // 同一学生可参加多轮实验；明确选择后才建立该轮实验的会话。
      if (!experimentId && enrollments.length>1) return res.json({selectExperiment:true,experiments:enrollments.map(s=>({id:s.experiment_id,title:s.title,status:s.status}))});
      const student=experimentId?enrollments.find(s=>s.experiment_id===experimentId):enrollments[0];
      if (!student) throw httpError(403,'尚未加入所选实验，请联系老师。');
      student.student_no=user.student_no;
      const p = getProgress(student);
      db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(new Date().toISOString(),user.id);
      createSession(res,'student',user.id,student.id); event(student.id,p.stage,'login');
      res.json({ role:'student', student:publicStudent(student),user:publicUser(user.id) });
    }
  } catch (error) { next(error); }
});
app.post('/api/logout', logout);
app.get('/api/me', (req,res) => {
  const session = getSession(req);
  res.json(session ? { role:session.role,user:publicUser(session.user_id) } : { role:null });
});
// 个人配置的用户与实验只能来自登录会话，客户端不能指定别人的用户id。
app.get('/api/model-settings',requireLogin,(req,res)=>res.json(getModelSettings(req.user.id,req.student?.experiment_id)));
app.put('/api/model-settings',requireLogin,(req,res,next)=>{
  try { res.json(saveModelSettings(req.user.id,req.student?.experiment_id,req.body)); } catch(error) { next(error); }
});
app.delete('/api/model-settings',requireLogin,(req,res)=>res.json(deleteModelSettings(req.user.id,req.student?.experiment_id)));
app.post('/api/model-settings/test',requireLogin,async(req,res,next)=>{
  try { res.json(await testModelSettings(req.user.id,req.student?.experiment_id,req.body)); } catch(error) { next(error); }
});
app.use('/api/student',studentRoutes);
app.use('/api/admin',adminRoutes);
app.use('/api', (req,res) => res.status(404).json({ error:'接口不存在。' }));

// 生产环境由Express同时提供前端和API，部署时无需两套跨域地址。
const dist = resolve(rootDir,'frontend/dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*',(req,res) => res.sendFile(resolve(dist,'index.html')));
}
app.use((error,req,res,next) => {
  if (error instanceof ZodError) return res.status(400).json({ error:error.issues.map(i => i.message).join('；') });
  const status = error.status || 500;
  if (status === 500) console.error(error);
  res.status(status).json({ error: status === 500 ? '保存未成功，请重试。' : error.message });
});
const server = app.listen(env.port,env.host,() => console.log(`青禾实验平台：http://${env.host}:${env.port}；指导模式：${env.aiProvider}`));
function stop() { server.close(async () => { await stopGuidance(); db.close(); process.exit(0); }); }
process.on('SIGTERM',stop);
process.on('SIGINT',stop);
