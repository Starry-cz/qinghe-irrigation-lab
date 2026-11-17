export const GUIDANCE_EVIDENCE_LIMITS = { recent:8, referenced:4 };

export function requestedTestIds(question) {
  const mentions=[];
  // 只识别明确的测试编号，普通读数、时长和日期不作为记录id。
  for (const match of question.matchAll(/[#＃]\s*(\d+)/g)) mentions.push({index:match.index,id:Number(match[1])});
  for (const match of question.matchAll(/(?:测试记录(?:编号|号)?|测试(?:编号|号))\s*[:：]?\s*(\d+(?:\s*[、,，和与及]\s*\d+)*)/g)) {
    for (const id of match[1].matchAll(/\d+/g)) mentions.push({index:match.index,id:Number(id[0])});
  }
  return [...new Set(mentions.sort((a,b)=>a.index-b.index).map(mention=>mention.id).filter(id=>Number.isSafeInteger(id)&&id>0))];
}

function decode(rows) { return rows.map(row=>({...row,data:JSON.parse(row.data)})); }

export function getGuidanceEvidence(database,studentId,question='') {
  const recentTrials=decode(database.prepare('SELECT id,stage,data FROM trials WHERE student_id=? ORDER BY id DESC LIMIT ?')
    .all(studentId,GUIDANCE_EVIDENCE_LIMITS.recent).reverse());
  const requestedIds=requestedTestIds(question);
  const selectedIds=requestedIds.slice(0,GUIDANCE_EVIDENCE_LIMITS.referenced);
  const rows=selectedIds.length?decode(database.prepare(`SELECT id,stage,data FROM trials WHERE student_id=? AND id IN (${selectedIds.map(()=>'?').join(',')})`)
    .all(studentId,...selectedIds)):[];
  const byId=new Map(rows.map(row=>[row.id,row]));
  // 显式引用和最近窗口分别返回，较早证据不能改变“最近两次测试”的比较事实。
  return {recentTrials,referencedTrials:selectedIds.filter(id=>byId.has(id)).map(id=>byId.get(id)),
    missingReferenceIds:selectedIds.filter(id=>!byId.has(id)),
    omittedReferenceIds:requestedIds.slice(GUIDANCE_EVIDENCE_LIMITS.referenced)};
}
