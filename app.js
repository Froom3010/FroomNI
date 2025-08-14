const firebaseConfig = {
  apiKey: "PASTE_HERE",
  authDomain: "PASTE_HERE.firebaseapp.com",
  projectId: "PASTE_HERE",
  storageBucket: "PASTE_HERE.appspot.com",
  messagingSenderId: "PASTE_HERE",
  appId: "PASTE_HERE"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const $ = (s) => document.querySelector(s);
const show = el => el.classList.remove('hidden');
const hide = el => el.classList.add('hidden');

let uid = null;
let currentPractice = null;
let me = { fullName:'', role:'Reception', location:'', availability:'free', activity:'Active now', note:'' };
let unsubTeam = null, unsubActivity = null, presenceTimer = null;

function initials(n){ if(!n) return '…'; return n.trim().split(/\s+/).slice(0,2).map(s=>s[0].toUpperCase()).join(''); }
function badgeCls(av){ return av==='busy'?'badge busy':av==='dnd'?'badge dnd':'badge ok'; }
function dotCls(av){ return av==='busy'?'statusDot dot-busy':av==='dnd'?'statusDot dot-dnd':'statusDot'; }
function setTab(t){ ['overview','me','activity'].forEach(id=>{ $('#tab-'+id).classList.toggle('hidden', id!==t); document.querySelector(`.tabs [data-tab="${id}"]`).classList.toggle('active', id===t); }); }

async function signAnon(){ const cred = await auth.signInAnonymously(); uid = cred.user.uid; show($('#logoutBtn')); }
$('#logoutBtn').addEventListener('click', async ()=>{ if(unsubTeam) unsubTeam(); if(unsubActivity) unsubActivity(); if(presenceTimer) clearInterval(presenceTimer); await auth.signOut(); location.reload(); });

document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('.tabs button[data-tab]').forEach(b=>{ b.addEventListener('click', ()=> setTab(b.getAttribute('data-tab'))); });
  await signAnon();

  $('#enterBtn').addEventListener('click', async ()=>{
    const pr = ($('#prCode').value||'').trim().toUpperCase();
    const fullName = ($('#fullName').value||'').trim();
    const role = $('#role').value||'Reception';
    const location = ($('#location').value||'').trim();
    if(!pr || !fullName) return alert('Enter practice code and full name.');

    currentPractice = pr;
    me = { ...me, fullName, role, location };
    $('#chipPractice').textContent = pr; $('#chipMe').textContent = fullName;
    hide($('#auth')); show($('#tabs')); setTab('overview');

    await db.collection('practices').doc(pr).set({name: pr, createdAt: Date.now()},{merge:true});
    await db.collection('practices').doc(pr).collection('users').doc(uid).set({ fullName, role, location, availability: me.availability, activity: me.activity, note: me.note, lastActive: Date.now() }, { merge:true });

    subscribeTeam(); subscribeActivity(); startPresence();
  });

  $('#saveBtn').addEventListener('click', saveMyStatus);
});

async function saveMyStatus(){
  if(!uid || !currentPractice) return;
  me.availability = $('#avail').value;
  me.activity = $('#activity').value;
  me.location = $('#meLocation').value.trim();
  me.note = $('#note').value.trim();
  await db.collection('practices').doc(currentPractice).collection('users').doc(uid).set({ fullName: me.fullName, role: me.role, availability: me.availability, activity: me.activity, location: me.location, note: me.note, lastActive: Date.now() }, { merge:true });
  await db.collection('practices').doc(currentPractice).collection('activity').add({ byUid: uid, byName: me.fullName, change: `${me.availability.toUpperCase()} • ${me.activity}${me.location?' @ '+me.location:''}${me.note?' — '+me.note:''}`, ts: Date.now() });
  alert('Saved.');
}

function startPresence(){ if(presenceTimer) clearInterval(presenceTimer); presenceTimer = setInterval(async ()=>{ if(!uid || !currentPractice) return; await db.collection('practices').doc(currentPractice).collection('users').doc(uid).set({ lastActive: Date.now() }, { merge:true }); }, 25000); }

function subscribeTeam(){
  if(unsubTeam) unsubTeam();
  const ref = db.collection('practices').doc(currentPractice).collection('users');
  unsubTeam = ref.orderBy('fullName').onSnapshot(qs=>{
    const wrap = $('#team'); wrap.innerHTML='';
    if(qs.empty){ hide($('#team')); show($('#teamEmpty')); return; }
    show($('#team')); hide($('#teamEmpty'));
    const now = Date.now();
    qs.forEach(doc=>{
      const u = doc.data(); const online = (now - (u.lastActive||0)) < 60000;
      const item = document.createElement('div'); item.className='item';
      item.innerHTML = `<div class="${dotCls(u.availability||'free')}"></div>
        <div class="avatar">${initials(u.fullName||'')}</div>
        <div style="flex:1">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <strong>${u.fullName || 'Unknown'}</strong>
            <span class="${badgeCls(u.availability||'free')}">${(u.availability||'free').toUpperCase()}</span>
          </div>
          <div class="muted">${u.location||''}</div>
          <div class="muted">${u.activity||''}${u.note ? ' — '+u.note : ''}</div>
          <div class="muted">${online?'Online':'Active '+ new Date(u.lastActive||0).toLocaleTimeString()}</div>
        </div>`;
      wrap.appendChild(item);
    });
  });
}

function subscribeActivity(){
  if(unsubActivity) unsubActivity();
  const ref = db.collection('practices').doc(currentPractice).collection('activity').orderBy('ts','desc').limit(50);
  unsubActivity = ref.onSnapshot(qs=>{
    const wrap = $('#activityList'); wrap.innerHTML='';
    if(qs.empty){ hide($('#activityList')); show($('#activityEmpty')); return; }
    show($('#activityList')); hide($('#activityEmpty'));
    qs.forEach(doc=>{
      const a = doc.data(); const row = document.createElement('div'); row.className='item';
      row.innerHTML = `<div class="badge">${new Date(a.ts).toLocaleTimeString()}</div>
        <div style="padding-left:8px;"><strong>${a.byName||'Unknown'}</strong><div class="muted">${a.change||''}</div></div>`;
      wrap.appendChild(row);
    });
  });
}
