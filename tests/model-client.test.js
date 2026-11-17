import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 模型客户端间接导入数据模块；必须在动态导入之前指定临时数据库，禁止触碰正式库。
const directory=mkdtempSync(join(tmpdir(),'qinghe-model-client-'));
process.env.DB_PATH=join(directory,'lab.db');
process.env.NODE_ENV='test';
process.env.ALLOW_LOCAL_MODEL_ENDPOINTS='true';
process.env.AI_PROVIDER='scripted';
process.env.AI_API_KEY='test-only-client-key';
const {requestModelResult,requestModel}=await import('../backend/src/model-client.js');
const {default:db}=await import('../backend/src/db.js');

const signals=new Map(),calls=[];
let baseUrl;
const modelKey='test-only-transport-private-key';
const messages=[{role:'user',content:'请根据已有实验记录给一个引导问题。'}];
const mock=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw),{model}=body,signal=signals.get(model);
  calls.push({path:req.url,authorization:req.headers.authorization,body});
  if(signal){res.once('close',()=>signal.closed.resolve());signal.entered.resolve();}
  res.setHeader('Content-Type','application/json');
  if(model==='truncated'){
    res.end(JSON.stringify({choices:[{message:{content:'这是一条被输出上限截断的指导……'},finish_reason:'length'}],usage:{prompt_tokens:12,completion_tokens:220}}));return;
  }
  if(model==='rate-limited'){
    // 只发送429和部分正文；客户端应主动关闭，无需等上游错误页传完。
    res.writeHead(429);res.flushHeaders();res.write(JSON.stringify({error:{message:`内部信息 ${modelKey}`}}));return;
  }
  if(model==='cancelled'||model==='timed-out'){
    res.writeHead(200);res.flushHeaders();return;
  }
  if(model==='invalid-json'){
    res.end(`not-json 内部诊断 ${modelKey}`);return;
  }
  if(model==='redirected'){
    res.writeHead(302,{Location:baseUrl+'/redirect-target'});res.end();return;
  }
  if(model==='oversized'){
    res.writeHead(200);res.write('x'.repeat(2*1024*1024+1));return;
  }
  if(model==='contract'){
    res.end(JSON.stringify({choices:[{message:{role:'assistant',content:`观察两组测试。${modelKey}`},finish_reason:'stop'}],usage:{prompt_tokens:123,completion_tokens:45}}));return;
  }
  if(model==='partial-usage'){
    res.end(JSON.stringify({choices:[{message:{content:'继续比较实验记录。'},finish_reason:'stop'}],usage:{completion_tokens:23}}));return;
  }
  res.end(JSON.stringify({choices:[{message:{content:'观察两组测试中有哪些条件相同。'},finish_reason:'stop'}]}));
});
function config(model){return {trusted:true,baseUrl,model,apiKey:modelKey,thinking:''};}
function observe(model){const signal={entered:Promise.withResolvers(),closed:Promise.withResolvers()};signals.set(model,signal);return signal;}
async function within(promise,message){
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error(message)),1500);
    promise.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
  });
}

before(async()=>{await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));baseUrl=`http://127.0.0.1:${mock.address().port}/v1`;});
after(async()=>{
  mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve));db.close();
  // 此目录由本文件刚刚创建，只含测试数据。
  rmSync(directory,{recursive:true,force:true});
});

test('SDK直连所选API，保持系统消息、思考模式、用量与单轮调用契约',async()=>{
  const before=calls.length,original=[{role:'system',content:'你是教学引导助手。'},...messages];
  const result=await requestModelResult({...config('contract'),thinking:'disabled'},original,{maxTokens:700});
  assert.equal(calls.length,before+1);
  const call=calls.at(-1);
  assert.equal(call.path,'/v1/chat/completions');assert.equal(call.authorization,`Bearer ${modelKey}`);
  assert.equal(call.body.model,'contract');assert.equal(call.body.temperature,0.3);assert.equal(call.body.max_tokens,700);
  assert.deepEqual(call.body.messages,original);assert.deepEqual(call.body.thinking,{type:'disabled'});
  assert.equal(call.body.tools,undefined);assert.equal(call.body.stream,undefined);
  assert.deepEqual(result,{content:'观察两组测试。[密钥已隐藏]',inputTokens:123,outputTokens:45});
});

test('可选择思考模式；服务商未返回用量时保持空值，设置页仍得到正文',async()=>{
  const result=await requestModelResult({...config('plain'),thinking:'enabled'},messages);
  assert.deepEqual(calls.at(-1).body.thinking,{type:'enabled'});assert.equal(result.inputTokens,null);assert.equal(result.outputTokens,null);
  const content=await requestModel(config('plain'),messages);
  assert.equal(content,'观察两组测试中有哪些条件相同。');assert.equal(calls.at(-1).body.thinking,undefined);
  const partial=await requestModelResult(config('partial-usage'),messages);
  assert.equal(partial.inputTokens,null);assert.equal(partial.outputTokens,23);
});

test('输出被截断时明确失败，不把半句指导当作完整回答',async()=>{
  await assert.rejects(requestModelResult(config('truncated'),messages),error=>{
    assert.equal(error.status,502);assert.match(error.message,/长度限制未完成/);assert.ok(!error.message.includes('这是一条被输出上限截断'));return true;
  });
});

test('上游429返回中文错误并终止错误响应，不占用已释放的并发槽',async()=>{
  const signal=observe('rate-limited'),before=calls.length;
  await assert.rejects(requestModelResult(config('rate-limited'),messages),error=>{
    assert.equal(error.status,502);assert.match(error.message,/繁忙或额度不足/);assert.ok(!error.message.includes(modelKey));assert.ok(!error.message.includes('内部信息'));return true;
  });
  assert.equal(calls.length,before+1,'SDK不能把一次求助自动重试为多次模型请求');
  await within(signal.closed.promise,'429任务已失败，但其上游HTTP连接仍未关闭');
});

test('取消指导时实际中止上游HTTP，不能只改变任务状态',async()=>{
  const signal=observe('cancelled'),controller=new AbortController(),reason=new Error('test-request-cancelled');
  const pending=requestModelResult(config('cancelled'),messages,{signal:controller.signal});
  // 先挂拒绝处理，避免中止时产生测试工具的未处理Promise误报。
  const rejected=assert.rejects(pending,error=>error===reason);
  await within(signal.entered.promise,'未收到待取消的模型请求');controller.abort(reason);await rejected;
  await within(signal.closed.promise,'取消后上游HTTP连接仍未关闭');
});

test('超时仍是中文504且关闭真实连接',async()=>{
  const signal=observe('timed-out');
  await assert.rejects(requestModelResult(config('timed-out'),messages,{timeoutMs:80}),error=>{
    assert.equal(error.status,504);assert.match(error.message,/响应超时/);return true;
  });
  await within(signal.closed.promise,'超时后上游HTTP连接仍未关闭');
});

test('SDK解析失败不输出原始响应、内部诊断或密钥',async()=>{
  await assert.rejects(requestModelResult(config('invalid-json'),messages),error=>{
    assert.equal(error.status,502);assert.match(error.message,/未正常返回文字/);
    assert.ok(!error.message.includes(modelKey));assert.ok(!error.message.includes('内部诊断'));assert.equal(error.cause,undefined);return true;
  });
});

test('SDK自定义传输不跟随重定向，避免把凭证发送到另一地址',async()=>{
  const before=calls.length;
  await assert.rejects(requestModelResult(config('redirected'),messages),error=>error.status===502);
  assert.equal(calls.length,before+1);assert.equal(calls.at(-1).path,'/v1/chat/completions');
});

test('SDK自定义传输保留2MiB响应上限并关闭持续响应',async()=>{
  const signal=observe('oversized');
  await assert.rejects(requestModelResult(config('oversized'),messages),error=>error.status===502);
  await within(signal.closed.promise,'超出响应上限后上游HTTP连接仍未关闭');
});
