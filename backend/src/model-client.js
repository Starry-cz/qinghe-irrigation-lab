import { generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { httpError } from './model.js';
import { createModelFetch, normalizeModelBaseUrl, serviceMessage } from './model-transport.js';

export { normalizeModelBaseUrl } from './model-transport.js';

// 设置页仍只需要正文；教学任务另取用量，避免破坏已有连接测试接口。
export async function requestModel(config,messages,options={}) {
  return (await requestModelResult(config,messages,options)).content;
}

export async function requestModelResult(config,messages,{maxTokens=220,timeoutMs=30000,signal}={}) {
  signal?.throwIfAborted();
  const baseURL=(config.trusted ? config.baseUrl : normalizeModelBaseUrl(config.baseUrl)).replace(/\/+$/,'');
  // 传入直连 provider 实例，避免字符串模型名走 SDK 的默认 AI Gateway。
  const provider=createOpenAICompatible({name:'qinghe',baseURL,apiKey:config.apiKey,
    fetch:createModelFetch(config,{timeoutMs})});
  try {
    const result=await generateText({
      model:provider(config.model),messages,
      // system 消息来自后端的教学规则与证据构建器，保留原有消息顺序。
      allowSystemInMessages:true,
      temperature:0.3,maxOutputTokens:maxTokens,abortSignal:signal,
      // 每次教学求助只生成一轮，不注册工具、不自动重试、不发送遥测。
      maxRetries:0,telemetry:{isEnabled:false,recordInputs:false,recordOutputs:false},
      ...(config.thinking ? {providerOptions:{qinghe:{thinking:{type:config.thinking}}}} : {})
    });
    signal?.throwIfAborted();
    if (result.finishReason==='length') throw httpError(502,'模型回复因长度限制未完成，请缩小问题范围或调整所选模型的思考模式。');
    if (!result.text.trim()) throw httpError(502,serviceMessage);
    const tokens=value=>Number.isSafeInteger(value)&&value>=0?value:null;
    // 只返回业务所需字段；SDK 原始请求/响应不进入学生消息、日志与研究导出。
    // SDK 会把部分 usage 中缺失的计数补为 0；研究记录仍把未报告的计数保存为空。
    return {content:config.apiKey ? result.text.replaceAll(config.apiKey,'[密钥已隐藏]') : result.text,
      inputTokens:result.usage.raw?.prompt_tokens==null?null:tokens(result.usage.inputTokens),
      outputTokens:result.usage.raw?.completion_tokens==null?null:tokens(result.usage.outputTokens)};
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    // 本地传输层已生成固定中文错误；SDK 的解析错误可能带原始响应，不能直接外传。
    if ([400,502,504].includes(error?.status)) throw error;
    throw httpError(502,serviceMessage);
  }
}
