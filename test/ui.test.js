// End-to-end UI test: two real client instances (jsdom) running public/index.html against a live server.
const test=require('node:test'),assert=require('node:assert'),{JSDOM}=require('jsdom'),{create}=require('../server');
const until=async(f,ms=3000)=>{const t=Date.now();while(Date.now()-t<ms){try{if(f())return true}catch{}await new Promise(r=>setTimeout(r,25))}throw new Error('timeout: '+f)};
async function client(port,user){
 const dom=await JSDOM.fromURL(`http://localhost:${port}/`,{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))}}});
 const w=dom.window,d=w.document,q=s=>d.querySelector(s);
 await until(()=>q('.big'));w.eval(`me='${user}'`);
 return{w,d,q,set:(s,v)=>{q(s).value=v},click:s=>q(s).click(),close:()=>dom.window.close()};
}
test('two live UIs: merge, conflict prompt, resolution, live card update',async()=>{
 const app=create(null),s=app.srv;await new Promise(r=>s.listen(0,r));const port=s.address().port;
 const A=await client(port,'Asha'),B=await client(port,'Ben');
 for(const c of[A,B])c.click('[data-v="1"]');
 await until(()=>A.q('.card[data-id="1"]')&&B.q('.card[data-id="1"]'));
 // different fields: both survive
 A.click('.card[data-id="1"]');B.click('.card[data-id="1"]');
 await until(()=>A.q('#e_title')&&B.q('#e_title'));
 A.set('#e_assignee','Dev');A.click('#sv');
 await until(()=>app.D.tasks[0].assignee==='Dev');
 await until(()=>B.q('#bn .ban'));                       // B is warned the task changed under them
 B.set('#e_due','2030-01-01');B.click('#sv');
 await until(()=>app.D.tasks[0].due==='2030-01-01');
 assert.equal(app.D.tasks[0].assignee,'Dev');assert.equal(app.D.tasks[0].v,3);
 // same field: conflict prompt, nothing overwritten
 A.click('#cl');B.click('#cl');A.click('.card[data-id="1"]');B.click('.card[data-id="1"]');
 await until(()=>A.q('#e_title')&&B.q('#e_title'));
 A.set('#e_title','TitleA');A.click('#sv');await until(()=>app.D.tasks[0].title==='TitleA');
 B.set('#e_title','TitleB');B.click('#sv');
 await until(()=>B.q('.cf'));
 assert.equal(app.D.tasks[0].title,'TitleA');
 // live update on the other client's board while its dialog is open
 await until(()=>B.q('.card[data-id="1"]').textContent.includes('TitleA'));
 // resolve with "mine"
 B.q('input[name=p_title][value=mine]').checked=true;B.click('#rs');
 await until(()=>app.D.tasks[0].title==='TitleB');
 await until(()=>A.q('.card[data-id="1"]').textContent.includes('TitleB'));
 A.close();B.close();s.close()});

test('creating a task in one UI appears in the other; drag-drop status change syncs',async()=>{
 const app=create(null),s=app.srv;await new Promise(r=>s.listen(0,r));const port=s.address().port;
 const A=await client(port,'Asha'),B=await client(port,'Ben');
 for(const c of[A,B])c.click('[data-v="2"]');
 await until(()=>A.q('#nt')&&B.q('#nt'));
 A.click('#nt');await until(()=>app.D.tasks.length===5);
 await until(()=>B.d.querySelectorAll('.card').length===2);
 const t=app.D.tasks.find(x=>x.id===4);
 const ev=new A.w.Event('drop',{bubbles:true});ev.dataTransfer={getData:()=>'4'};
 A.q('.col[data-s="done"]').dispatchEvent(ev);
 await until(()=>t.status==='done');
 await until(()=>B.q('.col[data-s="done"] .card[data-id="4"]'));
 A.close();B.close();s.close()});
