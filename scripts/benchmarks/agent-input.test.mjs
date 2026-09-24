import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicTask,taskPrompt,parseResponse} from './agent-input.mjs';

const task={task_id:1,intent_template_id:2,sites:['shopping_admin'],start_urls:['http://localhost:7780/admin'],intent:'Find the number of items.'};
test('rejects evaluator or reference data instead of silently passing it to the agent',()=>{
  assert.throws(()=>publicTask({...task,eval:[{expected:'secret answer'}]}),/Evaluation fields/);
  assert.throws(()=>publicTask({...task,reference_answers:['secret answer']}),/Evaluation fields/);
  assert.equal(taskPrompt(publicTask(task)).includes('secret answer'),false);
});
test('response transport preserves errors, numbers and object fields without inferring success',()=>{
  const reply={task_type:'RETRIEVE',status:'NOT_FOUND_ERROR',retrieved_data:[],error_details:'Missing'};
  assert.deepEqual(parseResponse('```json\n'+JSON.stringify(reply)+'\n```'),reply);
  assert.deepEqual(parseResponse('{"retrieved_data":[{"count":3}]}'),{retrieved_data:[{count:3}]});
  assert.equal(parseResponse('It probably worked.'),null);
});
