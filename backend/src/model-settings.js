import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import db from './db.js';
import { env } from './config.js';
import { getExperiment, httpError, now } from './model.js';
import { normalizeModelBaseUrl, requestModel } from './model-client.js';

const secretPath=join(dirname(env.dbPath),'model-secrets.key');

function encryptionKey(create=false) {
  // 只在首次保存密钥时生成本地加密主密钥；数据库备份需连同此文件保存。
  if (create && !existsSync(secretPath)) {
    const saved=db.prepare('SELECT 1 FROM personal_model_settings UNION ALL SELECT 1 FROM experiment_model_settings LIMIT 1').get();
    if (saved) throw httpError(503,'模型密钥文件已丢失，请恢复与数据库匹配的 model-secrets.key 文件，不能生成新密钥覆盖已有配置。');
    writeFileSync(secretPath,randomBytes(32),{flag:'wx',mode:0o600});
  }
  try {
    const key=readFileSync(secretPath);
    if (key.length!==32) throw new Error('invalid-key');
    return key;
  } catch { throw httpError(503,'模型密钥文件不可用，请联系管理员检查服务器配置。'); }
}
function encryptKey(value) {
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',encryptionKey(true),iv);
  const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return [iv,cipher.getAuthTag(),ciphertext].map(part=>part.toString('base64url')).join('.');
}
function decryptKey(value) {
  const key=encryptionKey();
  try {
    const [iv,tag,ciphertext]=value.split('.').map(part=>Buffer.from(part,'base64url'));
    const decipher=createDecipheriv('aes-256-gcm',key,iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString('utf8');
  } catch { throw httpError(503,'保存的模型密钥无法读取，请重新填写 API 密钥。'); }
}

function platformConfig() {
  return {source:'platform',provider:env.aiProvider,model:env.aiProvider==='scripted'?'scripted-v1':env.aiModel,
    baseUrl:env.aiBaseUrl,thinking:env.aiThinking,apiKey:env.aiKey,trusted:true};
}
function storedConfig(row,source) {
  return {source,provider:'openai',model:row.model,baseUrl:row.base_url,thinking:row.thinking,
    encryptedKey:row.api_key_ciphertext,trusted:false};
}
export function publicModelConfig(config) {
  // 所有接口只从允许公开的字段构建响应，永不展开包含密钥的内部配置对象。
  return {provider:config.provider,model:config.model,baseUrl:config.baseUrl,thinking:config.thinking};
}
function publicResolved(config) { return {source:config.source,...publicModelConfig(config)}; }
function personalRow(userId) { return db.prepare('SELECT * FROM personal_model_settings WHERE user_id=?').get(userId); }
function defaultConfig(experimentId) {
  const row=experimentId && db.prepare('SELECT * FROM experiment_model_settings WHERE experiment_id=?').get(experimentId);
  return row?storedConfig(row,'experiment'):platformConfig();
}
function selectedConfig(userId,experimentId) {
  const personal=personalRow(userId);
  return personal?.mode==='custom'?storedConfig(personal,'personal'):defaultConfig(experimentId);
}
function withSecret(config) {
  return {...config,apiKey:config.encryptedKey?decryptKey(config.encryptedKey):config.apiKey};
}
export function resolveModelConfig(userId,experimentId) { return withSecret(selectedConfig(userId,experimentId)); }
export function effectiveModelInfo(userId,experimentId) { return publicResolved(selectedConfig(userId,experimentId)); }
export function experimentModelInfo(experimentId) { return publicResolved(defaultConfig(experimentId)); }

export function getModelSettings(userId,experimentId) {
  const personal=personalRow(userId);
  return {mode:personal?.mode || 'default',platform:publicModelConfig(platformConfig()),
    default:publicResolved(defaultConfig(experimentId)),
    custom:personal?{baseUrl:personal.base_url,model:personal.model,thinking:personal.thinking,hasKey:true}:null,
    effective:effectiveModelInfo(userId,experimentId)};
}

const settingsSchema=z.discriminatedUnion('mode',[
  z.object({mode:z.literal('default')}),
  z.object({mode:z.literal('custom'),baseUrl:z.string().trim().min(1).max(2000),
    model:z.string().trim().min(1,'请填写模型名称').max(200),thinking:z.enum(['','disabled','enabled']).default(''),
    apiKey:z.string().trim().max(8192).refine(value=>!/[\r\n]/.test(value),'API 密钥不能包含换行').optional()}),
]);

function customDraft(userId,data) {
  const baseUrl=normalizeModelBaseUrl(data.baseUrl), existing=personalRow(userId);
  if (!data.apiKey && (!existing || existing.base_url!==baseUrl)) throw httpError(400,existing
    ? '更换 API 地址后，请重新填写 API 密钥。':'请填写 API 密钥。');
  return {source:'personal',provider:'openai',baseUrl,model:data.model,thinking:data.thinking,trusted:false,
    apiKey:data.apiKey || undefined,encryptedKey:data.apiKey?undefined:existing.api_key_ciphertext};
}

export function saveModelSettings(userId,experimentId,body) {
  const data=settingsSchema.parse(body);
  if (data.mode==='default') db.prepare("UPDATE personal_model_settings SET mode='default',updated_at=? WHERE user_id=?").run(now(),userId);
  else {
    const config=customDraft(userId,data);
    const ciphertext=config.apiKey?encryptKey(config.apiKey):config.encryptedKey;
    db.prepare(`INSERT INTO personal_model_settings(user_id,mode,base_url,model,thinking,api_key_ciphertext,updated_at)
      VALUES (?,'custom',?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET mode='custom',base_url=excluded.base_url,
      model=excluded.model,thinking=excluded.thinking,api_key_ciphertext=excluded.api_key_ciphertext,updated_at=excluded.updated_at`)
      .run(userId,config.baseUrl,config.model,config.thinking,ciphertext,now());
  }
  return getModelSettings(userId,experimentId);
}
export function deleteModelSettings(userId,experimentId) {
  db.prepare('DELETE FROM personal_model_settings WHERE user_id=?').run(userId);
  return getModelSettings(userId,experimentId);
}
export async function testModelSettings(userId,experimentId,body) {
  const data=settingsSchema.parse(body);
  const config=withSecret(data.mode==='custom'?customDraft(userId,data):defaultConfig(experimentId));
  // 测试只使用固定短提示，不写个人设置、学生对话或实验日志。
  const reply=config.provider==='scripted'?'预设教学指导已就绪，无需连接外部模型。'
    : await requestModel(config,[{role:'user',content:'这是模型连接测试，请只用中文回复“连接成功”。'}],{maxTokens:64});
  return {ok:true,model:config.model,reply};
}

export function getExperimentModel(experimentId) {
  getExperiment(experimentId);
  const row=db.prepare(`SELECT m.*,u.name AS owner_name FROM experiment_model_settings m
    JOIN users u ON u.id=m.owner_user_id WHERE m.experiment_id=?`).get(experimentId);
  return row?{source:'teacher',settings:publicModelConfig(storedConfig(row,'experiment')),ownerName:row.owner_name}
    : {source:'platform',settings:publicModelConfig(platformConfig())};
}
export function saveExperimentModel(userId,experimentId,body) {
  getExperiment(experimentId);
  const {source}=z.object({source:z.enum(['platform','personal'])}).parse(body);
  if (source==='platform') db.prepare('DELETE FROM experiment_model_settings WHERE experiment_id=?').run(experimentId);
  else {
    const row=personalRow(userId);
    if (!row) throw httpError(400,'请先保存你的个人模型配置，再设为实验默认。');
    // 拷贝配置和加密密钥形成快照，教师之后切换或删除个人配置不影响全班。
    db.prepare(`INSERT INTO experiment_model_settings(experiment_id,owner_user_id,base_url,model,thinking,api_key_ciphertext,updated_at)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(experiment_id) DO UPDATE SET owner_user_id=excluded.owner_user_id,
      base_url=excluded.base_url,model=excluded.model,thinking=excluded.thinking,
      api_key_ciphertext=excluded.api_key_ciphertext,updated_at=excluded.updated_at`)
      .run(experimentId,userId,row.base_url,row.model,row.thinking,row.api_key_ciphertext,now());
  }
  return getExperimentModel(experimentId);
}
