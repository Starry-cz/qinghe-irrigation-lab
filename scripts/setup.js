import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

const root=fileURLToPath(new URL('../',import.meta.url));
const envPath=resolve(root,'.env');
let content=readFileSync(existsSync(envPath)?envPath:resolve(root,'.env.example'),'utf8');
let values=dotenv.parse(content);
// 一次性把旧访问码迁移为初始密码，模型密钥及已有其他配置保持原值。
if(values.ADMIN_CODE && !values.TEACHER_PASSWORD){
  content=content.replace(/^ADMIN_CODE=.*\r?\n?/m,'TEACHER_USERNAME=admin\nTEACHER_PASSWORD='+values.ADMIN_CODE+'\nTEACHER_NAME=管理员\n');
}
content=content.replace('replace-with-your-teacher-password',randomBytes(12).toString('base64url'));
writeFileSync(envPath,content);
values=dotenv.parse(content);
mkdirSync(resolve(root,'data'),{recursive:true});
writeFileSync(resolve(root,'本地登录说明.txt'),'青禾实验平台本地登录\n\n地址：http://127.0.0.1:3001\n教师账号：'+values.TEACHER_USERNAME+'\n初始密码：'+values.TEACHER_PASSWORD+'\n\n此密码仅用于首次创建教师账号；在“账号与资料”修改后，请使用新密码。\n\n演示学生（姓名＋学号）：\n演示学生1 / 20260001（已有完整演示记录）\n演示学生2 / 20260002\n演示学生3 / 20260003\n演示学生4 / 20260004\n\n请勿把本文件或.env上传到公共仓库。\n');
console.log('账号初始化配置已准备。本地登录信息见 platform/本地登录说明.txt。');

