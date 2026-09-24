import {READ_RENDERED_COLLECTIONS} from './collections';

/**
 * Adapted from browser-use/jev-ultrafast/jev_ultrafast/snapshot.js.
 * MIT License
 *
 * Copyright (c) 2026 Browser Use
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 */
export const READ_STATE = String.raw`(() => {
  if (!document.body) return null;
  const cache = window.__jevFast ||= {ids:new WeakMap(), nodes:new Map(), next:1};
  const identity = e => {
    if (!cache.ids.has(e)) cache.ids.set(e,cache.next++);
    const id=cache.ids.get(e); cache.nodes.set(id,e); return id;
  };
  // Keep references in the isolated world, including controls inside web components.
  // Composed ancestry matters for slots, disabled hosts, clipping and hit testing.
  const localParent = e => e?.assignedSlot || e?.parentElement || e?.getRootNode()?.host || null;
  const frameOf = doc => {
    if (!doc || doc===document) return null;
    try { return doc.defaultView?.frameElement || null; } catch { return null; }
  };
  const parent = e => localParent(e) || frameOf(e?.ownerDocument);
  // Only use geometry with a provable one-to-one CSS-pixel mapping. Never guess
  // coordinates through transformed/zoomed, detached, or cross-origin frames.
  const frameContext = doc => {
    let x=0,y=0,depth=0,current=doc;
    const chain=[];
    while (current!==document) {
      if (++depth>4) return null;
      const frame=frameOf(current);
      try {
        if (!frame?.isConnected || frame.contentDocument!==current || !frame.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})) return null;
        for (let p=frame;p;p=localParent(p)) {
          const s=getComputedStyle(p);
          if (s.transform!=='none' || s.perspective!=='none' ||
              s.rotate && s.rotate!=='none' || s.scale && s.scale!=='none' || s.translate && s.translate!=='none' ||
              !['1','normal',''].includes(s.zoom)) return null;
        }
        const s=getComputedStyle(frame),r=frame.getBoundingClientRect();
        if ([s.paddingLeft,s.paddingRight,s.paddingTop,s.paddingBottom].some(v=>parseFloat(v)!==0) ||
            Math.abs(r.width-frame.offsetWidth)>1 || Math.abs(r.height-frame.offsetHeight)>1) return null;
        x+=r.left+frame.clientLeft;y+=r.top+frame.clientTop;
        chain.push([identity(frame),identity(current.documentElement),current.URL,current.defaultView.scrollX,current.defaultView.scrollY,
          r.left,r.top,r.width,r.height,frame.clientLeft,frame.clientTop,frame.clientWidth,frame.clientHeight]);
        current=frame.ownerDocument;
      } catch { return null; }
    }
    return {x,y,chain};
  };
  const topRect = (e,r=e.getBoundingClientRect()) => {
    const context=frameContext(e.ownerDocument);
    return context ? {left:r.left+context.x,right:r.right+context.x,top:r.top+context.y,bottom:r.bottom+context.y} : null;
  };
  // An old iframe document can keep isConnected=true after its frame navigates.
  for (const [id,e] of cache.nodes) if (!e.isConnected || !frameContext(e.ownerDocument)) cache.nodes.delete(id);
  const closest = (e,selector) => {
    for (let p=e;p;p=parent(p)) if (p.matches?.(selector)) return p;
    return null;
  };
  const contains = (ancestor,e) => {
    for (let p=e;p;p=parent(p)) if (p===ancestor) return true;
    return false;
  };
  const collect = () => {
    const elements=[],roots=[document],documents=[document],seen=new Set(roots);
    let unsupported=0;
    for (let i=0;i<roots.length;i++) for (const e of roots[i].querySelectorAll('*')) {
      elements.push(e);
      if (e.shadowRoot) roots.push(e.shadowRoot);
      if (e.tagName==='IFRAME') {
        let child;
        try { child=e.contentDocument; } catch {}
        if (child?.documentElement && documents.length<17 && frameContext(child)) {
          if (!seen.has(child)) {roots.push(child);documents.push(child);seen.add(child);}
        } else unsupported++;
      }
    }
    return {elements,roots,documents,unsupported};
  };
  const {elements,roots,unsupported}=collect();
  cache.closest=closest; cache.contains=contains;
  cache.query=selector=>collect().roots.flatMap(root=>[...root.querySelectorAll(selector)]);
  cache.active=()=>{
    let e=document.activeElement;
    for (let depth=0;e && depth<32;depth++) {
      if (e.shadowRoot?.activeElement) e=e.shadowRoot.activeElement;
      else if (e.tagName==='IFRAME' && e.contentDocument && frameContext(e.contentDocument)) e=e.contentDocument.activeElement;
      else break;
    }
    return e;
  };
  const sensitive = e => ['password','file','hidden'].includes(e.type) ||
    /(?:password|passcode|api[ _-]?key|secret|token|credit.?card|card.?number|security.?code|ssn|social.?security)/i
      .test([e.name,e.id,e.getAttribute('aria-label'),e.getAttribute('placeholder'),e.autocomplete].join(' ')) ||
    /^(?:cc-|one-time-code|current-password|new-password)/i.test(e.autocomplete||'');
  const safe = e => !sensitive(e);
  const visible = e => !!frameContext(e.ownerDocument) && !closest(e,'[aria-hidden="true"],[inert]') &&
    e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
  const clipped = (e,r=e.getBoundingClientRect()) => {
    r=topRect(e,r);
    if (!r) return {left:0,right:0,top:0,bottom:0};
    let left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom);
    for (let p=parent(e);p;p=parent(p)) {
      const s=getComputedStyle(p),b=topRect(p);
      if (!b) return {left:0,right:0,top:0,bottom:0};
      if (p.tagName==='IFRAME' || /(auto|scroll|hidden|clip)/.test(s.overflowX)) {left=Math.max(left,b.left+p.clientLeft);right=Math.min(right,b.left+p.clientLeft+p.clientWidth);}
      if (p.tagName==='IFRAME' || /(auto|scroll|hidden|clip)/.test(s.overflowY)) {top=Math.max(top,b.top+p.clientTop);bottom=Math.min(bottom,b.top+p.clientTop+p.clientHeight);}
    }
    return {left,right,top,bottom};
  };
  cache.point=(e,position)=>{
    if (!e?.isConnected || !visible(e)) return null;
    const r=clipped(e);
    if (r.right<=r.left || r.bottom<=r.top) return null;
    // A center-only hit test misses links partially covered by badges and sticky headers.
    if (position && (!Number.isFinite(position.x) || !Number.isFinite(position.y) || position.x<0 || position.x>1 || position.y<0 || position.y>1)) return null;
    for (const [fx,fy] of position?[[position.x,position.y]]:[[.5,.5],[.2,.2],[.8,.2],[.2,.8],[.8,.8]]) {
      const full=position?topRect(e):r;
      const x=full.left+(full.right-full.left)*fx,y=full.top+(full.bottom-full.top)*fy;
      if (x<r.left || x>=r.right || y<r.top || y>=r.bottom) continue;
      let hit=document.elementFromPoint(x,y),depth=0;
      while (hit && depth++<32) {
        let inner;
        if (hit.shadowRoot) {
          const context=frameContext(hit.ownerDocument);
          if (!context) break;
          inner=hit.shadowRoot.elementFromPoint(x-context.x,y-context.y);
        } else if (hit.tagName==='IFRAME') {
          let child;
          try { child=hit.contentDocument; } catch {}
          const context=child && frameContext(child);
          if (!context) break;
          inner=child.elementFromPoint(x-context.x,y-context.y);
        }
        if (!inner || inner===hit) break;
        hit=inner;
      }
      if (contains(e,hit) && !(position && closest(hit,'a,button,input,textarea,select,[role="button"],[contenteditable]:not([contenteditable="false"])'))) return {x,y};
    }
    return null;
  };
  const columnName=e=>{
    if(!e.matches('input,textarea,select'))return '';
    const cell=closest(e,'td,th,[role="cell"],[role="gridcell"]'),table=cell&&closest(cell,'table,[role="grid"],[role="table"]');
    if(!cell||!table)return '';
    const explicit=(cell.getAttribute('headers')||'').split(/\s+/).map(id=>e.ownerDocument.getElementById(id)?.innerText?.trim()).filter(Boolean).join(' ');
    if(explicit)return explicit.slice(0,160);
    const cells=[...cell.parentElement.children].filter(c=>c.matches('td,th,[role="cell"],[role="gridcell"]'));
    let column=Number(cell.getAttribute('aria-colindex'))-1;
    if(column<0)column=cells.slice(0,cells.indexOf(cell)).reduce((n,c)=>n+Number(c.getAttribute('colspan')||1),0);
    for(const row of table.querySelectorAll('thead tr,[role="row"]')) {
      let index=0;
      for(const header of row.children) {
        const span=Number(header.getAttribute('colspan')||1),start=header.hasAttribute('aria-colindex')?Number(header.getAttribute('aria-colindex'))-1:index;
        index=start+span;
        if(column>=start&&column<index&&header!==cell&&header.matches('th,[role="columnheader"]')&&!header.querySelector('input,select,textarea')) {
          const text=header.innerText?.trim().replace(/\s+/g,' ');if(text)return text.slice(0,160);
        }
      }
    }
    return '';
  };
  const nameVisible = e => {
    if (visible(e)) return true;
    // display:contents has no box, while its children can still label a control.
    if (getComputedStyle(e).display!=='contents' || closest(e,'[hidden],[aria-hidden="true"],[inert]')) return false;
    for (let p=e;p;p=parent(p)) {
      const style=getComputedStyle(p);
      if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||Number(style.opacity)===0)return false;
    }
    return true;
  };
  const name = (e,seen=new Set(),explicitReference=false) => {
    if (!e || seen.has(e)) return '';
    seen.add(e);
    const referenced=(e.getAttribute('aria-labelledby')||'').split(/\s+/)
      .map(id=>name(e.getRootNode().getElementById?.(id)||e.ownerDocument.getElementById(id),seen,true)).filter(Boolean).join(' ');
    const label=referenced || e.getAttribute('aria-label') ||
      [...(e.labels||[])].map(l=>name(l,seen,true)).filter(Boolean).join(' ') ||
      (['button','submit','reset'].includes(e.type) ? e.value : '') || e.getAttribute('alt') ||
      (e.tagName==='INPUT' ? '' : [...(e.shadowRoot?.childNodes||e.childNodes)].map(n=>n.nodeType===3 ? n.textContent :
        n.nodeType===1 && !n.matches('script,style,noscript,template') &&
          (explicitReference || nameVisible(n)) ? name(n,seen,explicitReference) : '').join(' ').trim()) ||
      e.getAttribute('title') || e.getAttribute('placeholder') || '';
    const column=columnName(e);
    return column&&!label.includes(column)?column+(label?' '+label:''):label;
  };
  const roles=['button','link','checkbox','radio','switch','tab','menuitem','menuitemradio',
    'option','gridcell','combobox','textbox','searchbox','spinbutton'];
  const selector='a[href],button,input,textarea,select,summary,th,[role="columnheader"],[contenteditable="true"],'+
    roles.map(role=>'[role="'+role+'"]').join(',');
  // Games often render ordinary buttons as divs/spans. Use their rendered
  // interaction affordance, not class names or guessed event-handler names.
  const customHint=e=>{
    if (!e?.matches?.('div,span,img,svg,li,label,i,[onclick],[tabindex]') || e.matches(selector) ||
        e.matches('html,body,iframe,canvas,[role="application"],[role="grid"]') ||
        e.querySelector('canvas,[role="application"],[role="grid"],'+selector)) return false;
    if (!(e.hasAttribute('onclick') || e.tabIndex>=0 || getComputedStyle(e).cursor==='pointer')) return false;
    const r=e.getBoundingClientRect();
    return r.width>0 && r.height>0 && name(e).length<=200;
  };
  const customControl=e=>{
    if(!customHint(e))return false;
    // Inherited pointer cursors are one control, not one target for every text
    // and icon descendant. Keep its outer hit area and a single visible label.
    for(let p=localParent(e);p;p=localParent(p))if(p.matches(selector)||customHint(p))return false;
    return true;
  };
  const role = e => {
    const explicit=e.getAttribute('role');
    if (roles.includes(explicit)) return explicit;
    if(e.matches('th,[role="columnheader"]')&&!e.querySelector('a,button,input,select,[role="button"]')&&
       (e.hasAttribute('onclick')||e.hasAttribute('aria-sort')||getComputedStyle(e).cursor==='pointer'))return 'button';
    if (e.tagName==='BUTTON' || e.tagName==='SUMMARY') return 'button';
    if (e.tagName==='A' && e.hasAttribute('href')) return 'link';
    if (e.tagName==='SELECT') return 'combobox';
    if (e.tagName==='TEXTAREA' || e.isContentEditable) return 'textbox';
    if (e.tagName==='INPUT') {
      if (['checkbox','radio'].includes(e.type)) return e.type;
      if (['button','submit','reset','image'].includes(e.type)) return 'button';
      if (e.type==='search') return 'searchbox';
      if (e.type==='number') return 'spinbutton';
      if (['text','email','url','tel'].includes(e.type)) return 'textbox';
    }
    return customControl(e)?'button':null;
  };
  const scrollable=e=>e!==document.body && e!==document.documentElement && e.clientHeight>0 &&
    e.scrollHeight>e.clientHeight+2 && (e.ownerDocument!==document && e===e.ownerDocument.scrollingElement || /^(auto|scroll)$/.test(getComputedStyle(e).overflowY));
  const modalSelector='dialog[open],[role="dialog"],[role="alertdialog"],[aria-modal="true"]';
  cache.blockingDialogs=e=>{
    const documents=new Set();
    for(let p=e;p;p=parent(p))documents.add(p.ownerDocument);
    return cache.query(modalSelector).filter(d=>documents.has(d.ownerDocument) && !contains(d,e) && visible(d) && cache.point(d));
  };
  cache.keyboardSurface=e=>{
    if (!e?.isConnected || !visible(e) || e.matches(':disabled') || closest(e,'form,[aria-disabled="true"],input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return false;
    if (!e.matches('canvas,[role="application"],[role="grid"]') || e.tagName!=='CANVAS' && e.querySelector('canvas')) return false;
    const r=e.getBoundingClientRect();
    if (r.width<80 || r.height<80) return false;
    // Modal controls must be handled before sending keys to an underlying board.
    // Ancestor-page dialogs also block embedded games; a game's own containing
    // dialog is not an overlay, and unrelated sibling frames do not own focus.
    return !cache.blockingDialogs(e).length;
  };
  cache.surfaceRect=e=>{
    // Calibration and native input must share the same top-viewport mapping,
    // including supported same-origin frames and their borders/scroll offsets.
    if (!cache.keyboardSurface(e) || !cache.point(e)) return null;
    const r=topRect(e);
    if (!r) return null;
    // Keep the full surface origin/size: clipping must not change normalized
    // board coordinates. cache.point still rejects every covered/clipped input.
    return {x:r.left,y:r.top,width:r.right-r.left,height:r.bottom-r.top};
  };
  cache.pageKey=()=>{
    const collection=collect(),current=collection.elements;
    return [performance.timeOrigin,location.href,scrollX,scrollY,innerWidth,innerHeight,
      current.filter(e=>e.matches('input,textarea,select,[contenteditable="true"]') && safe(e))
        .map(e=>[identity(e),e.isContentEditable?e.innerText:e.value,e.checked,e.selectedIndex,e.disabled,e.readOnly]),
      current.filter(scrollable).map(e=>[identity(e),e.scrollTop,e.scrollLeft]),
      collection.documents.filter(doc=>doc!==document).map(doc=>frameContext(doc)?.chain)];
  };
  cache.guard=e=>{
    if (!e?.isConnected || !visible(e)) return null;
    const scope=closest(e,'form,dialog,[role="dialog"],article,li,tr,[role="row"]') || parent(e);
    return [identity(e),role(e),scrollable(e)?e.getAttribute('aria-label')||e.getAttribute('title')||'scroll panel':name(e),e.value??null,e.checked??null,e.selectedIndex??null,
      e.readOnly??null,e.matches(':disabled'),e.getAttribute('aria-disabled'),
      e.getAttribute('aria-expanded'),e.getAttribute('aria-checked'),e.getAttribute('aria-selected'),
      e.getAttribute('href'),scope?.innerText?.slice(0,6000)||'',e.scrollTop,e.scrollLeft,
      !!closest(e,'[aria-disabled="true"],[inert]'),e.getAttribute('aria-readonly'),
      e.form?.method||'',e.form?.action||'',e.form?.getAttribute('role')||'',frameContext(e.ownerDocument)?.chain];
  };
  const gameOverlays=new Set(elements.filter(e=>e.matches('canvas,[role="application"],[role="grid"]') && visible(e))
    .flatMap(e=>cache.blockingDialogs(e)));
  const actions=[];
  for (const e of elements) {
    if (e.tagName==='IFRAME' || !safe(e) || !visible(e) || e.matches(':disabled') || closest(e,'[aria-disabled="true"]')) continue;
    const r=e.getBoundingClientRect(),rname=role(e);
    if (!rname || !cache.point(e)) continue;
    if (rname==='gridcell' && e.querySelector('button,[role="button"]')) continue;
    let popup=closest(e,'[role="listbox"],[role="menu"],'+modalSelector);
    // Some widgets render ARIA menu items in presentation-only lists. Preserve
    // their local choice context without treating navigation menus as popups.
    if(!popup && ['menuitem','menuitemradio','option'].includes(rname) &&
       !closest(e,'nav,[role="navigation"],[role="menubar"],select')) {
      const list=closest(e,'ul,ol,[role="list"]');
      if(list && [...list.querySelectorAll('[role="menuitem"],[role="menuitemradio"],[role="option"]')]
        .filter(item=>visible(item)&&closest(item,'ul,ol,[role="list"]')===list).length>1) popup=list;
    }
    const named=name(e),scope=popup||closest(e,'form,dialog,[role="dialog"]') || (!named ? parent(e) : null);
    const card=scope?null:closest(e,'article,li,[role="listitem"],tr');
    const context=scope?.innerText?.trim().slice(0,1200)||card?.innerText?.trim().replace(/\s+/g,' ').slice(0,300)||'';
    let label=named||rname;
    if (!named && context && rname==='button') {
      const box=scope.getBoundingClientRect(),x=(r.left+r.width/2-box.left)/Math.max(1,box.width),y=(r.top+r.height/2-box.top)/Math.max(1,box.height);
      const position=(y<.35?'top ':y>.65?'bottom ':'')+(x<.35?'left':x>.65?'right':'center');
      label='Unlabeled button at '+position+' of “'+context.replace(/\s+/g,' ').slice(0,160)+'”';
    }
    const viewportRect=topRect(e);
    const base={node:identity(e),role:rname,label,
      input_type:e.type||'', href:e.tagName==='A' ? e.href : undefined,
      context,
      ...(popup?{popup:true}:{}),
      ...(e.ownerDocument!==document?{frame:e.ownerDocument.title||frameOf(e.ownerDocument)?.title||e.ownerDocument.URL}:{}),
      form_method:e.form?.method||'', form_role:e.form?.getAttribute('role')||'',
      rect:{x:viewportRect.left,y:viewportRect.top,w:viewportRect.right-viewportRect.left,h:viewportRect.bottom-viewportRect.top}};
    for (const key of ['checked','selected','expanded']) {
      const value=e.getAttribute('aria-'+key);
      if (value!==null) base[key]=value;
    }
    if (['checkbox','radio'].includes(e.type)) base.checked=String(e.checked);
    if (e.tagName==='SELECT') {
      for (const o of e.options) if (!o.selected && !o.disabled && !o.closest('optgroup[disabled]'))
        actions.push({...base,kind:'select',value:o.value,
          current_value:[...e.selectedOptions].map(o=>o.label).join(', '),label:base.label+' → '+o.label});
    } else {
      const editable=!e.readOnly && e.getAttribute('aria-readonly')!=='true' &&
        (['textbox','searchbox','spinbutton'].includes(rname) ||
          (rname==='combobox' && ['INPUT','TEXTAREA'].includes(e.tagName)));
      const value='value' in e ? String(e.value) :
        e.isContentEditable || rname==='combobox' ? e.innerText.trim() : '';
      actions.push({...base,kind:editable?'fill':'click',value});
      if (editable) {
        if(e.ownerDocument.activeElement!==e||rname==='combobox'||e.hasAttribute('list')||e.hasAttribute('aria-haspopup')||e.hasAttribute('aria-expanded')||['date','datetime-local','time','month','week'].includes(e.type))
          actions.push({...base,kind:'click',value,label:'Open '+base.label});
        const search=rname==='searchbox' || e.type==='search' || base.form_role==='search' || /\b(search|find|filter)\b/i.test(base.label);
        if (search && value.trim() && ['INPUT','TEXTAREA'].includes(e.tagName))
          actions.push({...base,kind:'press',key:'Enter',value,label:'Submit '+base.label});
      }
    }
  }
  const words=[];
  let node,length=0;
  for (const root of roots) {
    const ownerDoc=root.nodeType===9?root:root.ownerDocument,body=root.nodeType===9?root.body:root;
    if (!body) continue;
    const walker=ownerDoc.createTreeWalker(body,NodeFilter.SHOW_TEXT),range=ownerDoc.createRange();
    while ((node=walker.nextNode()) && length<6000) {
      const value=node.textContent.trim(), owner=node.parentElement||node.getRootNode().host;
      if (!value || !owner || closest(owner,'script,style,noscript,template,textarea') || !visible(owner)) continue;
      range.selectNodeContents(node); const r=clipped(owner,range.getBoundingClientRect());
      if (r.right>r.left && r.bottom>r.top) { words.push(value); length+=value.length; }
    }
  }
  const text=words.join('\n').slice(0,6000), height=document.documentElement.scrollHeight;
  // Read rendered table cells beyond the viewport without scrolling or inventing
  // actions. This is ordinary document text, never hidden application state.
  const tables=[];let tableBudget=10000;
  for(const table of elements.filter(e=>e.matches('table,[role="table"]')&&visible(e)).slice(0,8)) {
    const result={headers:[],rows:[],truncated:false};
    const surrounding=(table.parentElement?.parentElement?.innerText||'').replace(table.innerText,'').trim().replace(/\s+/g,' ');
    if(surrounding)result.context=surrounding.slice(-1200);
    const rows=[...table.querySelectorAll('tr,[role="row"]')].filter(row=>closest(row,'table,[role="table"]')===table&&visible(row));
    for(const row of rows) {
      const cells=[...row.children].filter(cell=>cell.matches('td,th,[role="cell"],[role="gridcell"],[role="columnheader"]')&&visible(cell));
      const values=cells.map(cell=>cell.innerText.trim().replace(/\s+/g,' '));
      if(!values.some(Boolean))continue;
      const size=values.reduce((sum,value)=>sum+value.length,0);
      if(size>tableBudget||result.rows.length>=100){result.truncated=true;break;}
      tableBudget-=size;
      if(!result.headers.length&&cells.some(cell=>cell.matches('th,[role="columnheader"]')))result.headers=values;
      else result.rows.push(values);
    }
    if(result.headers.length||result.rows.length)tables.push(result);
  }
  const collections=${READ_RENDERED_COLLECTIONS};
  // Limit controls, not individual dropdown options. A long timezone list must
  // not hide every link/button that follows the select in document order.
  const offeredNodes=new Set();let omitted_actions=0;
  for(let i=0;i<actions.length;) {
    const node=actions[i].node;
    if(!offeredNodes.has(node)&&offeredNodes.size>=250){actions.splice(i,1);omitted_actions++;}
    else {offeredNodes.add(node);i++;}
  }
  actions.forEach((a,i)=>a.id='e'+(i+1));
  for (const e of elements.filter(e=>e.matches('canvas,[role="application"],[role="grid"]')).filter(e=>cache.keyboardSurface(e) && cache.point(e)).slice(0,4)) {
    const node=identity(e),label=name(e).slice(0,160)||(e.tagName==='CANVAS'?'Game canvas':'Game board');
    actions.push({id:'point_'+node,node,kind:'point',role:e.tagName==='CANVAS'?'canvas':e.getAttribute('role'),label:label+' → click position',
      ...(e.ownerDocument!==document?{frame:e.ownerDocument.title||e.ownerDocument.URL}:{})});
    for (const key of ['ArrowLeft','ArrowUp','ArrowRight','ArrowDown','w','a','s','d',' ','Enter']) actions.push({
      id:'key_'+key+'_'+node,node,kind:'key',role:e.tagName==='CANVAS'?'canvas':e.getAttribute('role'),key,label:label+' → '+(key===' '?'Space':key),
      ...(e.ownerDocument!==document?{frame:e.ownerDocument.title||e.ownerDocument.URL}:{})
    });
  }
  for (const e of elements.filter(scrollable).filter(e=>visible(e) && cache.point(e)).slice(0,16)) {
    const node=identity(e),label=(e.getAttribute('aria-label') || e.getAttribute('title') || e.innerText?.trim().slice(0,90) || 'panel').replace(/\s+/g,' ');
    const base={node,kind:'scroll',role:'region'};
    if (e.scrollTop+e.clientHeight<e.scrollHeight-2) actions.push({...base,id:'scroll_down_'+node,label:'Scroll down in '+label,delta:Math.max(120,Math.round(e.clientHeight*.8))});
    if (e.scrollTop>0) actions.push({...base,id:'scroll_up_'+node,label:'Scroll up in '+label,delta:-Math.max(120,Math.round(e.clientHeight*.8))});
  }
  if (scrollY+innerHeight<height-2) actions.push({id:'scroll_down',kind:'scroll',label:'Scroll down',delta:560});
  if (scrollY>0) actions.push({id:'scroll_up',kind:'scroll',label:'Scroll up',delta:-560});
  actions.push({id:'wait',kind:'wait',label:'Wait for the page to update'});
  const page_key=cache.pageKey(),guards={};
  for (const a of actions) if (a.node && !(a.node in guards)) guards[a.node]=cache.guard(cache.nodes.get(a.node));
  // Compare meaning and identity. Geometry is resolved and hit-tested immediately before input.
  const semantics=actions.map(({rect,...action})=>action);
  const marker=[performance.timeOrigin,location.href,scrollX,scrollY,innerWidth,innerHeight,
    document.title,text,semantics,page_key[6],page_key[7],page_key[8],tables,collections,gameOverlays.size>0];
  return {url:location.href,title:document.title,w:innerWidth,h:innerHeight,text,
    scroll:{y:scrollY,height},tables,collections,actions,marker,page_key,guards,omitted_actions,unsupported_frames:unsupported,game_overlay:gameOverlays.size>0};
})()`;
