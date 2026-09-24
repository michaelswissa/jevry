/** A declarative game family. No site state, URLs, DOM internals or input dispatch. */
export interface MergeRules {
  kind:'slide_equal'; emptyLabel:string; goal:number;
  spawns:Array<{value:number;probability:number}>;
}
export const mergeKeys=['KEY_LEFT','KEY_UP','KEY_RIGHT','KEY_DOWN'] as const;
export type MergeKey=typeof mergeKeys[number];
export function tileValue(label:string) {
  if(!/^[1-9]\d{0,5}$/.test(label))return;
  const n=Number(label);return n<=65536&&(n&(n-1))===0?n:undefined;
}
export function validMergeRules(r:MergeRules) {
  return !!r&&r.kind==='slide_equal'&&typeof r.emptyLabel==='string'&&r.emptyLabel.length>0&&r.emptyLabel.length<=40&&
    !tileValue(r.emptyLabel)&&!!tileValue(String(r.goal))&&r.goal>=128&&Array.isArray(r.spawns)&&r.spawns.length>0&&r.spawns.length<=4&&
    r.spawns.every(s=>s&&!!tileValue(String(s.value))&&s.value<r.goal&&Number.isFinite(s.probability)&&s.probability>0&&s.probability<=1)&&
    Math.abs(r.spawns.reduce((sum,s)=>sum+s.probability,0)-1)<.00001;
}
export function numericBoard(cells:string[][],rules:MergeRules) {
  if(cells.length!==4||cells.some(row=>row.length!==4))return;
  const flat=cells.flat().map(v=>v===rules.emptyLabel?0:tileValue(v));
  return flat.every(v=>v!==undefined)?flat as number[]:undefined;
}
export function slide(board:readonly number[],key:MergeKey) {
  const next=Array<number>(16).fill(0);let gained=0;
  for(let line=0;line<4;line++) {
    const indices=Array.from({length:4},(_,i)=>key==='KEY_LEFT'?line*4+i:key==='KEY_RIGHT'?line*4+3-i:key==='KEY_UP'?i*4+line:(3-i)*4+line);
    const values=indices.map(i=>board[i]).filter(Boolean),merged:number[]=[];
    for(let i=0;i<values.length;i++) {
      if(values[i]===values[i+1]){merged.push(values[i]*2);gained+=values[i]*2;i++;}
      else merged.push(values[i]);
    }
    indices.forEach((index,i)=>{next[index]=merged[i]||0;});
  }
  return {board:next,changed:next.some((n,i)=>n!==board[i]),gained};
}
export function matchesMergeTransition(before:number[],after:number[],key:MergeKey,rules:MergeRules) {
  const moved=slide(before,key),differences=after.flatMap((v,i)=>v===moved.board[i]?[]:[i]);
  if(!moved.changed)return differences.length===0;
  if(!differences.length&&Math.max(...after)>=rules.goal)return true;
  return differences.length===1&&moved.board[differences[0]]===0&&rules.spawns.some(s=>s.value===after[differences[0]]);
}

// Positional estimates, not observed facts or a choice of operation. Jev compares all candidates.
function quality(board:readonly number[]) {
  const values=board.map(n=>n?Math.log2(n):0);
  let empty=0,roughness=0,monotonicity=0,merges=0;
  for(const n of values)if(!n)empty++;
  for(let axis=0;axis<2;axis++)for(let line=0;line<4;line++) {
    const row=Array.from({length:4},(_,i)=>values[axis?i*4+line:line*4+i]);
    let rising=0,falling=0;
    for(let i=0;i<3;i++) {
      const a=row[i]**3,b=row[i+1]**3;
      rising+=Math.max(0,b-a);falling+=Math.max(0,a-b);
      if(row[i]&&row[i+1]){roughness+=Math.abs(row[i]-row[i+1]);if(row[i]===row[i+1])merges++;}
    }
    monotonicity+=Math.min(rising,falling);
  }
  const max=Math.max(...values),corner=Math.max(values[0],values[3],values[12],values[15]);
  return empty*270+merges*180-monotonicity*6-roughness*10-(max-corner)*400;
}

export function mergeForecasts(board:number[],rules:MergeRules,maxMs=25) {
  const began=performance.now(),deadline=began+maxMs;
  const candidates=mergeKeys.map(key=>({key,...slide(board,key)}));
  let nodes=0,depth=0;
  const timeout=Symbol('search deadline');
  const cache=new Map<string,number>();
  function search(position:number[],remaining:number,chance:boolean,probability:number):number {
    if((++nodes&127)===0&&performance.now()>deadline)throw timeout;
    if(remaining===0||probability<.0002)return quality(position);
    const id=position.join(',')+':'+remaining+':'+Number(chance);
    const hit=cache.get(id);if(hit!==undefined)return hit;
    let result:number;
    if(chance) {
      const empties=position.flatMap((n,i)=>n?[]:[i]);
      if(!empties.length)return search(position,remaining,false,probability);
      result=0;
      for(const i of empties)for(const spawn of rules.spawns) {
        const next=position.slice();next[i]=spawn.value;
        const p=spawn.probability/empties.length;
        result+=p*search(next,remaining-1,false,probability*p);
      }
    } else {
      const moves=mergeKeys.map(key=>slide(position,key)).filter(m=>m.changed);
      result=moves.length?Math.max(...moves.map(m=>search(m.board,remaining,true,probability))):-100_000;
    }
    cache.set(id,result);return result;
  }
  let scores=candidates.map(m=>m.changed?quality(m.board):-100_000);
  for(let d=1;d<=4;d++) {
    try {
      const next=candidates.map(m=>m.changed?search(m.board,d,true,1):-100_000);
      scores=next;depth=d;
    } catch(error) {if(error!==timeout)throw error;break;}
    if(performance.now()>=deadline)break;
  }
  return {depth,nodes,durationMs:Math.round(performance.now()-began),moves:Object.fromEntries(candidates.map((m,i)=>[m.key,{
    legal:m.changed,afterSlide:m.board,mergeGain:m.gained,emptyCells:m.board.filter(n=>!n).length,
    estimatedPositionValue:Math.round(scores[i]*100)/100,
  }]))};
}
