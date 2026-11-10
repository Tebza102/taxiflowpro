const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
const script=fs.readFileSync(path.join(root,'dist/app.js'),'utf8');

test('sample dashboard reconciles expected and counted cash',()=>{
  const expected=6000+5250+6100+6900;
  const counted=5900+5250+6100+6900;
  assert.equal(expected,24250);assert.equal(counted,24150);assert.equal(counted-expected,-100);
  const visibleText=html.replace(/<[^>]*>/g,'');
  assert.match(visibleText,/R24,250/);assert.match(visibleText,/R24,150/);assert.match(visibleText,/R100\.00 short/);
});

test('the cash-up walkthrough preserves statuses and does not erase the variance',()=>{
  const source=script.slice(0,script.indexOf('let currentStep=0;'));
  const stages=vm.runInNewContext(source+'\nstages;');
  assert.equal(Array.from(stages,s=>s.status).join(','),'pending,counted,verified,banked');
  assert.equal(5850+600-450,6000);assert.equal(5900-6000,-100);
  assert.match(stages[2].description,/R100 difference acknowledged/);
  assert.match(stages[3].context,/R6,000 expectation and R100 difference/);
});

test('local assets, fragment links and tab references resolve',()=>{
  const ids=Array.from(html.matchAll(/\bid="([^"]+)"/g),m=>m[1]);
  assert.equal(ids.length,new Set(ids).size,'duplicate element ID');
  for(const m of html.matchAll(/\bhref="#([^"\s]+)"/g))assert.ok(ids.includes(m[1]),`missing anchor ${m[1]}`);
  for(const m of html.matchAll(/\baria-(?:controls|labelledby)="([^"]+)"/g))for(const id of m[1].split(' '))assert.ok(ids.includes(id),`missing ARIA target ${id}`);
  for(const m of html.matchAll(/(?:href|src)="([^"#][^"]*)"/g))if(!m[1].startsWith('https://'))assert.ok(fs.existsSync(path.join(root,'dist',m[1])),`missing asset ${m[1]}`);
});

test('prototype enquiries are explicitly disclosed and send no contact data',()=>{
  assert.match(html,/No enquiry is sent/);assert.match(script,/No enquiry has been sent/);
  assert.doesNotMatch(script,/\bfetch\s*\(|XMLHttpRequest|sendBeacon/);
  assert.match(script,/type:'text\/plain;charset=utf-8'/);
});

test('cash-up and fleet review links select the relevant example before scrolling',()=>{
  const elements=new Map();
  function node(selector){
    if(elements.has(selector))return elements.get(selector);
    const element={hidden:false,value:'',attrs:{},listeners:{},children:[],
      setAttribute(k,v){this.attrs[k]=v},getAttribute(k){return this.attrs[k]},
      addEventListener(event,callback){this.listeners[event]=callback},
      replaceChildren(...children){this.children=children},append(child){this.children.push(child)},
      focus(){this.focused=true},scrollIntoView(){this.scrolled=true},
      classList:{toggle(){},remove(){}},showModal(){},close(){}};
    elements.set(selector,element);return element;
  }
  const steps=[0,1,2,3].map(i=>node('#step-'+i));
  const tabs=['finance','fleet'].map(name=>{const n=node('#tab-'+name);n.attrs['aria-controls']='panel-'+name;return n});
  node('#panel-fleet').hidden=true;
  const document={querySelector:node,querySelectorAll(selector){return selector==='[data-step]'?steps:selector==='.dash-tabs [role="tab"]'?tabs:[]},getElementById:id=>node('#'+id),createElement:tag=>node('created-'+tag),createTextNode:text=>({textContent:text})};
  vm.runInNewContext(script,{document,matchMedia:()=>({matches:true})});
  node('#review-cashup').listeners.click();
  assert.equal(node('#flow-status').textContent,'Counted');
  assert.equal(node('#actual-line').hidden,false);
  assert.equal(node('#cash-flow').scrolled,true);
  assert.equal(node('#step-1').focused,true);
  node('#show-fleet').listeners.click();
  assert.equal(node('#panel-finance').hidden,true);
  assert.equal(node('#panel-fleet').hidden,false);
  assert.equal(node('#tab-fleet').attrs['aria-selected'],'true');
  assert.equal(node('#operations-board').scrolled,true);
});
