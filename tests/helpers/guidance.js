import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

// 只等待已受理任务的终态，保留最初HTTP状态；失败不能被包装成成功响应。
export async function settleGuidance(request, response, cookie, expectedStatus='succeeded') {
  assert.ok([200,202].includes(response.status),JSON.stringify(response.data));
  assert.ok(response.data.guidance?.id,'受理结果应包含指导任务编号');
  const runId=response.data.guidance.id;
  let state=response.data;
  const deadline=Date.now()+5000;
  while (['queued','running'].includes(state.guidance.status)) {
    assert.ok(Date.now()<deadline,`指导任务 ${runId} 未在测试期限内结束`);
    await delay(20);
    const polled=await request('/student/state',{cookie});
    assert.equal(polled.status,200,JSON.stringify(polled.data));
    assert.equal(polled.data.guidance?.id,runId,'等待期间不应被另一条任务替换');
    state=polled.data;
  }
  assert.equal(state.guidance.status,expectedStatus,state.guidance.error||'指导终态不符');
  return {...response,data:{...response.data,...state}};
}
