const API = '';
const KEY_RE=/^[A-Z0-9]{5}$/;
let adminSecret='', allLicenses=[], currentFilter='all', createdKeys=[], qty=1, dateMode='auto', validity=1, maxDev=1;
const esc=t=>String(t??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

function doLogin(){
  const val=document.getElementById('secret-input').value.trim();
  if(!val){showErr('Digite a senha.');return;}
  adminSecret=val;
  fetch(`${API}/api/admin/licenses`,{headers:{'X-Admin-Secret':adminSecret}})
    .then(r=>{
      if(r.status===401||r.status===403){showErr('Senha incorreta.');adminSecret='';}
      else if(r.status===429){showErr('Muitas tentativas. Aguarde 15 minutos.');adminSecret='';}
      else if(r.status===503){showErr('Servidor sem ADMIN_SECRET configurado.');adminSecret='';}
      else if(r.ok){r.json().then(d=>{
        allLicenses=Array.isArray(d)?d.filter(l=>l&&KEY_RE.test(l.key)):[];
        document.getElementById('login-screen').style.display='none';
        document.getElementById('main').style.display='block';
        showErr('');
        render();
      });}
      else showErr('Erro ao conectar. Verifique se o servidor está no ar.');
    }).catch(()=>showErr('Servidor offline. Verifique o backend.'));
}
function showErr(m){document.getElementById('login-error').textContent=m;}
function doLogout(){
  adminSecret='';
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('main').style.display='none';
  document.getElementById('secret-input').value='';
}
document.getElementById('secret-input').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});

function setDateMode(mode){
  dateMode=mode;
  document.getElementById('custom-dates').classList.toggle('visible',mode==='custom');
  document.getElementById('validity-field').classList.toggle('hidden',mode==='custom');
}

function loadLicenses(){
  fetch(`${API}/api/admin/licenses`,{headers:{'X-Admin-Secret':adminSecret}})
    .then(r=>{
      if(r.status===401||r.status===403||r.status===429){showToast(r.status===429?'Muitas tentativas. Aguarde.':'Sessão inválida. Entre novamente.');throw new Error('auth');}
      if(!r.ok)throw new Error('http');
      return r.json();
    })
    .then(d=>{allLicenses=Array.isArray(d)?d.filter(l=>l&&KEY_RE.test(l.key)):[];render();showToast('Lista atualizada');})
    .catch(()=>showToast('Erro ao carregar'));
}
function render(){renderTable();updateCounts();}

function getStatus(l){
  if(l.revoked)return 'revoked';
  if(!l.activated)return 'unused';
  if(l.expired)return 'expired';
  return 'active';
}
function updateCounts(){
  const c={all:allLicenses.length,active:0,unused:0,expired:0,revoked:0};
  allLicenses.forEach(l=>c[getStatus(l)]++);
  Object.keys(c).forEach(k=>document.getElementById('n-'+k).textContent=c[k]);
}

const MONTHS=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const cal={start:{value:'',view:null},end:{value:'',view:null}};
const pad=n=>String(n).padStart(2,'0');
const toIso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const fromIso=v=>{const [y,m,d]=v.split('-').map(Number);return new Date(y,m-1,d);};

function closePopups(){document.querySelectorAll('.dd.open').forEach(d=>d.classList.remove('open'));}
function toggleDD(btn){
  const dd=btn.parentElement;
  const open=!dd.classList.contains('open');
  closePopups();
  dd.classList.toggle('open',open);
}
function pickValidity(el,v){
  validity=v;
  document.getElementById('validity-label').textContent=el.textContent;
  el.parentElement.querySelectorAll('.dd-item').forEach(i=>i.classList.toggle('active',i===el));
  closePopups();
}
function pickDevices(el,v){
  maxDev=v;
  document.getElementById('devices-label').textContent=el.textContent;
  el.parentElement.querySelectorAll('.dd-item').forEach(i=>i.classList.toggle('active',i===el));
  closePopups();
}
function openCal(which,btn){
  const dd=btn.parentElement;
  const open=!dd.classList.contains('open');
  closePopups();
  if(!open)return;
  const c=cal[which];
  const base=c.value?fromIso(c.value):(which==='end'&&cal.start.value?fromIso(cal.start.value):new Date());
  c.view=new Date(base.getFullYear(),base.getMonth(),1);
  renderCal(which);
  dd.classList.add('open');
}
function navCal(which,dir){
  const v=cal[which].view;
  cal[which].view=new Date(v.getFullYear(),v.getMonth()+dir,1);
  renderCal(which);
}
function renderCal(which){
  const c=cal[which];
  const y=c.view.getFullYear(), m=c.view.getMonth();
  const offset=new Date(y,m,1).getDay();
  const days=new Date(y,m+1,0).getDate();
  const today=toIso(new Date());
  let cells='';
  for(let i=0;i<offset;i++)cells+='<span></span>';
  for(let d=1;d<=days;d++){
    const v=toIso(new Date(y,m,d));
    const off=which==='end'&&cal.start.value&&v<=cal.start.value;
    const cls='day'+(v===c.value?' sel':'')+(v===today?' today':'');
    cells+=`<button type="button" class="${cls}" ${off?'disabled':''} data-click="pickDate" data-args='["${which}","${v}"]'>${d}</button>`;
  }
  document.getElementById('cal-'+which).innerHTML=
    `<div class="cal-head"><button type="button" class="cal-nav" data-click="navCal" data-args='["${which}",-1]' aria-label="Mês anterior">‹</button><span>${MONTHS[m]} ${y}</span><button type="button" class="cal-nav" data-click="navCal" data-args='["${which}",1]' aria-label="Próximo mês">›</button></div>`+
    `<div class="cal-week">${['D','S','T','Q','Q','S','S'].map(x=>`<span>${x}</span>`).join('')}</div>`+
    `<div class="cal-grid">${cells}</div>`;
}
function setLabel(which){
  const el=document.getElementById('label-'+which);
  const v=cal[which].value;
  el.textContent=v?v.split('-').reverse().join('/'):'Selecionar';
  el.classList.toggle('ph',!v);
}
function pickDate(which,v){
  cal[which].value=v;
  if(which==='start'&&cal.end.value&&cal.end.value<=v){cal.end.value='';setLabel('end');}
  setLabel(which);
  closePopups();
}

document.addEventListener('keydown',e=>{if(e.key==='Escape')closePopups();});

function changeQty(d){
  qty=Math.max(1,Math.min(50,qty+d));
  document.getElementById('qty-display').textContent=qty;
}

async function createLicenses(){
  const btn=document.getElementById('create-btn');
  const body={validityMonths:validity,maxDevices:maxDev,description:(document.getElementById('desc-input').value||'').trim().slice(0,100)};

  if(dateMode==='custom'){
    const s=cal.start.value;
    const e=cal.end.value;
    if(!s||!e){showToast('Preencha as datas de início e fim');return;}
    if(new Date(e)<=new Date(s)){showToast('A data de fim deve ser depois do início');return;}
    body.customStart=s; body.customEnd=e;
    body.validityMonths=Math.max(1,Math.round((new Date(e)-new Date(s))/(1000*60*60*24*30)));
  }

  btn.disabled=true; btn.textContent='Criando…';
  createdKeys=[];
  let lastError='';
  try{
    for(let i=0;i<qty;i++){
      const r=await fetch(`${API}/api/admin/licenses`,{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Secret':adminSecret},body:JSON.stringify(body)});
      const d=await r.json().catch(()=>({}));
      if(r.ok){createdKeys.push(d.key);}
      else{lastError=d.error||('Erro '+r.status);break;}
    }
  }catch(err){showToast('Erro ao criar licenças');}
  if(lastError)showToast(lastError);
  btn.disabled=false; btn.textContent='Criar';

  if(createdKeys.length){
    const box=document.getElementById('created-keys-box');
    document.getElementById('created-title').textContent=createdKeys.length===1?'Licença criada':`${createdKeys.length} licenças criadas`;
    document.getElementById('keys-list').innerHTML=createdKeys.filter(k=>KEY_RE.test(k)).map(k=>`<button class="key-chip" data-click="copyText" data-args='["${k}"]' title="Copiar">${k}</button>`).join('');
    box.style.display='block';
    loadLicenses();
  }
}
function copyAllKeys(){navigator.clipboard.writeText(createdKeys.join('\n')).then(()=>showToast('Chaves copiadas'));}
function copyText(t){navigator.clipboard.writeText(t).then(()=>showToast('Chave copiada'));}

function setFilter(f,el){
  currentFilter=f;
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  el.scrollIntoView({inline:'center',block:'nearest',behavior:'smooth'});
  resetVisible();
  renderTable();
}

const PAGE_SIZE=20;
let visibleCount=PAGE_SIZE;
function resetVisible(){visibleCount=PAGE_SIZE;}
function showMore(){visibleCount+=PAGE_SIZE;renderTable();}

function renderTable(){
  const q=(document.getElementById('search-input')?.value||'').toLowerCase().trim();
  let list=allLicenses;
  if(currentFilter!=='all')list=list.filter(l=>getStatus(l)===currentFilter);
  if(q)list=list.filter(l=>l.key.toLowerCase().includes(q)||String(l.description||'').toLowerCase().includes(q));

  const tbody=document.getElementById('licenses-tbody');
  const moreWrap=document.getElementById('more-wrap');
  const moreBtn=document.getElementById('more-btn');
  if(!list.length){tbody.innerHTML='<tr><td colspan="5" class="empty">Nenhuma licença encontrada</td></tr>';moreWrap.classList.remove('show');return;}
  const total=list.length;
  list=list.slice(0,visibleCount);
  const remaining=total-list.length;
  moreWrap.classList.toggle('show',remaining>0);
  moreBtn.textContent=`Mostrar mais (${Math.min(PAGE_SIZE,remaining)} de ${remaining} restantes)`;

  const fmt=iso=>iso?new Date(iso).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit'}):'—';
  const labels={active:'Ativa',unused:'Não usada',expired:'Expirada',revoked:'Revogada'};
  const safeFmt=iso=>{const d=fmt(iso);return String(d).replace(/[^0-9\/—-]/g,'');};

  tbody.innerHTML=list.map(l=>{
    const s=getStatus(l);
    const months=`${Number(l.validityMonths)||0} ${Number(l.validityMonths)===1?'mês':'meses'}`;
    const md=Number(l.maxDevices)||1;
    const devs=md>1?` · ${Number(l.devicesUsed)||0}/${md} disp.`:'';
    const desc=l.description?`<span class="desc">${esc(l.description)}</span>`:'';
    const revoke=s==='revoked'?'':`<button class="act act-revoke" data-click="confirmRevoke" data-args='["${l.key}"]'>Revogar</button>`;
    const reset=(l.deviceLocked&&s!=='revoked')?`<button class="act act-copy" data-click="confirmReset" data-args='["${l.key}"]' title="Libera a chave para ser ativada em outro dispositivo">Liberar</button>`:'';
    return `<tr>
      <td class="td-key"><span class="key-cell">${l.key}<span class="sub">${months}${devs} · criada em ${safeFmt(l.createdAt)}</span>${desc}</span></td>
      <td class="td-status"><span class="status c-${s}"><span class="dot"></span><span style="color:var(--text)">${labels[s]}</span></span></td>
      <td class="td-ativ date-cell"><span class="td-label">Ativada</span>${safeFmt(l.activatedAt)}</td>
      <td class="td-exp date-cell"><span class="td-label">Expira</span>${safeFmt(l.expiresAt)}</td>
      <td class="td-actions"><div class="actions">
        <button class="act act-copy" data-click="copyText" data-args='["${l.key}"]'>Copiar</button>
        ${reset}
        ${revoke}
        <button class="act act-delete" data-click="confirmDelete" data-args='["${l.key}"]'>Apagar</button>
      </div></td>
    </tr>`;
  }).join('');
}

function confirmRevoke(key){
  showConfirm('Revogar licença',['Revogar ',['strong',key],'? O usuário perde o acesso.'],'Revogar','warn',()=>doRevoke(key));
}
function confirmDelete(key){
  showConfirm('Apagar licença',['Apagar ',['strong',key],' para sempre? Essa ação não pode ser desfeita.'],'Apagar','danger',()=>doDelete(key));
}
function confirmReset(key){
  showConfirm('Liberar dispositivo',['Liberar ',['strong',key],' para outro dispositivo? O aparelho atual perde o acesso e o próximo que ativar assume a chave.'],'Liberar','warn',()=>doReset(key));
}
async function doRevoke(key){
  if(!KEY_RE.test(key))return;
  const r=await fetch(`${API}/api/admin/licenses/${key}`,{method:'DELETE',headers:{'X-Admin-Secret':adminSecret}});
  if(r.ok){showToast('Licença revogada');loadLicenses();}else showToast('Erro ao revogar');
}
async function doReset(key){
  if(!KEY_RE.test(key))return;
  const r=await fetch(`${API}/api/admin/licenses/${key}/reset-device`,{method:'PATCH',headers:{'X-Admin-Secret':adminSecret}});
  if(r.ok){showToast('Dispositivo liberado');loadLicenses();}else showToast('Erro ao liberar');
}
async function doDelete(key){
  if(!KEY_RE.test(key))return;
  const r=await fetch(`${API}/api/admin/licenses/${key}/hard`,{method:'DELETE',headers:{'X-Admin-Secret':adminSecret}});
  if(r.ok){showToast('Licença apagada');loadLicenses();}else showToast('Erro ao apagar');
}

function showConfirm(title,parts,okLabel,tone,onOk){
  document.getElementById('confirm-title').textContent=title;
  const box=document.getElementById('confirm-msg');
  box.replaceChildren(...parts.map(p=>{
    if(typeof p==='string')return document.createTextNode(p);
    const el=document.createElement(p[0]);el.textContent=p[1];return el;
  }));
  const ok=document.getElementById('confirm-ok');
  ok.textContent=okLabel;
  ok.className='btn-confirm '+(tone||'');
  ok.onclick=()=>{closeConfirm();onOk();};
  document.getElementById('confirm-modal').classList.add('open');
}
function closeConfirm(){document.getElementById('confirm-modal').classList.remove('open');}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeConfirm();});
document.getElementById('confirm-modal').addEventListener('click',e=>{if(e.target.id==='confirm-modal')closeConfirm();});

let toastTimer;
function showToast(msg){
  clearTimeout(toastTimer);
  const t=document.getElementById('toast');
  t.textContent=msg;
  t.classList.add('show');
  toastTimer=setTimeout(()=>t.classList.remove('show'),2400);
}

function noop(){}
function onDateModeChange(el){setDateMode(el.checked?'custom':'auto');}
function onSearchInput(){resetVisible();renderTable();}

const ACTIONS={
  doLogin,doLogout,loadLicenses,createLicenses,copyAllKeys,copyText,changeQty,setFilter,showMore,
  closeConfirm,toggleDD,openCal,navCal,pickDate,pickValidity,confirmRevoke,confirmDelete,confirmReset,
  onDateModeChange,onSearchInput,pickDevices,noop,
};

function runAction(el,e,attr){
  const name=el.getAttribute(attr);
  const fn=Object.prototype.hasOwnProperty.call(ACTIONS,name)?ACTIONS[name]:null;
  if(!fn)return;
  let args=[];
  const raw=el.getAttribute('data-args');
  if(raw){try{args=JSON.parse(raw);}catch(_){return;}if(!Array.isArray(args))return;}
  fn(...args.map(a=>a==='$el'?el:a==='$ev'?e:a));
}

function dispatch(e,attr){
  const chain=[];
  let el=e.target&&e.target.closest?e.target.closest('['+attr+']'):null;
  while(el){chain.push(el);el=el.parentElement?el.parentElement.closest('['+attr+']'):null;}
  for(const node of chain){
    if(node.hasAttribute('data-stop'))e.stopPropagation();
    runAction(node,e,attr);
    if(e.cancelBubble)break;
  }
}
document.addEventListener('click',e=>dispatch(e,'data-click'));
document.addEventListener('change',e=>dispatch(e,'data-change'));
document.addEventListener('input',e=>dispatch(e,'data-input'));
document.addEventListener('click',e=>{if(!e.cancelBubble)closePopups();});
