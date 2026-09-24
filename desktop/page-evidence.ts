/** Read-only full-document evidence. Viewport clipping belongs to action snapshots. */
const SOURCE_DOM = String.raw`
 const roots=[document],seen=new Set(roots),elements=[];let frames=0,unsupported=0,limited=false;
 const parent=e=>{
   const local=e?.assignedSlot||e?.parentElement||e?.getRootNode()?.host;if(local)return local;
   try{return e?.ownerDocument!==document?e?.ownerDocument?.defaultView?.frameElement||null:null;}catch{return null;}
 };
 const visibleCache=new WeakMap(),excludedCache=new WeakMap(),ranges=new WeakMap();
 const visible=e=>{
   if(!e)return true;if(visibleCache.has(e))return visibleCache.get(e);
   const view=e.ownerDocument?.defaultView;if(!view)return false;
   const s=view.getComputedStyle(e),shown=s.display!=='none'&&s.visibility!=='hidden'&&s.visibility!=='collapse'&&s.opacity!=='0'&&
     !e.hasAttribute('hidden')&&!e.hasAttribute('inert')&&e.getAttribute('aria-hidden')!=='true'&&visible(parent(e));
   visibleCache.set(e,shown);return shown;
 };
 const excluded=e=>{
   if(!e)return false;if(excludedCache.has(e))return excludedCache.get(e);
   const value=/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TEXTAREA|INPUT|SELECT)$/.test(e.tagName)||e.isContentEditable||excluded(parent(e));
   excludedCache.set(e,value);return value;
 };
 const rendered=node=>{
   const doc=node.ownerDocument;if(!doc)return false;
   let range=ranges.get(doc);if(!range){range=doc.createRange();ranges.set(doc,range);}
   range.selectNodeContents(node);
   // Off-screen text still has layout boxes. Suppressed slots/closed details do not.
   return [...range.getClientRects()].some(r=>r.width>0&&r.height>0);
 };
 for(let i=0;i<roots.length&&elements.length<20000;i++){
   const root=roots[i],doc=root.nodeType===9?root:root.ownerDocument;
   const walker=doc.createTreeWalker(root,NodeFilter.SHOW_ELEMENT);let e;
   while(elements.length<20000&&(e=walker.nextNode())){
     elements.push(e);if(!visible(e)||excluded(e))continue;
     if(e.shadowRoot&&!seen.has(e.shadowRoot)){
       if(roots.length<80){seen.add(e.shadowRoot);roots.push(e.shadowRoot);}else limited=true;
     }
     if(e.tagName==='IFRAME'){
       if(e.clientWidth<1||e.clientHeight<1||!e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))continue;
       let child;try{child=e.contentDocument;}catch{}
       if(child?.body&&frames<16&&roots.length<80&&!seen.has(child)){seen.add(child);roots.push(child);frames++;}
       else{unsupported++;if(child?.body)limited=true;}
     }
   }
 }
 if(elements.length>=20000)limited=true;
 const readText=(root,max=600,maxNodes=200)=>{
   const doc=root.ownerDocument||root,walker=doc.createTreeWalker(root,NodeFilter.SHOW_TEXT),words=[];let node,size=0,count=0;
   while(count++<maxNodes&&size<max&&(node=walker.nextNode())){
     const owner=node.parentElement||node.getRootNode().host,value=node.textContent.trim();
     if(owner&&value&&visible(owner)&&!excluded(owner)&&rendered(node)){words.push(value);size+=value.length+1;}
   }
   return words.join('\n').slice(0,max);
 };
`

export const READ_RESEARCH_PAGE=String.raw`(()=>{${SOURCE_DOM}
 const words=[];let size=0,count=0;
 for(const root of roots){
   if(size>=30000||count>=40000)break;
   const doc=root.nodeType===9?root:root.ownerDocument,body=root.nodeType===9?root.body:root;if(!body)continue;
   const walker=doc.createTreeWalker(body,NodeFilter.SHOW_TEXT);let node;
   while(size<30000&&count++<40000&&(node=walker.nextNode())){
     const owner=node.parentElement||node.getRootNode().host,value=node.textContent.trim();
     if(owner&&value&&visible(owner)&&!excluded(owner)&&rendered(node)){words.push(value);size+=value.length+1;}
   }
 }
 return {title:document.title,url:location.href,text:words.join('\n').slice(0,30000),unsupportedFrames:unsupported,truncated:limited||size>=30000||count>=40000};
})()`;

export const READ_SOURCE_LINKS=String.raw`(()=>{${SOURCE_DOM}
 const links=[],urls=new Set(),descriptions=new WeakMap();
 for(const e of elements){
   if(links.length>=120)break;
   if(e.tagName!=='A'||!e.href||!visible(e)||excluded(e)||!rendered(e))continue;
   let url;
   try{
     let target=new URL(e.href);
     if(/(^|\.)google\.com$/.test(target.hostname)&&target.pathname==='/url'){
       const destination=target.searchParams.get('q')||target.searchParams.get('url');if(destination)target=new URL(destination);
     }
     if(!['http:','https:'].includes(target.protocol)||target.username||target.password)continue;
     url=target.href;
   }catch{continue;}
   if(urls.has(url))continue;
   const heading=e.querySelector('h1,h2,h3');
   const title=((heading&&readText(heading,220,80))||readText(e,220,80)||e.getAttribute('aria-label')||'').trim().slice(0,220);
   if(!title)continue;
   const scope=e.closest('article,li,section,div');let description='';
   if(scope){if(!descriptions.has(scope))descriptions.set(scope,readText(scope));description=descriptions.get(scope);}
   urls.add(url);links.push({url,title,description});
 }
 return links;
})()`;
