// 沿用模板的同源请求封装，所有持久化都经后端完成。
const API_BASE = '/api';
export async function fetchJSON(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin', ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
}
export const post = (path, body) => fetchJSON(path, { method:'POST', body });
