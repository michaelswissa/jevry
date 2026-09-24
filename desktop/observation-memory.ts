import type {PageState} from './engine';
import type {ObservedCollection} from './collections';

export interface ObservedPassage {
  url:string;title:string;text:string;atAction:number;truncated:boolean;
  collection?:{source:ObservedCollection['source'];itemOrdinal:number;totalRenderedItems:number;totalDomItems:number;windowTruncated:boolean};
  omittedPassages?:number;
}
const reading=(page:PageState)=>(page.tables?.length?'Rendered tables: '+JSON.stringify(page.tables)+'\nViewport text:\n'+page.text:page.text).trim();
function collectionReadings(page:PageState,atAction:number):ObservedPassage[] {
  return (page.collections||[]).flatMap(collection=>collection.items.map((text,index)=>({
    url:collection.source.url,title:collection.label||page.title,text,atAction,
    truncated:collection.partialItemOrdinals?.includes(collection.itemOrdinals[index])||false,
    collection:{source:collection.source,itemOrdinal:collection.itemOrdinals[index],totalRenderedItems:collection.totalItems,totalDomItems:collection.totalDomItems,windowTruncated:collection.truncated},
  })));
}
const key=(item:ObservedPassage)=>JSON.stringify([item.url,item.text,item.collection?.source,item.collection?.itemOrdinal,item.truncated]);

/** Clip page context only. Collection records keep their endings whenever a whole item fits. */
function boundedPassage(item:ObservedPassage,budget:number):ObservedPassage|undefined {
  if(JSON.stringify(item).length<=budget)return {...item};
  const clipped={...item,text:'',truncated:true};
  if(JSON.stringify(clipped).length+80>budget)return undefined;
  let low=0,high=item.text.length;
  while(low<high) {
    const middle=Math.ceil((low+high)/2);
    clipped.text=item.text.slice(0,middle);
    if(JSON.stringify(clipped).length<=budget)low=middle;else high=middle-1;
  }
  clipped.text=item.text.slice(0,low);
  return clipped;
}

/** A bounded record of actual page readings, not model-generated facts. */
export class ObservationMemory {
  private entries:ObservedPassage[]=[];
  add(page:PageState,atAction:number) {
    const text=reading(page);
    if(text&&!this.entries.some(item=>!item.collection&&item.url===page.url&&item.text===text))this.entries.push({url:page.url,title:page.title,text,atAction,truncated:false});
    const known=new Set(this.entries.map(key));
    for(const item of collectionReadings(page,atAction))if(!known.has(key(item))){this.entries.push(item);known.add(key(item));}
    // Preserve the initial context as well as recent evidence during long tasks.
    const pages=this.entries.filter(item=>!item.collection),items=this.entries.filter(item=>item.collection);
    while(pages.length>40){const discarded=pages.splice(6,1)[0];this.entries.splice(this.entries.indexOf(discarded),1);}
    while(items.length>64){const discarded=items.splice(16,1)[0];this.entries.splice(this.entries.indexOf(discarded),1);}
  }
  get size(){return this.entries.length;}
  read(budget=18000,current?:PageState):ObservedPassage[] {
    if(budget<500)return [];
    // Current evidence already has its own snapshot. Keep the local archive
    // intact while omitting an exact duplicate from this model request.
    const text=current?reading(current):undefined;
    const currentItems=new Set(current?collectionReadings(current,0).map(key):[]);
    const entries=current?this.entries.filter(item=>item.collection?!currentItems.has(key(item)):item.url!==current.url||item.text!==text):this.entries;
    const content=entries.filter(item=>item.collection);
    if(content.length) {
      const selected=new Map<ObservedPassage,ObservedPassage>();
      let used=2;
      const add=(original:ObservedPassage,item=original)=>{
        if(selected.has(original))return;
        const size=JSON.stringify(item).length+1;
        if(used+size<=budget-80){selected.set(original,{...item});used+=size;}
      };
      const pages=entries.filter(item=>!item.collection);
      // A record alone loses its surrounding sort/filter, pagination and empty-
      // state context. Reserve bounded space for the latest two source pages.
      const recentPages:ObservedPassage[]=[],seenUrls=new Set<string>();
      for(const item of [...pages].reverse()) {
        if(!seenUrls.has(item.url)){recentPages.push(item);seenUrls.add(item.url);}
        if(recentPages.length===2)break;
      }
      const perContext=Math.floor(Math.min(6000,budget*0.3)/Math.max(1,recentPages.length));
      for(const original of recentPages) {
        const item=boundedPassage(original,perContext);
        if(item)add(original,item);
      }
      // Prefer recent source groups, retaining DOM order inside each group.
      // Old directory/listing items must not crowd out a newly inspected list.
      const groups=new Map<string,{items:ObservedPassage[];last:number}>();
      for(const [index,item] of content.entries()) {
        const source=JSON.stringify(item.collection!.source);
        const group=groups.get(source)||{items:[],last:index};
        group.items.push(item);group.last=index;groups.set(source,group);
      }
      const ranked=[...groups.values()].sort((a,b)=>b.last-a.last).flatMap(group=>group.items.sort((a,b)=>a.collection!.itemOrdinal-b.collection!.itemOrdinal));
      for(const item of ranked)add(item);
      for(const item of [...pages].reverse())add(item);
      // An oversized record is still useful, but never silently present its
      // prefix as complete. This is only a fallback when no whole record fits.
      if(![...selected.keys()].some(item=>item.collection)) {
        const original=ranked[0],item=boundedPassage(original,budget-used-81);
        if(item)add(original,item);
      }
      // Keep the returned archive chronological; packing priority is separate.
      const result=entries.flatMap(item=>selected.has(item)?[selected.get(item)!]:[]);
      const omitted=entries.length-result.length;
      if(omitted&&result.length)result.at(-1)!.omittedPassages=omitted;
      return result;
    }
    const selected=entries.length>14?[...entries.slice(0,6),...entries.slice(-8)]:entries;
    const perEntry=Math.min(6000,Math.floor((budget-selected.length*250)/Math.max(1,selected.length)));
    if(perEntry<80)return [];
    const result=selected.map(item=>({...item,text:item.text.slice(0,perEntry),truncated:item.truncated||item.text.length>perEntry}));
    while(JSON.stringify(result).length>budget&&result.length)result.pop();
    if(result.length&&result.length<entries.length) {
      result.at(-1)!.omittedPassages=entries.length-result.length;
      while(JSON.stringify(result).length>budget&&result.length) {
        result.pop();
        if(result.length)result.at(-1)!.omittedPassages=entries.length-result.length;
      }
    }
    return result;
  }
}
