const test=require('node:test'),assert=require('node:assert'),{create}=require('../server'),WebSocket=require('ws');
const F=['title','desc','status','assignee','due'];
const setup=()=>{const a=create(null),t=a.D.tasks[0],base={};F.forEach(k=>base[k]=t[k]);return{a,t,base}};

test('edits to different fields are both kept (no lost update)',()=>{
 const{a,t,base}=setup();
 a.apply({op:'commit',id:t.id,base,ch:{assignee:'Dev'}});
 const r=a.apply({op:'commit',id:t.id,base,ch:{due:'2030-01-01'}});
 assert.ok(r.ok);assert.equal(t.assignee,'Dev');assert.equal(t.due,'2030-01-01');assert.equal(t.v,3)});

test('same field edited concurrently -> conflict, nothing overwritten',()=>{
 const{a,t,base}=setup();
 a.apply({op:'commit',id:t.id,base,ch:{title:'Alice title'}});
 const r=a.apply({op:'commit',id:t.id,base,ch:{title:'Bob title'}});
 assert.equal(r.conf.length,1);assert.equal(t.title,'Alice title');assert.equal(t.v,2)});

test('conflict resolved with "mine" or "theirs" when version still current',()=>{
 const{a,t,base}=setup();
 a.apply({op:'commit',id:t.id,base,ch:{title:'A'}});
 const c=a.apply({op:'commit',id:t.id,base,ch:{title:'B'}});
 a.apply({op:'commit',id:t.id,base,ch:{title:'B'},pick:{title:'mine'},seenV:c.v});assert.equal(t.title,'B');
 const{a:a2,t:t2,base:b2}=setup();
 a2.apply({op:'commit',id:t2.id,base:b2,ch:{title:'A'}});
 const c2=a2.apply({op:'commit',id:t2.id,base:b2,ch:{title:'B'}});
 a2.apply({op:'commit',id:t2.id,base:b2,ch:{title:'B'},pick:{title:'theirs'},seenV:c2.v});assert.equal(t2.title,'A')});

test('stale resolution is rejected if a third edit landed meanwhile',()=>{
 const{a,t,base}=setup();
 a.apply({op:'commit',id:t.id,base,ch:{title:'A'}});
 const c=a.apply({op:'commit',id:t.id,base,ch:{title:'B'}});
 a.apply({op:'commit',id:t.id,base:{title:'A'},ch:{title:'C'}});            // third writer
 const r=a.apply({op:'commit',id:t.id,base,ch:{title:'B'},pick:{title:'mine'},seenV:c.v});
 assert.ok(r.conf);assert.equal(t.title,'C')});

test('two people setting the same value is not a conflict',()=>{
 const{a,t,base}=setup();
 a.apply({op:'commit',id:t.id,base,ch:{status:'done'}});
 assert.ok(a.apply({op:'commit',id:t.id,base,ch:{status:'done'}}).ok)});

test('validation: bad status, bad field, empty title, unknown task',()=>{
 const{a,t,base}=setup();
 assert.equal(a.apply({op:'commit',id:t.id,base,ch:{status:'nope'}}).err,'bad status');
 assert.equal(a.apply({op:'commit',id:t.id,base,ch:{v:99}}).err,'bad field');
 assert.equal(a.apply({op:'commit',id:t.id,base,ch:{title:'  '}}).err,'title required');
 assert.ok(a.apply({op:'commit',id:9999,base,ch:{title:'x'}}).gone)});

test('comments, files and size limits',()=>{
 const{a,t}=setup();
 assert.ok(a.apply({op:'comment',id:t.id,text:'hi',by:'Asha'}).changed);
 assert.equal(a.apply({op:'comment',id:t.id,text:' '}).err,'empty comment');
 assert.ok(a.apply({op:'file',id:t.id,name:'a.txt',data:'data:text/plain;base64,aGk='}).changed);
 assert.ok(a.apply({op:'file',id:t.id,name:'big',data:'data:'+'x'.repeat(300000)}).err);
 assert.equal(t.comments.length,1);assert.equal(t.files.length,1)});

test('live broadcast reaches other clients and replies reach the sender',async()=>{
 const s=create(null).srv;await new Promise(r=>s.listen(0,r));const port=s.address().port;
 const open=()=>new Promise(r=>{const w=new WebSocket(`ws://localhost:${port}/ws`),q=[];w.on('message',d=>q.push(JSON.parse(d)));w.once('open',()=>r({w,q}))});
 const wait=(c,f)=>new Promise((res,rej)=>{const t0=Date.now();(function p(){const m=c.q.find(f);if(m)return res(m);if(Date.now()-t0>2000)return rej(new Error('timeout'));setTimeout(p,20)})()});
 const A=await open(),B=await open();
 await wait(B,x=>x.k==='presence'&&x.n===2);
 A.w.send(JSON.stringify({op:'commit',id:1,rid:1,by:'A',base:{title:'Design homepage'},ch:{title:'Hello'}}));
 const m=await wait(B,x=>x.k==='state'&&x.D.tasks[0].title==='Hello');
 assert.equal(m.by,'A');assert.ok((await wait(A,x=>x.rid===1)).ok);
 A.w.close();B.w.close();s.close()});

test('reconnecting client receives full snapshot (recovery)',async()=>{
 const x=create(null),s=x.srv;await new Promise(r=>s.listen(0,r));const port=s.address().port;
 x.apply({op:'comment',id:1,text:'while you were away'});
 const w=new WebSocket(`ws://localhost:${port}/ws`);
 const m=await new Promise(r=>w.once('message',d=>r(JSON.parse(d))));
 assert.equal(m.k,'state');assert.equal(m.D.tasks[0].comments[0].text,'while you were away');w.close();s.close()});
