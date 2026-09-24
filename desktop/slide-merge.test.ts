import {it,expect} from 'vitest';
import {slide,mergeKeys,mergeForecasts,validMergeRules,numericBoard,matchesMergeTransition,type MergeRules} from './slide-merge';
const rules:MergeRules={kind:'slide_equal',emptyLabel:'empty',goal:2048,spawns:[{value:2,probability:.9},{value:4,probability:.1}]};
it('merges equal neighbors once, conserves tile mass, and reports no-op directions',()=>{
  const board=[2,2,4,4,0,2,0,2,0,0,0,0,0,0,0,0];
  expect(slide(board,'KEY_LEFT')).toEqual({board:[4,8,0,0,4,0,0,0,0,0,0,0,0,0,0,0],changed:true,gained:16});
  for(const key of mergeKeys)expect(slide(board,key).board.reduce((a,b)=>a+b,0)).toBe(board.reduce((a,b)=>a+b,0));
  expect(slide([4,8,0,0,...Array(12).fill(0)],'KEY_LEFT').changed).toBe(false);
});
it('rejects incomplete or invented numeric boards and invalid spawn probabilities',()=>{
  expect(validMergeRules(rules)).toBe(true);
  expect(validMergeRules({...rules,spawns:[{value:2,probability:1.1}]})).toBe(false);
  expect(validMergeRules({...rules,goal:123})).toBe(false);
  const cells=Array.from({length:4},()=>Array(4).fill('empty'));cells[0][0]='2';
  expect(numericBoard(cells,rules)?.[0]).toBe(2);cells[0][1]='?';expect(numericBoard(cells,rules)).toBeUndefined();
});
it('returns comparable estimates for all four inputs without changing the observed board',()=>{
  const board=[2,0,0,0,2,0,0,0,4,0,0,0,8,0,0,0],before=board.slice();
  const result=mergeForecasts(board,rules,10);
  expect(Object.keys(result.moves)).toEqual([...mergeKeys]);expect(board).toEqual(before);
  expect(result.moves.KEY_LEFT.legal).toBe(false);
  expect(result.moves.KEY_DOWN).toMatchObject({legal:true,mergeGain:4,emptyCells:13});
  expect(Object.values(result.moves).every(m=>Number.isFinite(m.estimatedPositionValue))).toBe(true);
});
it('distinguishes a completed merge and spawn from a stale or animated frame',()=>{
  const before=[2,2,...Array(14).fill(0)],moved=slide(before,'KEY_LEFT').board;
  expect(matchesMergeTransition(before,before,'KEY_LEFT',rules)).toBe(false);
  expect(matchesMergeTransition(before,moved,'KEY_LEFT',rules)).toBe(false);
  const spawned=moved.slice();spawned[5]=2;
  expect(matchesMergeTransition(before,spawned,'KEY_LEFT',rules)).toBe(true);
  spawned[5]=8;expect(matchesMergeTransition(before,spawned,'KEY_LEFT',rules)).toBe(false);
});
