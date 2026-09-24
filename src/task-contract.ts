/** User-derived success conditions, separate from tempting progress indicators. */
export interface TaskContract {
  success: string[];
  constraints: string[];
  progressOnly: string[];
  /** Requirements for the final answer, not facts that must appear on a website. */
  responseRequirements?: string[];
  /** Explicit user scope, never inferred from instructions on a website. */
  allowedOrigins?: string[];
  allowFormSubmission?: boolean;
}
export function parseTaskContract(value: unknown): TaskContract | undefined {
  if (value === undefined) return;
  const v=value as TaskContract;
  const list=(items:unknown,max:number,required=false):items is string[]=>Array.isArray(items)&&items.length<=max&&(!required||items.length>0)&&items.every(item=>typeof item==='string'&&!!item.trim()&&item.length<=400);
  if(!v||!list(v.success,4,true)||!list(v.constraints,6)||!list(v.progressOnly,4))throw new Error('The planner returned invalid task success conditions.');
  if(v.responseRequirements!==undefined&&!list(v.responseRequirements,4))throw new Error('The planner returned invalid response requirements.');
  if(v.allowedOrigins!==undefined&&(!list(v.allowedOrigins,8,true)||v.allowedOrigins.some(origin=>{try{const u=new URL(origin);return !['http:','https:'].includes(u.protocol)||u.origin!==origin;}catch{return true;}})))throw new Error('The planner returned invalid allowed origins.');
  if(v.allowFormSubmission!==undefined&&typeof v.allowFormSubmission!=='boolean')throw new Error('The planner returned invalid form authorization.');
  return {success:v.success.map(s=>s.trim()),constraints:v.constraints.map(s=>s.trim()),progressOnly:v.progressOnly.map(s=>s.trim()),...(v.responseRequirements?{responseRequirements:v.responseRequirements.map(s=>s.trim())}:{}),...(v.allowedOrigins?{allowedOrigins:[...new Set(v.allowedOrigins)]}:{}),...(v.allowFormSubmission!==undefined?{allowFormSubmission:v.allowFormSubmission}:{})};
}
