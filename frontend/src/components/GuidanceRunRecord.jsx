const statuses={queued:'等待中',running:'生成中',succeeded:'已完成',failed:'失败',cancelled:'已取消'};
// 操作提示单独标记，教师可以区分调整条件后的介入与完成测试后的指导。
const triggers={help:'学生求助',stage:'阶段进入',test:'完成测试',anomaly:'预测不符',repeat:'重复测试',idle:'停留提示',operation:'操作提示'};
const sources={platform:'平台默认',experiment:'实验默认',personal:'学生自选'};
const seconds=value=>value==null?'—':`${(value/1000).toFixed(2)} 秒`;

// 展示实际任务记录，教师无需读取原始事件JSON即可区分排队、生成与失败。
export default function GuidanceRunRecord({item}) {
  return <>
    <p><strong>{statuses[item.status]}</strong> · {triggers[item.trigger]} · {sources[item.model_source]}</p>
    <dl className="submission-fields">
      <div><dt>调用模型</dt><dd>{item.model}</dd></div>
      <div><dt>排队 / 生成</dt><dd>{seconds(item.queue_ms)} / {seconds(item.duration_ms)}</dd></div>
      <div><dt>输入 / 输出 token</dt><dd>{item.input_tokens??'未返回'} / {item.output_tokens??'未返回'}</dd></div>
      <div><dt>提示词版本</dt><dd>{item.prompt_version||'尚未构建'}</dd></div>
    </dl>
    {item.error&&<p role="note">{item.error}</p>}
  </>;
}
