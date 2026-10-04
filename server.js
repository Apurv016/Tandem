// Tandem server: HTTP (static client) + WebSocket (authoritative state, versioned merge, broadcast).
const http=require('http'),fs=require('fs'),path=require('path'),{WebSocketServer}=require('ws');
const F=['title','desc','status','assignee','due'],ST=['todo','doing','done'];
const day=n=>new Date(Date.now()+n*864e5).toISOString().slice(0,10);
const mk=(id,pid,title,status,assignee,due)=>({id,pid,title,desc:'',status,assignee,due,v:1,files:[],comments:[]});
const seed=()=>({pid:2,tid:4,projects:[{id:1,name:'Website relaunch'},{id:2,name:'Mobile app v2'}],
 tasks:[mk(1,1,'Design homepage','doing','Asha',day(2)),mk(2,1,'Set up CI pipeline','todo','Ben',day(-1)),mk(3,1,'Write launch copy','done','Chitra',day(-3)),mk(4,2,'Push notifications','todo','Dev',day(6))],log:[]});

function create(file){
 let D;try{D=JSON.parse(fs.readFileSync(file,'utf8'))}catch{D=seed()}
 const persist=()=>{if(!file)return;fs.writeFileSync(file+'.tmp',JSON.stringify(D));fs.renameSync(file+'.tmp',file)};
 const note=(by,msg)=>{D.log.unshift({t:Date.now(),by,msg});D.log=D.log.slice(0,30)};
 const T=id=>D.tasks.find(t=>t.id==id);
 // apply(): runs synchronously on the single Node thread, so each operation is atomic.
 function apply(m){
  const by=String(m.by||'someone').slice(0,20);
  switch(m.op){
   case 'project':{const n=String(m.name||'').trim().slice(0,80);if(!n)return{err:'name required'};const id=++D.pid;D.projects.push({id,name:n});note(by,'created project '+n);return{id,ids:[],changed:1}}
   case 'task':{if(!D.projects.some(p=>p.id==m.pid))return{err:'no such project'};const id=++D.tid;D.tasks.push(mk(id,+m.pid,'New task','todo',by,''));note(by,'added a task');return{id,ids:[id],changed:1}}
   case 'commit':{
    const cur=T(m.id);if(!cur)return{gone:1};
    const ch=m.ch||{},base=m.base||{},conf=[],next={};
    for(const k in ch)if(!F.includes(k))return{err:'bad field'};
    if('status' in ch&&!ST.includes(ch.status))return{err:'bad status'};
    if('title' in ch&&!String(ch.title).trim())return{err:'title required'};
    // Picks are honoured only if the task is still at the version the person saw the conflict at.
    const pick=m.seenV===cur.v?(m.pick||{}):{};
    for(const k in ch){
     if(cur[k]!==base[k]&&cur[k]!==ch[k]){ // someone else changed this field to something different
      if(pick[k]==='mine')next[k]=ch[k];else if(pick[k]!=='theirs')conf.push({k,theirs:cur[k],mine:ch[k]});
     }else next[k]=ch[k];
    }
    if(conf.length)return{conf,v:cur.v};   // nothing is written on conflict
    Object.assign(cur,next);cur.v++;note(by,`updated "${cur.title}" (v${cur.v})`);return{ok:cur,ids:[cur.id],changed:1}}
   case 'comment':{const c=T(m.id),x=String(m.text||'').trim().slice(0,2000);if(!c)return{gone:1};if(!x)return{err:'empty comment'};c.comments.push({by,text:x,t:Date.now()});note(by,`commented on "${c.title}"`);return{ids:[c.id],changed:1}}
   case 'file':{const c=T(m.id);if(!c)return{gone:1};if(typeof m.data!=='string'||!m.data.startsWith('data:')||m.data.length>250000)return{err:'file rejected (max ~150 KB)'};c.files.push({name:String(m.name||'file').slice(0,100),data:m.data});note(by,'attached '+m.name);return{ids:[c.id],changed:1}}
   case 'sim':{const c=T(m.id);if(!c)return{gone:1};c.title+=' (edited by Ben)';c.v++;note('Ben',`edited "${c.title}"`);return{ids:[c.id],changed:1,by:'Ben'}}
   default:return{err:'unknown op'};
  }}
 const srv=http.createServer((q,s)=>{
  if(q.url==='/health'){s.end('ok');return}
  s.setHeader('content-type','text/html');s.end(fs.readFileSync(path.join(__dirname,'public','index.html')))});
 const wss=new WebSocketServer({server:srv,path:'/ws',maxPayload:1e6});
 const send=(c,o)=>{if(c.readyState===1)c.send(JSON.stringify(o))};
 const bcast=o=>wss.clients.forEach(c=>send(c,o));
 const pres=()=>bcast({k:'presence',n:wss.clients.size});
 wss.on('connection',ws=>{
  send(ws,{k:'state',D});pres();ws.on('close',pres);   // full snapshot on (re)connect = recovery after drops
  ws.on('message',raw=>{let m;try{m=JSON.parse(raw)}catch{return}
   let r;try{r=apply(m)}catch(e){r={err:'server error'}}
   if(r.changed){persist();bcast({k:'state',D,by:r.by||m.by,ids:r.ids})}  // broadcast BEFORE reply
   const{changed,ids,by,...out}=r;send(ws,{rid:m.rid,...out})})});
 return{srv,apply,get D(){return D}};
}
module.exports={create};
if(require.main===module){const port=process.env.PORT||3000;create(process.env.DATA_FILE||path.join(__dirname,'data.json')).srv.listen(port,()=>console.log('Tandem on http://localhost:'+port))}
