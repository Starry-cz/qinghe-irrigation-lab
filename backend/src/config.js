import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const rootDir = fileURLToPath(new URL('../../', import.meta.url));
dotenv.config({ path: resolve(rootDir, '.env') });
export const env = {
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || '127.0.0.1',
  dbPath: resolve(rootDir, process.env.DB_PATH || 'data/lab.db'),
  teacherUsername: process.env.TEACHER_USERNAME || 'admin',
  teacherPassword: process.env.TEACHER_PASSWORD || '',
  teacherName: process.env.TEACHER_NAME || '管理员',
  secureCookie: process.env.COOKIE_SECURE === 'true',
  aiProvider: process.env.AI_PROVIDER || 'scripted',
  aiBaseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
  aiModel: process.env.AI_MODEL || '',
  aiKey: process.env.AI_API_KEY || '',
  aiThinking: process.env.AI_THINKING || '',
  // 调度限制按服务器容量配置；排队与生成分别计时，不增加自动模型重试。
  aiMaxConcurrent: Number(process.env.AI_MAX_CONCURRENT || 8),
  aiQueueLimit: Number(process.env.AI_QUEUE_LIMIT || 128),
  aiQueueWaitMs: Number(process.env.AI_QUEUE_WAIT_MS || 60000),
};
