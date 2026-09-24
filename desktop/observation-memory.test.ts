import {it,expect} from 'vitest';
import {ObservationMemory} from './observation-memory';
import type {PageState} from './engine';
const page=(url:string,text:string)=>({url,title:'Observed page',text} as PageState);
it('retains observed rendered table rows after navigating away',()=>{
 const memory=new ObservationMemory();
 memory.add({...page('https://example.test/orders','Orders'),tables:[{headers:['ID','Total'],rows:[['a','12'],['b','18']],truncated:false}]},0);
 memory.add(page('https://example.test/next','Next page'),1);
 expect(memory.read()[0].text).toContain('"rows":[["a","12"],["b","18"]]');
});
it('retains actual readings across navigation, de-duplicates repeated states and labels truncation',()=>{
 const memory=new ObservationMemory();memory.add(page('https://example.test/list','First listing'),0);memory.add(page('https://example.test/item','Observed detail'),1);memory.add(page('https://example.test/list','First listing'),2);
 expect(memory.read().map(item=>item.text)).toEqual(['First listing','Observed detail']);
 memory.add(page('https://example.test/long','Long observation '.repeat(1000)),3);
 const short=memory.read(1500);expect(JSON.stringify(short).length).toBeLessThanOrEqual(1500);expect(short.at(-1)?.truncated).toBe(true);
});
it('bounds a long task while retaining its starting context and most recent evidence',()=>{
 const memory=new ObservationMemory();for(let i=0;i<80;i++)memory.add(page('https://example.test/'+i,'Page '+i+' '+'.'.repeat(1000)),i);
 expect(memory.size).toBe(40);const readings=memory.read(20000);expect(readings[0].atAction).toBe(0);expect(readings.at(-1)?.atAction).toBe(79);
 expect(JSON.stringify(readings).length).toBeLessThanOrEqual(20000);expect(memory.read(100)).toEqual([]);
});
it('omits an exact current snapshot only from request history without erasing earlier evidence',()=>{
 const memory=new ObservationMemory(),first=page('https://example.test/list','Earlier result'),current=page('https://example.test/list','Current result');
 memory.add(first,0);memory.add(current,1);
 expect(memory.read(18000,current).map(item=>item.text)).toEqual(['Earlier result']);
 expect(memory.read().map(item=>item.text)).toEqual(['Earlier result','Current result']);
 expect(memory.read(18000,{...current,url:'https://example.test/other'})).toHaveLength(2);
});
it('packs complete collection records with their author endings and distinct source ordinals',()=>{
 const memory=new ObservationMemory();
 const text='Detailed observed text '.repeat(45)+' Author: Name at the end';
 const collection={items:[text,text],itemOrdinals:[1,2],totalItems:2,totalDomItems:2,truncated:false,source:{url:'https://example.test/list',tag:'ol',collectionOrdinal:1,collectionCount:1}};
 const current={...page('https://example.test/list','Page header'),collections:[collection]};
 memory.add(current,1);memory.add(current,2);
 const records=memory.read(3600).filter(item=>item.collection);
 expect(records).toHaveLength(2);expect(records.map(item=>item.collection!.itemOrdinal)).toEqual([1,2]);
 expect(records.every(item=>item.text.endsWith('Author: Name at the end')&&!item.truncated)).toBe(true);
 expect(memory.read(3600,current)).toEqual([]);
 expect(JSON.stringify(memory.read(1500)).length).toBeLessThanOrEqual(1500);
 expect(memory.read(1500).at(-1)?.omittedPassages).toBeGreaterThan(0);
});

it('reserves recent list context and whole recent records before older directory items',()=>{
 const memory=new ObservationMemory();
 const collection=(url:string,items:string[])=>({items,itemOrdinals:items.map((_,i)=>i+1),totalItems:items.length,totalDomItems:items.length,truncated:false,source:{url,tag:'ol',collectionOrdinal:1,collectionCount:1}});
 const directory='https://example.test/directory',latest='https://example.test/items?sort=newest';
 memory.add({...page(directory,'Directory'),collections:[collection(directory,Array.from({length:24},(_,i)=>'Directory item '+i))]},0);
 const records=Array.from({length:5},(_,i)=>'Record '+i+' '+'.'.repeat(160)+' Author: Person '+i);
 memory.add({...page(latest,'Items sorted Newest first. 5 records.'),collections:[collection(latest,records)]},1);
 const current=page('https://example.test/item/1','Record details');memory.add(current,2);
 const packed=memory.read(4600,current);
 expect(packed.find(item=>!item.collection&&item.url===latest)?.text).toContain('Newest first');
 const recent=packed.filter(item=>item.collection&&item.url===latest);
 expect(recent.map(item=>item.text)).toEqual(records);
 expect(recent.map(item=>item.collection!.itemOrdinal)).toEqual([1,2,3,4,5]);
 expect(recent.every(item=>!item.truncated&&item.collection!.source.url===latest)).toBe(true);
 expect(packed.at(-1)?.omittedPassages).toBeGreaterThan(0);
 expect(JSON.stringify(packed).length).toBeLessThanOrEqual(4600);
});

it('retains completed pages of records and marks a bounded context or record prefix explicitly',()=>{
 const memory=new ObservationMemory();
 for(let i=1;i<=3;i++) {
  const url='https://example.test/records?page='+i;
  memory.add({...page(url,'Page '+i+' context '+('"quoted"\\line\n'.repeat(500))),collections:[{
   items:['Record on page '+i+' Author: Last name'],itemOrdinals:[1],totalItems:1,totalDomItems:1,truncated:false,
   source:{url,tag:'article',collectionOrdinal:1,collectionCount:1},
  }]},i);
 }
 const result=memory.read(3600);
 expect(result.filter(item=>item.collection).map(item=>item.text)).toEqual([1,2,3].map(i=>'Record on page '+i+' Author: Last name'));
 expect(result.some(item=>!item.collection&&item.truncated)).toBe(true);
 expect(JSON.stringify(result).length).toBeLessThanOrEqual(3600);
 const oversized=new ObservationMemory();
 oversized.add({...page('https://example.test/large','Large record'),collections:[{items:['"line"\n'.repeat(2000)],itemOrdinals:[7],totalItems:10,totalDomItems:10,truncated:true,source:{url:'https://example.test/large',tag:'ol',collectionOrdinal:1,collectionCount:1}}]},0);
 const short=oversized.read(1200),partial=short.find(item=>item.collection);
 expect(partial?.truncated).toBe(true);
 expect(partial?.collection?.itemOrdinal).toBe(7);
 expect(partial?.collection?.windowTruncated).toBe(true);
 expect(JSON.stringify(short).length).toBeLessThanOrEqual(1200);
});
