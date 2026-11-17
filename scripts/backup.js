import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { env, rootDir } from '../backend/src/config.js';

// 使用SQLite在线备份API，包含WAL中的已提交数据，不直接复制正在写入的文件。
const folder=resolve(rootDir,process.env.BACKUP_DIR || 'backups');
mkdirSync(folder,{recursive:true});
const destination=resolve(folder,`lab-${new Date().toISOString().replace(/[:.]/g,'-')}.db`);
const db=new DatabaseSync(env.dbPath);
await backup(db,destination);
db.close();
// 个人及实验API密钥以密文存入数据库；恢复备份还需同一份本机加密密钥。
const keyPath=resolve(dirname(env.dbPath),'model-secrets.key');
if(existsSync(keyPath)) {
  copyFileSync(keyPath,destination.replace(/\.db$/,'.model-secrets.key'));
  console.log('已一并备份模型密钥文件，恢复时请与对应数据库配套使用。');
}
console.log(`数据库备份已完成：${destination}`);
