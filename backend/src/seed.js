import db, {transaction} from './db.js';
import { randomUUID } from 'node:crypto';
import { CONDITIONS } from '../../shared/definitions.js';

// 演示账号幂等创建，用户身份与本轮实验报名分别保存。
const codes=['demo-ah','demo-ad','demo-rh','demo-rd'];
transaction(()=>Object.keys(CONDITIONS).forEach((condition,index)=>{
  if(db.prepare('SELECT id FROM students WHERE code=?').get(codes[index]))return;
  const studentNo='2026000'+(index+1),name='演示学生'+(index+1);
  let user=db.prepare('SELECT id,name FROM users WHERE student_no=?').get(studentNo);
  if(user && user.name!==name)throw new Error('演示学号已被使用，请不要在正式库执行seed。');
  if(!user){user={id:randomUUID()};db.prepare('INSERT INTO users(id,role,name,student_no,created_at) VALUES (?,?,?,?,?)').run(user.id,'student',name,studentNo,new Date().toISOString());}
  db.prepare('INSERT INTO students(id,experiment_id,user_id,code,name,class_name,condition,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(randomUUID(),'default',user.id,codes[index],name,'演示班',condition,new Date().toISOString());
}));
console.log('演示登录：演示学生1 / 20260001，演示学生2 / 20260002，演示学生3 / 20260003，演示学生4 / 20260004。');
db.close();

