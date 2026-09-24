import assert from 'node:assert/strict';

/** Accept only the upstream public agent export, never task/evaluator definitions. */
export function publicTask(value) {
  const fields=['sites','task_id','intent_template_id','start_urls','intent'];
  assert.ok(value && Object.keys(value).every(key=>fields.includes(key)), 'Use official agent-input-get output. Evaluation fields are forbidden.');
  assert.ok(Number.isInteger(value.task_id) && typeof value.intent==='string' && value.intent.trim());
  assert.ok(Array.isArray(value.start_urls) && value.start_urls.length && value.start_urls.every(url=>/^https?:\/\//.test(url)));
  assert.ok(Array.isArray(value.sites) && value.sites.length);
  return Object.fromEntries(fields.map(key=>[key,value[key]]));
}

export function taskPrompt(task) {
  return `${task.intent}

Begin from the provided page(s): ${task.start_urls.join(', ')}. Work in the current authenticated session and remain within those sites. Do not log out or switch accounts. The task refers to the current page when a specific starting page is provided. Do not change state unless the task requires it. Do not download files. Complete the task autonomously.

Return the final answer as a JSON object with these fields:
{"task_type":"RETRIEVE|MUTATE|NAVIGATE","status":"SUCCESS|NOT_FOUND_ERROR|ACTION_NOT_ALLOWED_ERROR|PERMISSION_DENIED_ERROR|DATA_VALIDATION_ERROR|UNKNOWN_ERROR","retrieved_data":null,"error_details":null}
Use RETRIEVE when the objective is to obtain data, MUTATE when changing state is the objective, or NAVIGATE when the objective is to show a page. For RETRIEVE, retrieved_data must be an array even for one result; otherwise it must be null. Return objects only when requested by the task and use the specified keys. Otherwise return simple strings, numbers or booleans with the appropriate types. Use SUCCESS only when the actual objective is complete; otherwise describe the failure in error_details. Return only that JSON, without additional prose.`;
}

export function parseResponse(text) {
  // Transport formatting only. No answer repair, inference, or benchmark reference access.
  const trimmed=text.trim(),fenced=trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  try {return JSON.parse(fenced?fenced[1]:trimmed);} catch {return null;}
}
