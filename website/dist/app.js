'use strict';
const stages = [
  {status:'pending', role:'Driver', heading:'Start with what happened.', description:'The driver logs standard trips, special income and expenses, then submits the day’s cash-up for checking.', context:'This example uses a driver-day cash-up. Only cash expenses reduce the expected hand-in.', next:'Next: count the hand-in'},
  {status:'counted', role:'Administrator', heading:'Count the cash. See the gap.', description:'The administrator records R5,900 actually received against R6,000 expected. The record now shows a R100 shortfall.', context:'Variance = actual cash received − expected cash. R5,900 − R6,000 = −R100. The difference stays visible for review.', next:'Next: manager verification'},
  {status:'verified', role:'Manager', heading:'Review before you verify.', description:'The manager checks the income, expenses and counted cash. In this example, the manager verifies the record with the R100 difference acknowledged.', context:'Verification is a review step. It does not turn a shortfall into income or imply that missing cash has been recovered.', next:'Next: finalise the deposit'},
  {status:'banked', role:'Manager / Owner', heading:'Close the loop with banking.', description:'The manager or owner finalises the R5,900 deposit and links the banking to the checked records. Their status becomes banked.', context:'The deposit reflects the actual R5,900 received. The original R6,000 expectation and R100 difference remain part of this example.', next:'Restart the example'}
];
let currentStep=0;
const stepButtons=[...document.querySelectorAll('[data-step]')];
function setStep(index,focus=false){
  currentStep=index;
  const stage=stages[index];
  stepButtons.forEach((button,i)=>{button.setAttribute('aria-selected',String(i===index));button.tabIndex=i===index?0:-1;});
  document.querySelector('#flow-panel').setAttribute('aria-labelledby',`step-${index}`);
  const badge=document.querySelector('#flow-status');
  badge.textContent=stage.status[0].toUpperCase()+stage.status.slice(1);
  badge.className='pill '+(index===2?'green':index===3?'muted':'amber');
  document.querySelector('#flow-role').textContent=stage.role.toUpperCase();
  document.querySelector('#flow-heading').textContent=stage.heading;
  document.querySelector('#flow-description').textContent=stage.description;
  document.querySelector('#flow-context').textContent=stage.context;
  document.querySelector('#actual-line').hidden=index===0;
  document.querySelector('#flow-progress').textContent=`STEP ${index+1} OF 4`;
  document.querySelector('#next-step').replaceChildren(document.createTextNode(stage.next+' '));
  const arrow=document.createElement('span');arrow.setAttribute('aria-hidden','true');arrow.textContent=index===3?'↺':'→';document.querySelector('#next-step').append(arrow);
  if(focus)stepButtons[index].focus();
  animateExample(document.querySelector('.flow-content'));
}
stepButtons.forEach((button,index)=>{button.addEventListener('click',()=>setStep(index));button.addEventListener('keydown',event=>{let next=index;if(event.key==='ArrowDown')next=(index+1)%4;else if(event.key==='ArrowUp')next=(index+3)%4;else if(event.key==='Home')next=0;else if(event.key==='End')next=3;else return;event.preventDefault();setStep(next,true);});});
document.querySelector('#next-step').addEventListener('click',()=>setStep((currentStep+1)%4));
const dashTabs=[...document.querySelectorAll('.dash-tabs [role="tab"]')];
function selectDashboard(tab,focus=false){dashTabs.forEach(button=>{const selected=button===tab;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;document.getElementById(button.getAttribute('aria-controls')).hidden=!selected;});if(focus)tab.focus();animateExample(document.getElementById(tab.getAttribute('aria-controls')));}
dashTabs.forEach((tab,index)=>{tab.addEventListener('click',()=>selectDashboard(tab));tab.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();selectDashboard(dashTabs[event.key==='Home'?0:event.key==='End'?1:1-index],true);}});});
const menuToggle=document.querySelector('.menu-toggle');
menuToggle.addEventListener('click',()=>{const expanded=menuToggle.getAttribute('aria-expanded')!=='true';menuToggle.setAttribute('aria-expanded',String(expanded));menuToggle.setAttribute('aria-label',expanded?'Close navigation':'Open navigation');document.querySelector('.header nav').classList.toggle('is-open',expanded);});
document.querySelectorAll('.header nav a').forEach(link=>link.addEventListener('click',()=>{document.querySelector('.header nav').classList.remove('is-open');menuToggle.setAttribute('aria-expanded','false');menuToggle.setAttribute('aria-label','Open navigation');}));
const dialog=document.querySelector('#enquiry-dialog');let lastTrigger;
document.querySelectorAll('[data-enquiry]').forEach(button=>button.addEventListener('click',()=>{lastTrigger=button;dialog.showModal();}));
document.querySelector('.dialog-close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',event=>{if(event.target===dialog){const bounds=dialog.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)dialog.close();}});
dialog.addEventListener('close',()=>lastTrigger?.focus());
let brief='';
document.querySelector('#enquiry-form').addEventListener('submit',event=>{event.preventDefault();const fleet=document.querySelector('#fleet-size').value;const priority=document.querySelector('#priority').value;if(!fleet||!priority)return;brief=`TaxiFlow Pro — Walkthrough brief\n\nFleet size: ${fleet}\nFirst priority: ${priority}\n\nDiscussion points:\n1. How do we capture each vehicle’s income and expenses?\n2. Who counts, verifies and banks the cash?\n3. What is our biggest daily process problem?\n4. What would a useful improvement look like?\n\nNext step: review one vehicle’s day with the TaxiFlow Pro team and agree the scope before implementation.\n\nPrepared in the website prototype. No enquiry has been sent.`;document.querySelector('#brief-text').textContent=brief;document.querySelector('#enquiry-form').hidden=true;document.querySelector('#brief-result').hidden=false;document.querySelector('#download-brief').focus();});
document.querySelector('#edit-brief').addEventListener('click',()=>{document.querySelector('#brief-result').hidden=true;document.querySelector('#enquiry-form').hidden=false;document.querySelector('#download-status').textContent='';document.querySelector('#fleet-size').focus();});
document.querySelector('#download-brief').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([brief],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='TaxiFlow-Pro-Walkthrough-Brief.txt';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);document.querySelector('#download-status').textContent='Brief download started. No enquiry was sent.';});

// Product links select the relevant example before moving into view.
document.querySelector('#review-cashup').addEventListener('click',()=>{setStep(1);document.querySelector('#cash-flow').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});document.querySelector('#step-1').focus({preventScroll:true});});
document.querySelector('#show-fleet').addEventListener('click',()=>{selectDashboard(document.querySelector('#tab-fleet'));document.querySelector('#operations-board').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});document.querySelector('#tab-fleet').focus({preventScroll:true});});

function animateExample(element){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches||typeof element?.animate!=='function')return;
  element.getAnimations?.().forEach(animation=>animation.cancel());
  element.animate([{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],{duration:240,easing:'ease-out'});
}

// Keep everything visible without IntersectionObserver or with reduced motion.
if(typeof IntersectionObserver==='function'&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
  const revealObserver=new IntersectionObserver(entries=>{
    entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-revealed');revealObserver.unobserve(entry.target);}});
  },{threshold:0.08});
  document.querySelectorAll('.board-heading,.module-dock,.section-heading,.story,.compliance-story,.roles,.getting-started .wrap,.faq').forEach(element=>{
    revealObserver.observe(element);
    element.classList.add('reveal-ready');
  });
}
