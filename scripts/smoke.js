import { env } from '../backend/src/config.js';

// 对正在运行的实例做只读健康检查，不创建账号或改动学生记录。
const base=process.env.SMOKE_URL || `http://127.0.0.1:${env.port}`;
const health=await fetch(base+'/api/health');
if(!health.ok)throw new Error(`健康检查失败：${health.status}`);
const page=await fetch(base+'/');
if(!page.ok || !(await page.text()).includes('<div id="root">'))throw new Error('前端构建尚未由服务器提供，请先build并重启start。');
console.log('通过：后端健康、生产前端页面和同源访问。');
