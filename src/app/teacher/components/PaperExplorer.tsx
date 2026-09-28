import { useEffect, useMemo, useRef, useState, type ReactNode, type MouseEvent, type DragEvent } from 'react';
import { Folder, FolderPlus, Home, ChevronDown, ChevronRight, Copy, Scissors, ClipboardPaste, Trash2, Search, Pencil, Link2, RefreshCw, FolderInput } from 'lucide-react';
import { Drawer } from '@/components/ui/drawer';
import { useSessionStore } from '@/store/session.store';
import type { Pdf } from '@/lib/ngs-client';
import { loadExplorer, saveExplorer, projectEntries, folderPath, addFolder, renameFolder, deleteFolderTree, transferEntries, removeCopies, moveExplorerFolder, copyExplorerFolder, type ExplorerFolder, type ExplorerState } from '@/lib/paper-explorer';

function Tool({label, children, disabled, onClick}:{label:string;children:ReactNode;disabled?:boolean;onClick:()=>void}) {
 return <span className="group relative inline-flex"><button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="inline-flex size-8 items-center justify-center rounded-md text-ink-muted hover:bg-neutral-weak focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-30">{children}</button><span role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-30 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-[var(--hc-color-text)] px-2 py-1 text-xs text-white group-hover:block group-focus-within:block">{label}</span></span>;
}
const EMPTY:ExplorerState={version:1,revision:0,folders:[],entries:[]};
export function PaperExplorer({pdfs,renderPaper,onDeletePdfs,disabled=false,headerActions,sortControl,filterControl,paperFilter,filterActive=false,filterKey,onOpenPdf,paperSearchText,refreshKey=0}:{paperSearchText?:(pdf:Pdf)=>string;headerActions?:(folderId:string|null,path:string,blocked:boolean)=>ReactNode;sortControl?:ReactNode;filterControl?:ReactNode;paperFilter?:(pdf:Pdf)=>boolean;filterActive?:boolean;filterKey?:string;onOpenPdf?:(pdf:Pdf)=>void;pdfs:Pdf[];disabled?:boolean;renderPaper:(pdf:Pdf,checked:boolean,toggle:()=>void,deleteEntry:()=>void)=>ReactNode;onDeletePdfs:(ids:number[])=>void;refreshKey?:number}) {
 const account=useSessionStore(s=>s.profile?.id);
 const [state,setState]=useState<ExplorerState>(EMPTY);
 const [owner,setOwner]=useState(''); const [ready,setReady]=useState(false); const [error,setError]=useState('');
 const [busy,setBusy]=useState(false); const lock=useRef(false); const generation=useRef(0);
 const [current,setCurrent]=useState<string|null>(null); const [query,setQuery]=useState('');
 const [expanded,setExpanded]=useState<Set<string>>(new Set());
 const [selected,setSelected]=useState<Set<string>>(new Set());
 const [clipboard,setClipboard]=useState<{ids:string[];folderId?:string;mode:'copy'|'cut'}|null>(null);
 const [editor,setEditor]=useState<{id:string|null;name:string;parentId:string|null}|null>(null);
 const [confirmation,setConfirmation]=useState<{kind:'folder';id:string}|{kind:'copies';ids:string[]}|null>(null);
 const [movingFolder,setMovingFolder]=useState<{id:string;target:string|null}|null>(null);
 const [notice,setNotice]=useState('');
 const root=useRef<HTMLElement>(null);
 const listRef=useRef<HTMLDivElement>(null);
 const [explorerHeight,setExplorerHeight]=useState<number>();
 const anchor=useRef<string|null>(null);
 const previousFilterKey=useRef(filterKey);
 const dragAllowed=useRef(true);
 const drag=useRef<({token:string;ids:string[];generation:number;kind:'files'}|{token:string;folderId:string;generation:number;kind:'folder'})|null>(null);
 const [dragTarget,setDragTarget]=useState<string|null|undefined>(undefined);
 const [menu,setMenu]=useState<{x:number;y:number;kind:'files'|'folder'|'blank';folderId:string|null}|null>(null);
 const menuRef=useRef<HTMLDivElement>(null);
 const blocked=disabled||busy||!ready;
 const clearSelection=()=>{setSelected(new Set());anchor.current=null;};
 useEffect(()=>{
  const main=root.current?.closest('main');
  if(!main)return;
  const updateHeight=()=>{
   if(!root.current)return;
   const top=root.current.getBoundingClientRect().top-main.getBoundingClientRect().top+main.scrollTop;
   setExplorerHeight(Math.max(320,Math.floor(main.clientHeight-top-24)));
  };
  updateHeight();
  const observer=new ResizeObserver(updateHeight);
  observer.observe(main);
  window.addEventListener('resize',updateHeight);
  return()=>{observer.disconnect();window.removeEventListener('resize',updateHeight);};
 },[]);
 useEffect(()=>{if(listRef.current)listRef.current.scrollTop=0;},[current,query,filterKey]);
 useEffect(()=>{
  if(!menu)return;
  menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  const close=(event:Event)=>{if(!menuRef.current?.contains(event.target as Node))setMenu(null);};
  const dismiss=()=>setMenu(null);
  document.addEventListener('pointerdown',close);
  window.addEventListener('resize',dismiss);
  window.addEventListener('scroll',close,true);
  return()=>{document.removeEventListener('pointerdown',close);window.removeEventListener('resize',dismiss);window.removeEventListener('scroll',close,true);};
 },[menu]);
 const pdfIds=useMemo(()=>pdfs.map(p=>p.id),[pdfs]);
 const entries=useMemo(()=>ready?projectEntries(state,pdfIds):[],[state,pdfIds,ready]);
 const byId=useMemo(()=>new Map(pdfs.map(p=>[p.id,p])),[pdfs]);
 const sortRank=useMemo(()=>new Map(pdfs.map((p,index)=>[p.id,index])),[pdfs]);
 const crumbs=folderPath(state,current&&state.folders.some(f=>f.id===current)?current:null);
 const search=query.normalize('NFC').trim().toLocaleLowerCase();
 const visible=entries.filter(e=>{const p=byId.get(e.pdfId)!;return (!paperFilter||paperFilter(p))&&(search?`${e.name??''} ${p.title??''} ${paperSearchText?.(p)??''} ${folderPath(state,e.parentId).map(folder=>folder.name).join(' ')}`.normalize('NFC').toLocaleLowerCase().includes(search):e.parentId===current);}).sort((a,b)=>(sortRank.get(a.pdfId)??0)-(sortRank.get(b.pdfId)??0));
 const folders=ready?state.folders.filter(f=>search?[...folderPath(state,f.id).map(folder=>folder.name)].join(' ').normalize('NFC').toLocaleLowerCase().includes(search):f.parentId===current):[];
 const folderChildren=useMemo(()=>{const children=new Map<string|null,ExplorerFolder[]>();for(const folder of state.folders){const siblings=children.get(folder.parentId)??[];siblings.push(folder);children.set(folder.parentId,siblings);}return children;},[state.folders]);
 const orderedFolders=useMemo(()=>{const ordered:ExplorerFolder[]=[];const visit=(parentId:string|null)=>{for(const folder of folderChildren.get(parentId)??[]){ordered.push(folder);visit(folder.id);}};visit(null);return ordered;},[folderChildren]);
 const selectedEntries=previousFilterKey.current===filterKey?entries.filter(e=>selected.has(e.id)&&(!paperFilter||paperFilter(byId.get(e.pdfId)!))):[];
 const reload=async(preserveCurrent=false)=>{
  const run=++generation.current;
  lock.current=true;setBusy(true);setReady(false);setError('');setNotice('');
  setMenu(null);setEditor(null);setConfirmation(null);setMovingFolder(null);drag.current=null;setDragTarget(undefined);
  try{
   const loaded=await loadExplorer();
   if(run!==generation.current)return;
   const saved=loaded.state;
   setOwner(loaded.userId);setState(saved);setCurrent(previous=>preserveCurrent&&previous&&saved.folders.some(f=>f.id===previous)?previous:null);if(!preserveCurrent)setExpanded(new Set());clearSelection();setClipboard(null);setReady(true);
  }catch(reason){if(run===generation.current)setError(reason instanceof Error?reason.message:'폴더를 불러오지 못했습니다.');}
  finally{if(run===generation.current){lock.current=false;setBusy(false);}}
 };
 // cleanup 시점에 ref 가 달라질 수 있다 — effect 안에서 지역 변수로 잡아 쓴다.
 useEffect(()=>{const run=generation;setState(EMPTY);setOwner('');setCurrent(null);setSelected(new Set());setClipboard(null);void reload();return()=>{run.current++;};},[account]);
 useEffect(()=>{if(refreshKey>0)void reload(true);},[refreshKey]);
 useEffect(()=>{clearSelection();setMenu(null);},[current,query]);
 useEffect(()=>{if(previousFilterKey.current===filterKey)return;previousFilterKey.current=filterKey;setSelected(new Set());anchor.current=null;setMenu(null);},[filterKey]);
 useEffect(()=>{setSelected(s=>new Set([...s].filter(id=>entries.some(e=>e.id===id))));},[entries]);
 const mutate=async(op:(s:ExplorerState)=>ExplorerState,message:string)=>{if(lock.current||!ready||disabled)return false;lock.current=true;setBusy(true);setError('');const run=generation.current;try{const next=op(state);const saved=await saveExplorer(owner,next,state.revision);if(run!==generation.current)return false;setState(saved);setNotice(message);return true;}catch(e){if(run===generation.current)setError(e instanceof Error?e.message:'저장하지 못했습니다. 다시 시도해 주세요.');return false;}finally{if(run===generation.current){lock.current=false;setBusy(false);}}};
 const navigate=(id:string|null)=>{if(blocked||lock.current)return;if(id)setExpanded(previous=>new Set([...previous,...folderPath(state,id).map(folder=>folder.id)]));setCurrent(id);setQuery('');clearSelection();setMenu(null);};
 const copy=(mode:'copy'|'cut')=>{if(blocked||lock.current||!selectedEntries.length)return;setClipboard({ids:selectedEntries.map(e=>e.id),mode});setNotice(mode==='copy'?'붙여넣을 폴더를 선택하세요. 복사본은 원본 PDF와 필기 기록을 함께 사용합니다.':'이동할 폴더를 선택한 뒤 붙여넣으세요.');};
 const paste=async(target:string|null=current)=>{if(blocked||lock.current||!clipboard)return;const clip=clipboard;if(await mutate(s=>{if(!clip.folderId)return transferEntries(s,clip.ids,target,clip.mode,pdfIds);if(clip.mode==='cut')return moveExplorerFolder(s,clip.folderId,target);const base=s.folders.find(f=>f.id===clip.folderId)?.name;if(!base)throw new Error('복사할 폴더가 없습니다.');let name=base;let n=1;while(s.folders.some(f=>f.parentId===target&&f.name===name))name=`${base} 복사본 ${n++}`;return copyExplorerFolder(s,clip.folderId,target,name);},clip.mode==='copy'?'연결된 복사본을 만들었습니다.':'선택한 교재를 이동했습니다.')){setSelected(new Set());if(clip.mode==='cut')setClipboard(null);}};
 const deleteSelection=()=>{if(blocked||lock.current||!selectedEntries.length)return;const originals=selectedEntries.filter(e=>e.id.startsWith('pdf:'));if(originals.length&&originals.length!==selectedEntries.length){setError('원본과 연결된 복사본은 따로 선택해 삭제해 주세요.');return;}if(originals.length){onDeletePdfs([...new Set(originals.map(e=>e.pdfId))]);}else setConfirmation({kind:'copies',ids:selectedEntries.map(e=>e.id)});};
 const toggle=(id:string)=>{if(blocked||lock.current)return;anchor.current=id;setSelected(s=>{const n=new Set(s);if(n.has(id))n.delete(id);else n.add(id);return n;});};
 const selectAll=()=>{if(!blocked)setSelected(new Set(visible.map(e=>e.id)));};
 // Only the rendered title and row background belong to selection. Child controls retain their handlers.
 const isRowTarget=(target:EventTarget)=>{
  const element=target as HTMLElement;
  if(element.closest('input,label,select,textarea,a,[role="group"],[data-explorer-control],[contenteditable="true"]'))return false;
  const button=element.closest('button');
  return !button||button.matches('[data-paper-title]')||!!button.getAttribute('aria-label')?.endsWith(' 미리보기');
 };
 const selectRow=(id:string,event:MouseEvent)=>{
  if(!isRowTarget(event.target))return;
  event.preventDefault();event.stopPropagation();
  if(blocked||lock.current)return;
  root.current?.focus({preventScroll:true});setMenu(null);
  if(event.detail>1)return;
  if(event.shiftKey){
   const start=visible.findIndex(e=>e.id===anchor.current),end=visible.findIndex(e=>e.id===id);
   const ids=start<0?[id]:visible.slice(Math.min(start,end),Math.max(start,end)+1).map(e=>e.id);
   setSelected(previous=>new Set([...(event.ctrlKey||event.metaKey?previous:[]),...ids]));
   if(start<0)anchor.current=id;
  }else if(event.ctrlKey||event.metaKey)toggle(id);
  else{anchor.current=id;setSelected(new Set([id]));const entry=entries.find(value=>value.id===id);const pdf=entry&&byId.get(entry.pdfId);if(pdf&&(event.target as HTMLElement).closest('[data-paper-title],button[aria-label$=" 미리보기"]'))onOpenPdf?.({...pdf,title:entry.name??pdf.title});}
 };
 const openMenu=(event:MouseEvent,kind:'files'|'folder'|'blank',folderId:string|null=current)=>{
  event.preventDefault();event.stopPropagation();if(blocked||lock.current)return;
  setMenu({kind,folderId,x:Math.max(8,Math.min(event.clientX,window.innerWidth-232)),y:Math.max(8,Math.min(event.clientY,window.innerHeight-360))});
 };
 const copyFolder=(id:string,mode:'copy'|'cut')=>{if(blocked||lock.current)return;setClipboard({ids:[],folderId:id,mode});setNotice(mode==='copy'?'붙여넣을 폴더를 선택하세요. 교재 복사본은 원본 PDF와 필기 기록을 함께 사용합니다.':'이동할 폴더를 선택한 뒤 붙여넣으세요.');};
 const mime='application/x-paper-explorer';
 const startFolderDrag=(event:DragEvent,id:string)=>{if(blocked||lock.current){event.preventDefault();return;}const token=crypto.randomUUID();drag.current={token,folderId:id,generation:generation.current,kind:'folder'};event.dataTransfer.effectAllowed='move';event.dataTransfer.setData(mime,JSON.stringify({token,kind:'folder',folderId:id}));setMenu(null);};
 const acceptsDrag=(event:DragEvent)=>!blocked&&!lock.current&&!!drag.current&&drag.current.generation===generation.current&&Array.from(event.dataTransfer.types).includes(mime)&&!Array.from(event.dataTransfer.types).includes('Files');
 const dropProps=(id:string|null)=>({
  'data-folder-id':id??'root',
  'data-drag-target':dragTarget===id,
  onDragOver:(event:DragEvent)=>{if(!acceptsDrag(event))return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';setDragTarget(id);},
  onDragLeave:(event:DragEvent)=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setDragTarget(undefined);},
  onDrop:(event:DragEvent)=>{
   // Never interpret OS files, arbitrary text or drags from another explorer/tab.
   if(!acceptsDrag(event))return;
   event.preventDefault();event.stopPropagation();setDragTarget(undefined);
   const local=drag.current;drag.current=null;
   try{
    const payload:unknown=JSON.parse(event.dataTransfer.getData(mime));
    if(!local||!payload||typeof payload!=='object'||!('token' in payload)||payload.token!==local.token)throw new Error('이동할 항목을 다시 선택해 주세요.');
    if(local.kind==='folder'){
     if(!('kind' in payload)||payload.kind!=='folder'||!('folderId' in payload)||payload.folderId!==local.folderId)throw new Error('이동할 폴더를 다시 선택해 주세요.');
     if(local.folderId===id)return;
     void mutate(s=>moveExplorerFolder(s,local.folderId,id),'폴더를 이동했습니다.');
    }else{
     if(!('ids' in payload)||!Array.isArray(payload.ids)||payload.ids.length!==local.ids.length||!payload.ids.every((value,index)=>typeof value==='string'&&value===local.ids[index])||!local.ids.length||local.ids.some(value=>!entries.some(entry=>entry.id===value)))throw new Error('이동할 교재를 다시 선택해 주세요.');
     void mutate(s=>transferEntries(s,local.ids,id,'cut',pdfIds),`${local.ids.length}개 교재를 이동했습니다.`).then(ok=>{if(ok){clearSelection();setClipboard(clip=>clip?.mode==='cut'&&clip.ids.some(value=>local.ids.includes(value))?null:clip);}});
    }
   }catch(reason){setError(reason instanceof Error?reason.message:'교재를 이동하지 못했습니다.');}
  },
 });
 const dropClass=(id:string|null)=>dragTarget===id?' ring-2 ring-inset ring-brand bg-brand-weak':'';
 const all=visible.length>0&&visible.every(e=>selected.has(e.id));
 const fullPath=(id:string|null)=>['내 교재',...folderPath(state,id&&state.folders.some(f=>f.id===id)?id:null).map(f=>f.name)].join(' / ');
 const renderFolders=(parentId:string|null,depth=0):ReactNode=>(folderChildren.get(parentId)??[]).map(folder=>{
  const children=folderChildren.get(folder.id)??[];
  const open=expanded.has(folder.id);
  return <div key={folder.id}>
   <div className="mt-0.5 flex min-w-0 items-center" style={{paddingLeft:Math.min(depth,6)*12}}>
    {children.length?<button type="button" disabled={blocked} aria-label={`${folder.name} ${open?'접기':'펼치기'}`} aria-expanded={open} onClick={()=>setExpanded(previous=>{const next=new Set(previous);if(next.has(folder.id))next.delete(folder.id);else next.add(folder.id);return next;})} className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-white focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-30">{open?<ChevronDown size={16}/>:<ChevronRight size={16}/>}</button>:<span className="size-8 shrink-0" aria-hidden="true"/>}
    <button type="button" {...dropProps(folder.id)} data-folder-row={folder.id} draggable={!blocked} onDragStart={e=>startFolderDrag(e,folder.id)} onDragEnd={()=>{drag.current=null;setDragTarget(undefined);}} onContextMenu={e=>openMenu(e,'folder',folder.id)} title={fullPath(folder.id)} aria-current={current===folder.id?'page':undefined} onClick={()=>navigate(folder.id)} className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1.5 pr-1 text-left text-sm hover:bg-white focus-visible:outline-2 focus-visible:outline-brand ${current===folder.id?'bg-white font-semibold text-brand':'text-ink-muted'}${dropClass(folder.id)}`}><Folder size={16} className="shrink-0"/><span className="truncate">{folder.name}</span></button>
   </div>
   {open&&children.length>0&&renderFolders(folder.id,depth+1)}
  </div>;
 });
 return <section ref={root} tabIndex={0} aria-label="교재 탐색기" data-testid="paper-explorer" onKeyDown={e=>{
   const target=e.target as HTMLElement;
   if(editor||confirmation||target.closest('input:not([type="checkbox"]):not([type="radio"]),textarea,select,[contenteditable="true"]'))return;
   const folderId=target.closest<HTMLElement>('[data-folder-row]')?.dataset.folderRow;
   if(folderId&&!blocked&&!lock.current){
    if(e.key==='F2'){e.preventDefault();const folder=state.folders.find(f=>f.id===folderId);if(folder)setEditor({id:folder.id,name:folder.name,parentId:folder.parentId});return;}
    if(e.key==='Delete'){e.preventDefault();setConfirmation({kind:'folder',id:folderId});return;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='x'){e.preventDefault();copyFolder(folderId,'cut');return;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='c'){e.preventDefault();copyFolder(folderId,'copy');return;}
   }
   if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setMenu(null);clearSelection();root.current?.focus({preventScroll:true});return;}
   if(blocked||lock.current||menu||target.closest('[role="group"],[data-explorer-control]'))return;
   const key=e.key.toLowerCase(),cmd=e.ctrlKey||e.metaKey;
   if(cmd&&!e.altKey&&['a','c','x','v'].includes(key)){
    e.preventDefault();e.stopPropagation();
    if(key==='a')selectAll();else if(key==='c')copy('copy');else if(key==='x')copy('cut');else if(!search)void paste();
   }else if(e.key==='Delete'){e.preventDefault();e.stopPropagation();deleteSelection();}
   else if(e.key==='Enter'&&isRowTarget(target)){
    const focusedId=target.closest<HTMLElement>('[data-entry-id]')?.dataset.entryId;
    const entry=focusedId?entries.find(value=>value.id===focusedId):target===root.current&&selectedEntries.length===1?selectedEntries[0]:undefined;
    if(entry){e.preventDefault();e.stopPropagation();const pdf=byId.get(entry.pdfId);if(pdf)onOpenPdf?.({...pdf,title:entry.name??pdf.title});}
   }
  }} style={explorerHeight?{height:explorerHeight}:undefined} className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-line-weak bg-layer-default outline-none focus-visible:ring-2 focus-visible:ring-brand">
  <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-line-weak px-2.5 py-1.5">
   <h2 className="mr-2 text-sm font-semibold text-ink">내 교재</h2>
   <div data-explorer-control className="contents">{headerActions?.(current,['내 교재',...crumbs.map(f=>f.name)].join(' / '),blocked)}</div>
   <Tool label="새 폴더" disabled={blocked} onClick={()=>setEditor({id:null,name:'',parentId:current})}><FolderPlus size={18}/></Tool>
   {selectedEntries.length>0&&<><span className="mx-1 h-5 w-px bg-neutral-weak"/>
    <Tool label="복사 (Ctrl+C)" disabled={blocked} onClick={()=>copy('copy')}><Copy size={17}/></Tool>
    <Tool label="잘라내기 (Ctrl+X)" disabled={blocked} onClick={()=>copy('cut')}><Scissors size={17}/></Tool>
    <Tool label="선택 삭제" disabled={blocked} onClick={deleteSelection}><Trash2 size={17}/></Tool>
   </>}
   {clipboard&&<Tool label="붙여넣기 (Ctrl+V)" disabled={blocked||Boolean(search)} onClick={()=>void paste()}><ClipboardPaste size={17}/></Tool>}
   <div data-explorer-control className="ml-auto flex items-center gap-1">{filterControl}{sortControl}</div>
   <div className="flex w-full items-center gap-1.5 rounded-md border border-line-weak px-2 sm:ml-1.5 sm:w-52"><Search size={15} className="shrink-0 text-ink-subtle"/><input aria-label="교재와 폴더 검색" value={query} disabled={busy} onChange={e=>setQuery(e.target.value)} placeholder="교재명, 폴더명, 과목 검색" className="h-8 min-w-0 w-full bg-transparent text-sm outline-none"/></div>
  </div>
  {error&&!editor&&!confirmation&&<div role="alert" className="flex items-center gap-2 border-b border-line-weak bg-[var(--hc-color-critical-subtle)] px-4 py-2 text-sm">{error}<Tool label="폴더 다시 불러오기" disabled={busy} onClick={()=>void reload()}><RefreshCw size={16}/></Tool></div>}
  <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden lg:grid-cols-[192px_minmax(0,1fr)] lg:grid-rows-1">
   <aside className="min-h-0 overflow-y-auto border-b border-line-weak bg-[var(--hc-color-surface-muted)] p-3 lg:border-b-0 lg:border-r" aria-label="교재 폴더">
    <div className="hidden lg:block"><button type="button" {...dropProps(null)} onContextMenu={e=>openMenu(e,'blank',null)} aria-current={current===null?'page':undefined} className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm ${current===null?'bg-white font-semibold text-brand':'text-ink'}${dropClass(null)}`} onClick={()=>navigate(null)}><Home size={16}/>내 교재</button>
     {ready&&renderFolders(null)}
    </div>
    <select disabled={blocked} aria-label="폴더 이동" className="h-10 w-full rounded border border-line-weak bg-white px-2 text-sm lg:hidden" value={current??''} onChange={e=>navigate(e.target.value||null)}><option value="">내 교재</option>{(ready?orderedFolders:[]).map(f=><option key={f.id} value={f.id}>{fullPath(f.id)}</option>)}</select>
    <p className="mt-4 hidden text-xs leading-5 text-ink-subtle lg:block">{ready?'폴더는 내 계정에 저장됩니다.':'폴더를 불러오는 중…'}</p>
   </aside>
   <div onContextMenu={e=>{if(!(e.target as HTMLElement).closest('button,input,select,[data-testid="explorer-paper"]'))openMenu(e,'blank');}} className="flex min-h-0 min-w-0 flex-col overflow-hidden">
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line-weak px-4 py-2 text-sm"><button {...dropProps(null)} onContextMenu={e=>openMenu(e,'blank',null)} onClick={()=>navigate(null)} className={`rounded text-ink-muted hover:underline${dropClass(null)}`}>내 교재</button>{crumbs.map(f=><span key={f.id} className="inline-flex min-w-0 items-center gap-1"><ChevronRight size={14}/><button {...dropProps(f.id)} onContextMenu={e=>openMenu(e,'folder',f.id)} onClick={()=>navigate(f.id)} className={`max-w-44 truncate rounded hover:underline${dropClass(f.id)}`}>{f.name}</button></span>)}{search&&<span className="ml-2 text-ink-subtle">전체 검색</span>}
     <span className="ml-auto text-xs text-ink-subtle">{visible.length}개 교재{selectedEntries.length?` · ${selectedEntries.length}개 선택`:''}</span>
     {current&&!search&&<><Tool label="폴더 이동" disabled={blocked} onClick={()=>setMovingFolder({id:current,target:state.folders.find(f=>f.id===current)?.parentId??null})}><FolderInput size={15}/></Tool><Tool label="폴더 이름 수정" disabled={blocked} onClick={()=>setEditor({id:current,name:crumbs.at(-1)?.name??'',parentId:crumbs.at(-1)?.parentId??null})}><Pencil size={15}/></Tool><Tool label="폴더 삭제" disabled={blocked} onClick={()=>setConfirmation({kind:'folder',id:current})}><Trash2 size={15}/></Tool></>}
    </div>
    {(notice||busy)&&<p role="status" className="border-b border-line-weak px-4 py-2 text-xs leading-5 text-ink-muted">{busy?(ready?'저장 중…':'폴더를 불러오는 중…'):notice}</p>}
    <div ref={listRef} data-testid="paper-scroll-area" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
    {folders.length>0&&<div className="grid grid-cols-1 gap-2 border-b border-line-weak p-3 sm:grid-cols-2 xl:grid-cols-3">{folders.map(f=><button {...dropProps(f.id)} data-folder-row={f.id} draggable={!blocked} onDragStart={e=>startFolderDrag(e,f.id)} onDragEnd={()=>{drag.current=null;setDragTarget(undefined);}} onContextMenu={e=>openMenu(e,'folder',f.id)} key={f.id} onClick={()=>navigate(f.id)} className={`flex min-w-0 items-center gap-3 rounded-lg border border-line-weak px-3 py-3 text-left hover:bg-neutral-weak${dropClass(f.id)}`}><Folder size={28} className="shrink-0 text-[var(--hc-color-warning)]"/><span className="min-w-0"><span className="block truncate text-sm font-medium">{f.name}</span><span className="block truncate text-xs text-ink-subtle">{fullPath(f.parentId)}</span></span><ChevronRight size={14} className="ml-auto shrink-0"/></button>)}</div>}
    {visible.length>0&&<div className="flex items-center gap-3 border-b border-line-weak px-5 py-2 text-xs text-ink-muted"><label className="flex items-center gap-2"><input type="checkbox" aria-label="현재 목록 전체 선택" disabled={blocked} checked={all} onChange={()=>all?clearSelection():selectAll()}/>전체 선택</label>{selectedEntries.length>0&&<button disabled={blocked} onClick={clearSelection} className="hover:underline">선택 해제</button>}<span className="ml-auto hidden text-ink-subtle sm:inline">이름을 누르면 상세보기 · Ctrl·⌘ 클릭으로 여러 개 선택</span></div>}
    <div className="divide-y divide-line-weak">{visible.map(entry=>{const pdf=byId.get(entry.pdfId)!;const displayPdf={...pdf,title:entry.name??pdf.title};return <div key={entry.id} data-testid="explorer-paper" data-entry-id={entry.id} data-selected={selected.has(entry.id)}
      onClickCapture={e=>selectRow(entry.id,e)}
      onContextMenu={e=>{if(!isRowTarget(e.target))return;/* macOS emits contextmenu instead of click for Control + primary button. */if(e.ctrlKey&&e.button===0){selectRow(entry.id,e);return;}if(!blocked&&!selected.has(entry.id)){setSelected(new Set([entry.id]));anchor.current=entry.id;}openMenu(e,'files');}}
      onPointerDownCapture={e=>{dragAllowed.current=isRowTarget(e.target);}}
      draggable={!blocked}
      onDragStart={e=>{if(blocked||lock.current||!dragAllowed.current||!isRowTarget(e.target)){e.preventDefault();return;}const ids=selected.has(entry.id)?selectedEntries.map(value=>value.id):[entry.id];if(!selected.has(entry.id)){setSelected(new Set(ids));anchor.current=entry.id;}const token=crypto.randomUUID();drag.current={token,ids,generation:generation.current,kind:'files'};e.dataTransfer.effectAllowed='move';e.dataTransfer.setData(mime,JSON.stringify({token,ids}));setMenu(null);}}
      onDragEnd={()=>{drag.current=null;setDragTarget(undefined);}}
      className={`transition-colors ${selected.has(entry.id)?'bg-brand-weak ring-1 ring-inset ring-brand':'hover:bg-neutral-weak/50'} ${clipboard?.mode==='cut'&&clipboard.ids.includes(entry.id)?'opacity-50':''}`}>
      {(!entry.id.startsWith('pdf:')||search)&&<div data-explorer-control className="flex items-center gap-2 px-5 pt-2 text-xs text-ink-subtle">{!entry.id.startsWith('pdf:')&&<span title="원본과 PDF·필기 기록을 함께 사용합니다" className="inline-flex items-center gap-1"><Link2 size={12}/>연결된 복사본</span>}{search&&<button onClick={()=>navigate(entry.parentId)} className="truncate hover:underline">{fullPath(entry.parentId)}</button>}</div>}
      {renderPaper(displayPdf,selected.has(entry.id),()=>toggle(entry.id),()=>{if(blocked||lock.current)return;if(entry.id.startsWith('pdf:'))onDeletePdfs([entry.pdfId]);else setConfirmation({kind:'copies',ids:[entry.id]});})}
     </div>;})}</div>
    {!ready&&<p role="status" className="px-6 py-16 text-center text-sm text-ink-muted">{busy?'폴더를 불러오는 중…':'폴더 정보를 불러오지 못했습니다. 위의 새로고침 버튼으로 다시 시도해 주세요.'}</p>}
    {ready&&!visible.length&&!folders.length&&<div className="px-6 py-16 text-center"><Folder size={36} className="mx-auto mb-3 text-ink-subtle"/><p className="text-sm font-medium">{search?'검색 결과가 없습니다.':filterActive?'선택한 종류의 교재가 없습니다.':'폴더가 비어 있습니다.'}</p><p className="mt-2 text-xs text-ink-subtle">{search?'다른 교재명, 폴더명, 과목으로 검색해 보세요.':filterActive?'필터를 전체로 바꿔보세요.':current?'내 교재에서 복사하거나 잘라낸 뒤 여기에 붙여넣으세요.':'PDF 업로드로 교재를 추가하거나 새 폴더를 만들 수 있습니다.'}</p></div>}
    </div>
   </div>
  </div>
  {menu&&<div ref={menuRef} role="menu" aria-label="교재 탐색기 메뉴" style={{left:menu.x,top:menu.y,maxHeight:'calc(100dvh - 16px)'}} className="fixed z-50 w-56 overflow-y-auto rounded-lg border border-line-weak bg-layer-default p-1 shadow-lg" onContextMenu={e=>e.preventDefault()} onKeyDown={e=>{
    if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const items=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));const index=items.indexOf(document.activeElement as HTMLButtonElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}
    if(e.key==='Tab')setMenu(null);
   }}>
   {(() => {
    const folder=state.folders.find(f=>f.id===menu.folderId);
    const action=(label:string,run:()=>void,inactive=false)=><button key={label} type="button" role="menuitem" disabled={blocked||inactive} onClick={()=>{setMenu(null);root.current?.focus({preventScroll:true});run();}} className="flex w-full items-center rounded px-3 py-2 text-left text-sm hover:bg-neutral-weak focus:bg-neutral-weak focus:outline-none disabled:opacity-35">{label}</button>;
    return <>
     {menu.kind==='files'&&<>
      {action('미리보기',()=>{const entry=selectedEntries[0];const pdf=entry&&byId.get(entry.pdfId);if(pdf)onOpenPdf?.({...pdf,title:entry.name??pdf.title});},selectedEntries.length!==1||!onOpenPdf)}
      {action('복사',()=>copy('copy'),!selectedEntries.length)}
      {action('잘라내기',()=>copy('cut'),!selectedEntries.length)}
      {action('선택 삭제',deleteSelection,!selectedEntries.length)}
     </>}
     {menu.kind==='folder'&&folder&&<>
      {action('폴더 열기',()=>navigate(folder.id))}
      {action('폴더 복사',()=>copyFolder(folder.id,'copy'))}
      {action('폴더 잘라내기',()=>copyFolder(folder.id,'cut'))}
      {action('폴더 이동',()=>setMovingFolder({id:folder.id,target:folder.parentId}))}
      {action('이름 수정',()=>setEditor({id:folder.id,name:folder.name,parentId:folder.parentId}))}
      {action('폴더 삭제',()=>setConfirmation({kind:'folder',id:folder.id}))}
     </>}
     {clipboard&&action(menu.kind==='folder'?'이 폴더에 붙여넣기':'붙여넣기',()=>void paste(menu.folderId),!!search&&menu.kind!=='folder')}
     {menu.kind!=='files'&&action('새 폴더',()=>setEditor({id:null,name:'',parentId:menu.folderId}))}
     <div role="separator" className="my-1 border-t border-line-weak"/>
     {action('전체 선택',selectAll,!visible.length)}
     {action('선택 해제',clearSelection,!selectedEntries.length)}
    </>;
   })()}
  </div>}
  <Drawer closeDisabled={busy} open={!!editor} onOpenChange={open=>!open&&!busy&&setEditor(null)} title={editor?.id?'폴더 이름 수정':'새 폴더'} footer={<button className="rounded-md bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-40" disabled={blocked||!editor?.name.trim()} onClick={()=>{if(editor)void mutate(s=>editor.id?renameFolder(s,editor.id,editor.name):addFolder(s,editor.parentId,editor.name),'폴더를 저장했습니다.').then(ok=>{if(ok){if(!editor.id&&editor.parentId)setExpanded(previous=>new Set(previous).add(editor.parentId!));setEditor(null);}});}}>저장</button>}>
   {editor&&error&&<p role="alert" className="mb-4 rounded-md bg-[var(--hc-color-critical-subtle)] px-3 py-2 text-sm leading-6 text-ink">{error}</p>}
   <label className="block text-sm">폴더 이름<input autoFocus value={editor?.name??''} onChange={e=>setEditor(v=>v?{...v,name:e.target.value}:null)} maxLength={80} className="mt-2 h-11 w-full rounded-md border border-line-weak px-3"/></label><p className="mt-3 text-xs text-ink-subtle">위치: {fullPath(editor?.parentId??null)}</p>
  </Drawer>
  <Drawer closeDisabled={busy} open={!!movingFolder} onOpenChange={open=>!open&&!busy&&setMovingFolder(null)} title="폴더 이동" footer={<button disabled={blocked||!movingFolder} className="rounded-md bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-40" onClick={()=>{if(movingFolder)void mutate(s=>moveExplorerFolder(s,movingFolder.id,movingFolder.target),'폴더를 이동했습니다.').then(ok=>{if(ok)setMovingFolder(null);});}}>이동</button>}>
   {movingFolder&&<><p className="mb-3 text-sm">{state.folders.find(f=>f.id===movingFolder.id)?.name} 폴더를 이동할 위치를 선택하세요.</p><select aria-label="이동할 위치" value={movingFolder.target??''} onChange={e=>setMovingFolder(v=>v?{...v,target:e.target.value||null}:null)} className="h-11 w-full rounded-md border border-line-weak px-3"><option value="">내 교재</option>{orderedFolders.filter(f=>f.id!==movingFolder.id&&!folderPath(state,f.id).some(parent=>parent.id===movingFolder.id)).map(f=><option key={f.id} value={f.id}>{fullPath(f.id)}</option>)}</select>{error&&<p role="alert" className="mt-3 text-sm text-brand">{error}</p>}</>}
  </Drawer>
  <Drawer closeDisabled={busy} open={!!confirmation} onOpenChange={open=>!open&&!busy&&setConfirmation(null)} title={confirmation?.kind==='folder'?'폴더 삭제':'복사본 삭제'} footer={<button disabled={blocked} className="rounded-md bg-[var(--hc-color-critical)] px-5 py-2 text-sm font-semibold text-white" onClick={()=>void mutate(s=>confirmation?.kind==='folder'?deleteFolderTree(s,confirmation.id):removeCopies(s,confirmation?.kind==='copies'?confirmation.ids:[]),confirmation?.kind==='folder'?'폴더를 삭제했습니다.':'연결된 복사본을 삭제했습니다.').then(ok=>{if(ok){if(confirmation?.kind==='folder'&&current&&folderPath(state,current).some(f=>f.id===confirmation.id)){setCurrent(state.folders.find(f=>f.id===confirmation.id)?.parentId??null);setQuery('');}setConfirmation(null);setSelected(new Set());}})}>삭제</button>}>
   {confirmation&&error&&<p role="alert" className="mb-4 rounded-md bg-[var(--hc-color-critical-subtle)] px-3 py-2 text-sm leading-6 text-ink">{error}</p>}
   <p className="text-sm leading-6">{confirmation?.kind==='folder'?`「${state.folders.find(f=>f.id===confirmation.id)?.name??''}」 폴더와 하위 폴더를 삭제합니다. 원본 교재는 상위 폴더로 옮기고, 연결된 복사본은 목록에서 제거합니다. PDF와 필기 기록은 지워지지 않지만 폴더 구조는 복구할 수 없습니다.`:'선택한 연결된 복사본을 삭제합니다. 원본 교재와 필기 기록은 유지됩니다.'}</p>
  </Drawer>
 </section>;
}
