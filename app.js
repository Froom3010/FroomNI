/***** FroomNI — Full app.js (admin + live status + header chip) *****/

// 1) Firebase init — paste your config:
const firebaseConfig = {
  apiKey: "AIzaSyCzP19H__YXWhap30SCDC4_volJz-erwt0",
  authDomain: "froomtest-d83f3.firebaseapp.com",
  projectId: "froomtest-d83f3",
  storageBucket: "froomtest-d83f3.firebasestorage.app",
  messagingSenderId: "313030534473",
  appId: "1:313030534473:web:180fa6e5856a9011702698"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// 2) Helpers
const $  = (s)=>document.querySelector(s);
const $$ = (s)=>Array.from(document.querySelectorAll(s));
const on = (sel, ev, fn)=>{ const el=$(sel); if(el) el.addEventListener(ev, fn); };
const show = el=>{ if(el) el.classList.remove('hidden'); };
const hide = el=>{ if(el) el.classList.add('hidden'); };
const val  = (sel)=>($(sel)?.value || '').trim();
const set  = (sel,txt)=>{ const el=$(sel); if(el) el.textContent = txt; };

function getAdminBtn(){ return document.getElementById('adminTab') || document.getElementById('adminTabBtn'); }

// 3) App state
const me = { uid:null, email:null, fullName:null, role:'Other', practiceCode:null, isAdmin:false };
let unsubTeam=null, unsubAct=null, presenceTimer=null;

// 4) Visual helpers (BUSY=amber, DND=red)
function initials(n){ if(!n) return '…'; return n.trim().split(/\s+/).slice(0,2).map(x=>x[0].toUpperCase()).join(''); }
function dotCls(av){ return av==='busy' ? 'statusDot dot-busy' : av==='dnd' ? 'statusDot dot-dnd' : 'statusDot'; }
function badgeCls(av){ return av==='busy' ? 'badge busy' : av==='dnd' ? 'badge dnd' : 'badge ok'; }
function setTab(t){
  ['overview','me','activity','admin'].forEach(id=>{
    $('#tab-'+id)?.classList.toggle('hidden', id!==t);
    document.querySelector(`.tabs [data-tab="${id}"]`)?.classList.toggle('active', id===t);
  });
}
window.showTab = (sectionId) => { // lets the header call showTab("tab-overview")
  const id = (sectionId||'').replace('tab-','');
  setTab(id || 'overview');
};

// 5) Auth UI: email/password + optional anonymous join
on('#signinBtn','click', async ()=>{
  const email = val('#email'); const pass = val('#pass');
  if(!email || !pass) return alert('Enter email and password');
  try{ await auth.signInWithEmailAndPassword(email, pass); }catch(e){ alert(e.message); }
});

on('#signupToggle','click', ()=> $('#signupArea')?.classList.toggle('hidden'));

on('#signupBtn','click', async ()=>{
  const inviteCode = val('#inviteCode');
  const fullName   = val('#signupName');
  const email      = val('#email');
  const pass       = val('#pass');
  if(!inviteCode || !fullName || !email || !pass) return alert('Fill all fields');

  try{
    const invDoc = await db.collection('invites').doc(inviteCode).get();
    if(!invDoc.exists) return alert('Invalid invite code');
    const inv = invDoc.data(); if(inv.usedBy) return alert('Invite already used');

    await auth.createUserWithEmailAndPassword(email, pass);
    const u = auth.currentUser; if(!u) return;

    // profile
    await db.collection('profiles').doc(u.uid).set({
      email, fullName, role: inv.role || 'Other', practiceCode: inv.practiceCode, isAdmin:false
    }, { merge:true });

    // practice + user record
    await db.collection('practices').doc(inv.practiceCode).set({ name: inv.practiceCode, createdAt: Date.now() }, { merge:true });

    await db.collection('practices').doc(inv.practiceCode).collection('users').doc(u.uid).set({
      practiceCode: inv.practiceCode, fullName, role: inv.role || 'Other',
      availability:'free', activity:'Active now', location:'', note:'',
      lastActive: Date.now(), disabled:false
    }, { merge:true });

    await invDoc.ref.set({ usedBy: u.uid, usedAt: Date.now() }, { merge:true });
    alert('Account created');
  }catch(e){ alert(e.message); }
});

// Your previous anonymous "Enter" flow (kept)
on('#enterBtn','click', async ()=>{
  if(!auth.currentUser) await auth.signInAnonymously();
  const u = auth.currentUser;

  const pr = val('#prCode').toUpperCase();
  const fullName = val('#fullName');
  const role = $('#role')?.value || 'Other';
  const location = val('#location');
  if(!pr || !fullName) return alert('Enter practice code and full name');

  me.uid = u.uid; me.email = u.email || ''; me.fullName = fullName; me.role=role; me.practiceCode = pr;

  await db.collection('profiles').doc(u.uid).set({
    email: me.email, fullName, role, practiceCode: pr, isAdmin: me.isAdmin||false
  }, { merge:true });

  await db.collection('practices').doc(pr).set({ name: pr, createdAt: Date.now() }, { merge:true });

  await db.collection('practices').doc(pr).collection('users').doc(u.uid).set({
    practiceCode: pr, fullName, role, location,
    availability:'free', activity:'Active now', note:'', lastActive: Date.now(), disabled:false
  }, { merge:true });

  set('#chipPractice', pr); set('#chipMe', fullName);
  // header chip
  set('#chipName', fullName);
  set('#chipRole', role);
  const a = $('#userAvatar'); if(a) a.textContent = (fullName||'?').charAt(0).toUpperCase();

  hide($('#auth')); show($('#tabs')); setTab('overview');
  subscribeTeam(); subscribeActivity(); startPresence();
});

// 6) Save my status
on('#saveBtn','click', async ()=>{
  if(!me.uid || !me.practiceCode) return alert('Join a practice first');
  const availability = $('#avail')?.value || 'free';
  const activity     = $('#activity')?.value || 'Active now';
  const location     = val('#meLocation');
  const note         = val('#note');

  await db.collection('practices').doc(me.practiceCode).collection('users').doc(me.uid).set({
    practiceCode: me.practiceCode, fullName: me.fullName, role: me.role,
    availability, activity, location, note, lastActive: Date.now()
  }, { merge:true });

  await db.collection('practices').doc(me.practiceCode).collection('activity').add({
    byUid: me.uid, byName: me.fullName,
    change: `${availability.toUpperCase()} • ${activity}${location?' @ '+location:''}${note?' — '+note:''}`,
    ts: Date.now()
  });
  alert('Saved');
});

// 7) Presence (online < 60s)
function startPresence(){
  if(presenceTimer) clearInterval(presenceTimer);
  presenceTimer = setInterval(async ()=>{
    if(!me.uid || !me.practiceCode) return;
    await db.collection('practices').doc(me.practiceCode).collection('users').doc(me.uid)
      .set({ lastActive: Date.now() }, { merge:true });
  }, 25000);
}

// 8) Live Overview + Activity
function subscribeTeam(){
  if(unsubTeam) unsubTeam();
  if(!me.practiceCode) return;
  const ref = db.collection('practices').doc(me.practiceCode).collection('users');

  unsubTeam = ref.orderBy('fullName').onSnapshot(qs=>{
    const wrap = $('#team'); if(wrap) wrap.innerHTML='';
    const empty = $('#teamEmpty');
    if(qs.empty){ hide($('#team')); show(empty); return; }
    show($('#team')); hide(empty);
    const now = Date.now();

    qs.forEach(doc=>{
      const u = doc.data(); if(!wrap) return;
      const online = (now - (u.lastActive||0)) < 60000;
      const item = document.createElement('div'); item.className='item';
      item.innerHTML = `
        <div class="${dotCls(u.availability||'free')}"></div>
        <div class="avatar">${initials(u.fullName||'')}</div>
        <div style="flex:1">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <strong>${u.fullName || 'Unknown'}</strong>
            <span class="${badgeCls(u.availability||'free')}">${(u.availability||'free').toUpperCase()}</span>
          </div>
          <div class="muted">${u.location||''}</div>
          <div class="muted">${u.activity||''}${u.note?' — '+u.note:''}</div>
          <div class="muted">${online?'Online':'Active '+ new Date(u.lastActive||0).toLocaleTimeString()}</div>
        </div>`;
      wrap.appendChild(item);
    });
  });
}

function subscribeActivity(){
  if(unsubAct) unsubAct();
  if(!me.practiceCode) return;
  const ref = db.collection('practices').doc(me.practiceCode).collection('activity')
                .orderBy('ts','desc').limit(50);
  unsubAct = ref.onSnapshot(qs=>{
    const wrap = $('#activityList'); if(wrap) wrap.innerHTML='';
    if(qs.empty){ hide($('#activityList')); show($('#activityEmpty')); return; }
    show($('#activityList')); hide($('#activityEmpty'));
    qs.forEach(doc=>{
      const a = doc.data();
      const row = document.createElement('div'); row.className='item';
      row.innerHTML = `<div class="badge">${new Date(a.ts).toLocaleTimeString()}</div>
        <div style="padding-left:8px;"><strong>${a.byName||'Unknown'}</strong>
          <div class="muted">${a.change||''}</div></div>`;
      wrap?.appendChild(row);
    });
  });
}

// 9) Tabs
$$('.tabs button[data-tab]').forEach(b=>{
  b.addEventListener('click', () => setTab(b.getAttribute('data-tab')));
});

// 10) Admin
const OWNER_EMAIL = 'ronanbrennan56@gmail.com'; // first-time admin lock

on('#claimAdminBtn','click', async ()=>{
  const user = auth.currentUser;
  if(!user) return alert('Sign in first (email/password).');
  if((user.email||'').toLowerCase() !== OWNER_EMAIL.toLowerCase())
    return alert('Only the owner can claim admin.');

  const already = await db.collection('admins').limit(1).get();
  if(!already.empty) return alert('An admin already exists.');

  await db.collection('admins').doc(user.uid).set({ email:user.email, createdAt: Date.now() });
  await db.collection('profiles').doc(user.uid).set({ isAdmin:true }, { merge:true });
  me.isAdmin = true;
  const btn = getAdminBtn(); if(btn) show(btn);
  alert('You are now the admin.');
});

on('#createPracticeBtn','click', async ()=>{
  if(!me.isAdmin) return alert('Admin only.');
  const code = val('#newPracticeCode').toUpperCase();
  const name = val('#newPracticeName') || code;
  if(!code) return alert('Enter a practice code');
  await db.collection('practices').doc(code).set({ name, createdAt: Date.now() }, { merge:true });
  alert('Practice created: '+code);
});

function randomCode(len=28){ const c='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; let s=''; for(let i=0;i<len;i++) s+=c[Math.floor(Math.random()*c.length)]; return s; }

on('#makeInviteBtn','click', async ()=>{
  if(!me.isAdmin) return alert('Admin only.');
  const practice = val('#invPractice').toUpperCase();
  const role = $('#invRole')?.value || 'Other';
  if(!practice) return alert('Practice code?');
  const id = randomCode();
  await db.collection('invites').doc(id).set({
    practiceCode: practice, role, createdBy: me.uid, createdAt: Date.now(), usedBy: null, active: true
  });
  set('#lastInvite','Invite code: '+id);
  alert('Invite created. Share this code with the staff member.');
});

on('#loadStaffBtn','click', async ()=>{
  if(!me.isAdmin) return alert('Admin only.');
  const pr = val('#managePractice').toUpperCase();
  if(!pr) return alert('Practice code?');
  const qs = await db.collection('practices').doc(pr).collection('users').orderBy('fullName').get();
  const wrap = $('#staffList'); if(wrap) wrap.innerHTML='';
  if(qs.empty){ wrap.innerHTML='<div class="small">No users yet.</div>'; return; }
  qs.forEach(doc=>{
    const u = doc.data();
    const row = document.createElement('div'); row.className='listItem';
    row.innerHTML = `
      <div class="${dotCls(u.availability||'free')}"></div>
      <div style="flex:1">
        <strong>${u.fullName||'Unknown'}</strong>
        <div class="small">${u.role||''} • ${doc.id}</div>
      </div>
      <button class="ghost" data-id="${doc.id}" data-pr="${pr}">${u.disabled?'Enable':'Disable'}</button>`;
    row.querySelector('button').onclick = async (e)=>{
      const id = e.target.dataset.id; const prc = e.target.dataset.pr;
      const ref = db.collection('practices').doc(prc).collection('users').doc(id);
      const snap = await ref.get(); const cur = !!(snap.data() && snap.data().disabled);
      await ref.set({ disabled: !cur }, { merge:true });
      alert((!cur?'Disabled ':'Enabled ')+id);
      $('#loadStaffBtn').click();
    };
    wrap?.appendChild(row);
  });
});

// 11) Auth state listener — central brain
auth.onAuthStateChanged(async (user)=>{
  const adminBtn = getAdminBtn();
  if(!user){
    show($('#auth')); hide($('#tabs')); if(adminBtn) hide(adminBtn);
    // reset header chip
    set('#chipName',''); set('#chipRole',''); const a=$('#userAvatar'); if(a) a.textContent='U';
    return;
  }

  me.uid = user.uid; me.email = user.email || '';

  const prof = await db.collection('profiles').doc(me.uid).get();
  if(prof.exists){
    const p = prof.data();
    me.fullName = p.fullName || me.email;
    me.practiceCode = p.practiceCode || null;
    me.role = p.role || 'Other';
    me.isAdmin = !!p.isAdmin;
  }else{
    me.fullName = me.email; me.isAdmin = false;
  }

  // header chip
  set('#chipName', me.fullName || '');
  set('#chipRole', me.role || '');
  const a = $('#userAvatar'); if(a) a.textContent = (me.fullName||'?').charAt(0).toUpperCase();

  if(adminBtn) (me.isAdmin ? show(adminBtn) : hide(adminBtn));

  if(me.practiceCode){
    set('#chipPractice', me.practiceCode);
    hide($('#auth')); show($('#tabs')); setTab('overview');
    subscribeTeam(); subscribeActivity(); startPresence();
  }
});
