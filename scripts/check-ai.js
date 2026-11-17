import { env } from '../backend/src/config.js';

// 仅输出连接状态、可用模型和测试答复，不输出请求头或API密钥。
const modelsOnly = process.argv.includes('--models');
const endpoint = env.aiBaseUrl.replace(/\/$/,'') + (modelsOnly ? '/models' : '/chat/completions');
const response = await fetch(endpoint, {
  method:modelsOnly?'GET':'POST',
  headers:{Authorization:`Bearer ${env.aiKey}`,'Content-Type':'application/json'},
  ...(modelsOnly ? {} : {body:JSON.stringify({model:env.aiModel,max_tokens:32,
    ...(env.aiThinking ? {thinking:{type:env.aiThinking}} : {}),
    messages:[{role:'user',content:'请只回复：连接正常。'}]})}),
  signal:AbortSignal.timeout(30000),
});
const data=await response.json();
console.log(JSON.stringify({status:response.status,model:env.aiModel,
  ...(modelsOnly ? {models:data.data?.map(m=>m.id)} : {reply:data.choices?.[0]?.message?.content}),
  ...(response.ok?{}:{error:data.error?.message || '接口请求失败'})}));
if(!response.ok) process.exitCode=1;
