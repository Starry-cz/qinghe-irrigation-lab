import https from 'node:https';
import http from 'node:http';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { httpError } from './model.js';

const localTests=process.env.NODE_ENV==='test' && process.env.ALLOW_LOCAL_MODEL_ENDPOINTS==='true';
const networkMessage='无法连接模型服务，请检查 API 地址和网络后重试。';
export const serviceMessage='模型服务未正常返回文字，请检查模型名称和 API 密钥后重试。';
const timeoutMessage='模型服务响应超时，请稍后重试。';

function addressAllowed(address) {
  const range=ipaddr.process(address).range();
  return range==='unicast' || (localTests && range==='loopback');
}

// 用户配置只接受公网HTTPS；HTTP回环地址仅供显式开启双开关的自动化测试。
export function normalizeModelBaseUrl(value) {
  let url;
  try { url=new URL(value); } catch { throw httpError(400,'请填写有效的 HTTPS API 地址。'); }
  const hostname=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
  const loopback=hostname==='localhost' || (isIP(hostname) && ipaddr.process(hostname).range()==='loopback');
  if (url.protocol!=='https:' && !(localTests && url.protocol==='http:' && loopback)) throw httpError(400,'自定义 API 地址必须使用公网 HTTPS。');
  if (url.username || url.password || url.search || url.hash) throw httpError(400,'API 地址不能包含账号、密码、查询参数或片段。');
  if (!(localTests && loopback) && (hostname==='localhost' || /(^|\.)(localhost|local|internal|metadata|instance-data)\.?$/.test(hostname)
      || (isIP(hostname) && !addressAllowed(hostname)))) throw httpError(400,'API 地址必须指向公网模型服务，不能使用本机或内网地址。');
  url.pathname=url.pathname.replace(/\/+$/,'');
  return url.toString().replace(/\/$/,'');
}

function checkedLookup(hostname,options,callback) {
  lookup(hostname,{all:true,verbatim:true}).then(addresses => {
    // 检查全部解析结果后只把已验证的地址交给本次连接，避免二次DNS解析。
    if (!addresses.length || addresses.some(item=>!addressAllowed(item.address))) {
      callback(httpError(400,'API 域名解析到非公网地址，不能连接。')); return;
    }
    const chosen=addresses[0];
    if (options.all) callback(null,[chosen]); else callback(null,chosen.address,chosen.family);
  },()=>callback(httpError(502,networkMessage)));
}

// 为 SDK 提供有界的非流式 fetch：保留现有连接约束，协议编解码由官方 provider 完成。
export function createModelFetch(config,{timeoutMs}) {
  return async (input,init) => {
    const {body,signal}=init;
    signal?.throwIfAborted();
    const endpoint=new URL(input);
    if (!['http:','https:'].includes(endpoint.protocol)) throw httpError(502,networkMessage);
    const transport=endpoint.protocol==='https:'?https:http;
    return new Promise((resolve,reject) => {
      let settled=false;
      const finish=(error,response)=>{
        if (settled) return;
        settled=true; clearTimeout(timer);
        signal?.removeEventListener('abort',abort);
        if (error) reject(error); else resolve(response);
      };
      const abort=()=>{finish(signal.reason);request.destroy();};
      const request=transport.request(endpoint,{method:init.method,agent:config.trusted?undefined:false,
        ...(config.trusted ? {} : {lookup:checkedLookup}),
        headers:{...Object.fromEntries(new Headers(init.headers)),'Content-Length':Buffer.byteLength(body)}},response => {
        // node:http(s)不会跟随重定向；错误正文立即丢弃并关闭连接，释放真正的上游并发。
        if (response.statusCode<200 || response.statusCode>=300) {
          const message=response.statusCode===429?'模型服务繁忙或额度不足，请稍后重试。':response.statusCode===401||response.statusCode===403?'模型服务拒绝访问，请检查 API 密钥与模型权限。':serviceMessage;
          finish(httpError(502,message)); response.destroy(); request.destroy(); return;
        }
        const chunks=[]; let bytes=0;
        response.on('data',chunk=>{
          bytes+=chunk.length;
          if (bytes>2*1024*1024) { finish(httpError(502,serviceMessage)); response.destroy(); request.destroy(); return; }
          chunks.push(chunk);
        });
        response.on('error',()=>finish(httpError(502,networkMessage)));
        response.on('end',()=>{
          try {
            const headers=new Headers();
            for (let index=0;index<response.rawHeaders.length;index+=2) headers.append(response.rawHeaders[index],response.rawHeaders[index+1]);
            finish(null,new Response(Buffer.concat(chunks),{status:response.statusCode,headers}));
          } catch { finish(httpError(502,serviceMessage)); }
        });
      });
      const timer=setTimeout(()=>{finish(httpError(504,timeoutMessage));request.destroy();},timeoutMs);
      signal?.addEventListener('abort',abort,{once:true});
      request.on('error',error=>finish(error.status===400 ? error : httpError(502,networkMessage)));
      request.end(body);
    });
  };
}
