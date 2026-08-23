// ==================== CONFIG & STATE ====================
const DEFAULT_SB_URL = localStorage.getItem('sb_url') || 'https://hmqeqiacyvksyvllosnk.supabase.co';
const DEFAULT_SB_KEY = localStorage.getItem('sb_key') || 'sb_publishable_3Qg-gsCLf0QOJVCJMaqg8g_zYRkb5TC';

let supabase = null;
let sbAvailable = false;

if (DEFAULT_SB_URL && DEFAULT_SB_KEY) {
  try {
    supabase = window.supabase.createClient(DEFAULT_SB_URL, DEFAULT_SB_KEY);
    sbAvailable = true;
  } catch(e) { console.error('Supabase init failed', e); }
}

const state = {
  user: null,
  session: null,
  currentView: 'filrouge',
  events: [],
  tasks: [],
  projects: [],
  wallet: [],
  recipes: [],
  menus: [],
  focusMode: false,
  agendaDate: new Date(),
  menuWeekDate: new Date(),
  taskPeriod: 'all',
  taskPeriodDate: new Date(),
  editingId: null,
  editingType: null
};

const PHASES = {
  perso: ['Idée','Recherche','En cours','Terminé','Abandonné'],
  collaboratif: ['Brainstorm','Validé','En développement','Lancé','Abandonné'],
  investissement: ['Idée','Recherche','En cours','Acquis','Abandonné']
};

const CAT_COLORS = { rdv:'var(--rdv)', anniversaire:'var(--anniv)', courses:'var(--courses)', facture:'var(--facture)', appel:'var(--appel)', sport:'var(--sport)', autre:'var(--autre)' };

// ==================== LOCALSTORAGE FALLBACK ====================
function lsKey(k) { return 'cbu_' + (state.user?.id || 'anon') + '_' + k; }
function getLocal(k) { try { return JSON.parse(localStorage.getItem(lsKey(k)) || '[]'); } catch { return []; } }
function setLocal(k, v) { localStorage.setItem(lsKey(k), JSON.stringify(v)); }

// ==================== SUPABASE WRAPPERS ====================
function friendlyError(msg) {
  const m = (msg || '').toLowerCase();
  if (m.includes('could not find the table') || m.includes('schema cache')) return "La configuration n'est pas encore terminée sur ce compte. Tes données sont gardées sur cet appareil en attendant — rien n'est perdu.";
  if (m.includes('invalid api key') || m.includes('jwt') || m.includes('apikey')) return "Problème de connexion au serveur. Tes données restent sauvegardées ici, réessaie un peu plus tard.";
  if (m.includes('duplicate key') || m.includes('already exists')) return "Cet élément existe déjà.";
  if (m.includes('permission denied') || m.includes('row-level security') || m.includes('rls')) return "Tu n'as pas accès à cet élément.";
  if (m.includes('failed to fetch') || m.includes('network')) return "Pas de connexion internet. Tes données restent sauvegardées sur cet appareil.";
  return "Un souci est survenu. Tes données restent sauvegardées sur cet appareil en attendant.";
}
let _syncWarningShown = false;
function reportSyncIssue(error) {
  if (_syncWarningShown) return; // évite de spammer l'utilisateur
  _syncWarningShown = true;
  toast(friendlyError(error?.message), 'error');
}
async function sbSelect(table, opts={}) {
  if (!sbAvailable || !supabase) return getLocal(table);
  let q = supabase.from(table).select(opts.columns || '*');
  if (opts.order) q = q.order(opts.order.column, { ascending: opts.order.asc });
  const { data, error } = await q;
  if (error) { reportSyncIssue(error); return getLocal(table); }
  return data || [];
}
async function sbInsert(table, obj) {
  if (!sbAvailable || !supabase) { const arr=getLocal(table); obj.id=crypto.randomUUID(); obj.created_at=new Date().toISOString(); arr.push(obj); setLocal(table,arr); return { data:[obj] }; }
  const { data, error } = await supabase.from(table).insert(obj).select();
  if (error) {
    reportSyncIssue(error);
    const arr=getLocal(table); obj.id=crypto.randomUUID(); obj.created_at=new Date().toISOString(); arr.push(obj); setLocal(table,arr);
    return { data:[obj] };
  }
  return { data, error };
}
async function sbUpdate(table, id, obj) {
  if (!sbAvailable || !supabase) { const arr=getLocal(table).map(x=>x.id===id?{...x,...obj}:x); setLocal(table,arr); return {}; }
  const { error } = await supabase.from(table).update(obj).eq('id', id);
  if (error) {
    reportSyncIssue(error);
    const arr=getLocal(table).map(x=>x.id===id?{...x,...obj}:x); setLocal(table,arr);
  }
  return { error };
}
async function sbDelete(table, id) {
  if (!sbAvailable || !supabase) { const arr=getLocal(table).filter(x=>x.id!==id); setLocal(table,arr); return {}; }
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) {
    reportSyncIssue(error);
    const arr=getLocal(table).filter(x=>x.id!==id); setLocal(table,arr);
  }
  return { error };
}

// ==================== AUTH ====================
function showAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.auth-form').forEach(f=>f.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById(tab==='reset'?'resetForm':(tab==='register'?'registerForm':'loginForm')).classList.add('active');
}

function friendlyAuthError(msg) {
  const m = (msg || '').toLowerCase();
  if (m.includes('invalid login credentials')) return "Email ou mot de passe incorrect.";
  if (m.includes('user already registered') || m.includes('already registered')) return "Un compte existe déjà avec cet email. Essaie de te connecter.";
  if (m.includes('email not confirmed')) return "Confirme d'abord ton email (vérifie ta boîte de réception) avant de te connecter.";
  if (m.includes('password should be at least')) return "Le mot de passe doit faire au moins 8 caractères.";
  if (m.includes('rate limit') || m.includes('too many requests')) return "Trop de tentatives, patiente une minute puis réessaie.";
  if (m.includes('unable to validate email') || m.includes('invalid email')) return "Cette adresse email n'est pas valide.";
  if (m.includes('failed to fetch') || m.includes('network')) return "Connexion impossible. Vérifie ta connexion internet.";
  return "Un problème est survenu. Réessaie dans un instant.";
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  document.getElementById('loginBtnText').textContent = 'Connexion...';
  if (sbAvailable && supabase) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { toast(friendlyAuthError(error.message), 'error'); document.getElementById('loginBtnText').textContent = 'Se connecter'; return; }
    state.session = data.session; state.user = data.user;
  } else {
    // Local auth fallback
    const users = JSON.parse(localStorage.getItem('cbu_local_users') || '[]');
    const u = users.find(x=>x.email===email);
    if (!u || u.password !== password) { toast('Email ou mot de passe incorrect', 'error'); document.getElementById('loginBtnText').textContent='Se connecter'; return; }
    state.user = { id: u.id, email: u.email, user_metadata: { pseudo: u.pseudo } };
    state.session = { access_token: 'local' };
  }
  onAuthSuccess();
}

async function handleRegister(e) {
  e.preventDefault();
  const pseudo = document.getElementById('regPseudo').value;
  const email = document.getElementById('regEmail').value;
  const password = document.getElementById('regPassword').value;
  document.getElementById('regBtnText').textContent = 'Création...';
  if (sbAvailable && supabase) {
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { pseudo } } });
    if (error) { toast(friendlyAuthError(error.message), 'error'); document.getElementById('regBtnText').textContent='Créer mon compte'; return; }
    toast('Compte créé ! Vérifie ton email pour confirmer.', 'success');
    showAuthTab('login'); document.querySelector('.auth-tab').click();
  } else {
    const users = JSON.parse(localStorage.getItem('cbu_local_users') || '[]');
    if (users.find(x=>x.email===email)) { toast('Cet email est déjà utilisé', 'error'); return; }
    const newUser = { id: crypto.randomUUID(), pseudo, email, password };
    users.push(newUser);
    localStorage.setItem('cbu_local_users', JSON.stringify(users));
    state.user = { id: newUser.id, email, user_metadata: { pseudo } };
    state.session = { access_token: 'local' };
    onAuthSuccess();
  }
}

async function handleReset(e) {
  e.preventDefault();
  const email = document.getElementById('resetEmail').value;
  if (sbAvailable && supabase) {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) toast(friendlyAuthError(error.message), 'error');
    else toast('Email de réinitialisation envoyé !', 'success');
  } else {
    toast("Mode local : réinitialisation impossible. Contacte l'admin.", 'error');
  }
}

async function handleLogout() {
  if (sbAvailable && supabase) await supabase.auth.signOut();
  state.user = null; state.session = null;
  localStorage.removeItem('cbu_session');
  location.reload();
}

async function onAuthSuccess() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appContainer').classList.remove('hidden');
  const pseudo = state.user.user_metadata?.pseudo || state.user.email?.split('@')[0] || 'User';
  document.getElementById('userName').textContent = pseudo;
  document.getElementById('userEmail').textContent = state.user.email || 'local';
  document.getElementById('userAvatar').textContent = pseudo[0].toUpperCase();
  document.getElementById('settingsPseudo').value = pseudo;
  document.getElementById('settingsEmail').value = state.user.email || 'local';
  await loadAllData();
  const restoredView = (location.hash ? location.hash.slice(1) : null) || localStorage.getItem('cbu_last_view') || 'accueil';
  if (document.getElementById('view-'+restoredView)) navigateTo(restoredView, true); else renderCurrentView();
  if (!sbAvailable) toast('Mode local activé. Configure Supabase dans Paramètres pour la synchro.', 'info');
  const onboardKey = 'cbu_onboarded_' + state.user.id;
  if (!localStorage.getItem(onboardKey)) {
    document.getElementById('onboardingGreeting').textContent = 'Bienvenue, ' + pseudo + ' !';
    document.getElementById('onboardingModal').classList.add('active');
  }
}
function closeOnboarding() {
  document.getElementById('onboardingModal').classList.remove('active');
  if (state.user) localStorage.setItem('cbu_onboarded_' + state.user.id, '1');
}
function openOnboardingHelp() {
  const pseudo = state.user?.user_metadata?.pseudo || 'là';
  document.getElementById('onboardingGreeting').textContent = 'Comment utiliser Carnet de Bord';
  document.getElementById('onboardingModal').classList.add('active');
}

// Check existing session
async function checkSession() {
  if (sbAvailable && supabase) {
    const { data } = await supabase.auth.getSession();
    if (data.session) { state.session = data.session; state.user = data.session.user; onAuthSuccess(); }
  }
}
checkSession();

// ==================== DATA LOADING ====================
async function loadAllData() {
  state.events = await sbSelect('events', { order: { column: 'date', asc: true } });
  state.tasks = await sbSelect('tasks', { order: { column: 'created_at', asc: false } });
  state.projects = await sbSelect('projects', { order: { column: 'created_at', asc: false } });
  state.wallet = await sbSelect('wallet_assets', { order: { column: 'created_at', asc: false } });
  state.recipes = await sbSelect('recipes', { order: { column: 'created_at', asc: false } });
  state.menus = await sbSelect('menus', { order: { column: 'date', asc: true } });
  populateProjectSelects();
  populateShoppingSuggestions();
}

function populateProjectSelects() {
  const sel = document.getElementById('taskProject');
  if (!sel) return;
  sel.innerHTML = '<option value="">Aucun</option>';
  state.projects.forEach(p => {
    const opt = document.createElement('option'); opt.value = p.id; opt.textContent = p.title; sel.appendChild(opt);
  });
}

// ==================== NAVIGATION ====================
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarBackdrop').classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarBackdrop').classList.remove('open');
}
function navigateTo(view, skipHistory) {
  state.currentView = view;
  document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden'));
  document.getElementById('view-' + view).classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const nav = document.querySelector('.nav-item[data-view="'+view+'"]');
  if (nav) nav.classList.add('active');
  closeSidebar();
  localStorage.setItem('cbu_last_view', view);
  if (!skipHistory) {
    if (location.hash !== '#'+view) history.pushState({ view }, '', '#'+view);
  }
  renderCurrentView();
}
window.addEventListener('popstate', e => {
  const view = (e.state && e.state.view) || (location.hash ? location.hash.slice(1) : 'accueil');
  if (document.getElementById('view-'+view)) navigateTo(view, true);
});

function renderCurrentView() {
  if (state.currentView === 'accueil') renderAccueil();
  else if (state.currentView === 'filrouge') renderFilRouge();
  else if (state.currentView === 'agenda') renderAgenda();
  else if (state.currentView === 'tasks') renderTasks();
  else if (state.currentView === 'menus') renderMenus();
  else if (state.currentView === 'recipes') renderRecipesContainer();
  else if (state.currentView === 'projects') renderProjects();
  else if (state.currentView === 'wallet') renderWallet();
}

const WELLBEING_LINKS = [
  { emoji: '🧘', title: 'Une pause respiration de 3 minutes', url: 'https://www.psychologies.com/Bien-etre/Se-detendre/Relaxation' },
  { emoji: '🚶', title: 'Les bienfaits d\'une marche de 20 minutes', url: 'https://www.passeportsante.net/fr/Actualites/Dossiers/DossierComplexe.aspx?doc=marche-benefices-sante' },
  { emoji: '📵', title: 'Pourquoi une micro-pause sans écran fait du bien', url: 'https://www.doctissimo.fr/psychologie/bien-etre-au-naturel' }
];

function renderAccueil() {
  const pseudo = state.user?.user_metadata?.pseudo || 'là';
  const hour = new Date().getHours();
  const greeting = hour < 6 ? 'Bonne nuit' : hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';
  const dateStr = new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });
  document.getElementById('accueilGreeting').innerHTML = `
    <h1>${greeting}, ${escapeHtml(pseudo)} 👋</h1>
    <p>${dateStr.charAt(0).toUpperCase()+dateStr.slice(1)} — voici où tu en es.</p>
  `;

  const todayStr = new Date().toISOString().split('T')[0];
  const tasksToday = state.tasks.filter(t => !t.done && (t.due === todayStr || !t.due));
  const urgentCount = state.tasks.filter(t => !t.done && t.prio === 'urgent').length;
  const totalAssets = state.wallet.filter(a=>a.type!=='credit').reduce((s,a)=>s+assetLineValue(a),0);
  const totalDebts = state.wallet.filter(a=>a.type==='credit').reduce((s,a)=>s+parseFloat(a.capital_remaining||a.value||0),0);
  const investCount = state.wallet.filter(a => a.type !== 'credit').length;
  const eventsToday = state.events.filter(e => e.date === todayStr).length;
  const activeProjects = state.projects.filter(p => !['Terminé','Abandonné','Acquis'].includes(p.phase)).length;

  document.getElementById('accueilStats').innerHTML = `
    <div class="accueil-stat-card" style="cursor:pointer" onclick="navigateTo('tasks')">
      <div class="num">${tasksToday.length}</div>
      <div class="lbl">Tâche${tasksToday.length>1?'s':''} aujourd'hui${urgentCount ? ' dont ' + urgentCount + ' urgente'+(urgentCount>1?'s':'') : ''}</div>
    </div>
    <div class="accueil-stat-card" style="cursor:pointer" onclick="navigateTo('wallet')">
      <div class="num">${investCount}</div>
      <div class="lbl">Investissement${investCount>1?'s':''} suivi${investCount>1?'s':''} · ${fmtMoney(totalAssets-totalDebts)} net</div>
    </div>
    <div class="accueil-stat-card" style="cursor:pointer" onclick="navigateTo('agenda')">
      <div class="num">${eventsToday}</div>
      <div class="lbl">Événement${eventsToday>1?'s':''} aujourd'hui · ${activeProjects} projet${activeProjects>1?'s':''} actif${activeProjects>1?'s':''}</div>
    </div>
  `;

  document.getElementById('accueilWellbeing').innerHTML = WELLBEING_LINKS.map(l =>
    `<a class="wellbeing-link" href="${l.url}" target="_blank" rel="noopener"><span>${l.emoji}</span><span>${l.title}</span></a>`
  ).join('') + `<p style="margin-top:12px;font-size:0.8rem;color:var(--text-muted)">Une bonne journée commence aussi par des petites pauses. 💛</p>`;
}

// ==================== FIL ROUGE ====================
function renderFilRouge() {
  const today = new Date(); today.setHours(0,0,0,0);
  document.getElementById('currentDate').textContent = today.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });
  renderQuickSuggestions('quickSuggestFilrouge');

  // Timeline
  const todaysEvents = state.events.filter(e => {
    const d = new Date(e.date); d.setHours(0,0,0,0);
    return d.getTime() === today.getTime();
  }).sort((a,b) => (a.time||'').localeCompare(b.time||''));

  const timelineHTML = todaysEvents.map(e => `
    <div class="timeline-item event animate-fade">
      <div class="timeline-time">${e.time || 'Toute la journée'}</div>
      <div class="timeline-title">${escapeHtml(e.title)}</div>
      <div style="font-size:0.8rem;color:var(--text-muted)">${escapeHtml(e.lieu || '')} ${e.numero ? '· ' + escapeHtml(e.numero) : ''}</div>
    </div>
  `).join('') || '<div class="empty-state" style="padding:20px">Aucun événement aujourd\'hui</div>';
  document.getElementById('timelineContent').innerHTML = timelineHTML;

  // Priorities (urgent + important + due today)
  const priorities = state.tasks.filter(t => !t.done && (t.prio === 'urgent' || t.prio === 'important' || isToday(t.due))).slice(0,3);
  document.getElementById('prioritiesContainer').innerHTML = priorities.map(t => `
    <div class="priority-card ${t.prio==='important'?'important':''} animate-fade">
      <div style="font-weight:600;margin-bottom:4px">${escapeHtml(t.title)}</div>
      <div style="font-size:0.8rem;color:var(--text-muted)">${t.prio==='urgent'?'🔴 Urgent':(t.prio==='important'?'🟠 Important':'📅 Aujourd\'hui')}${t.due ? ' · Échéance '+formatDate(t.due):''}</div>
    </div>
  `).join('') || '<div class="empty-state" style="padding:20px;font-size:0.9rem">Aucune priorité définie</div>';

  // Next actions (one per active project)
  const activeProjects = state.projects.filter(p => !['Terminé','Abandonné','Acquis'].includes(p.phase));
  document.getElementById('nextActionsContainer').innerHTML = activeProjects.slice(0,5).map(p => `
    <div class="alert-item info animate-fade" style="cursor:pointer" onclick="navigateTo('projects')">
      <span class="badge badge-${p.cat}">${p.cat}</span>
      <div><strong>${escapeHtml(p.title)}</strong> → ${escapeHtml(p.next || 'Définir une prochaine action')}</div>
    </div>
  `).join('') || '<div class="empty-state" style="padding:20px;font-size:0.9rem">Aucun projet actif</div>';

  // Alerts
  const alerts = [];
  const overdue = state.tasks.filter(t => !t.done && t.due && new Date(t.due) < today);
  if (overdue.length) alerts.push({ type:'error', text: `${overdue.length} tâche(s) en retard` });
  const upcomingProjects = state.projects.filter(p => p.end && daysDiff(p.end, today) <= 7 && daysDiff(p.end, today) >= 0);
  upcomingProjects.forEach(p => alerts.push({ type:'warning', text: `Échéance projet "${p.title}" dans ${daysDiff(p.end, today)} jours` }));
  document.getElementById('alertsContainer').innerHTML = alerts.map(a => `
    <div class="alert-item ${a.type} animate-fade">${a.type==='error'?'🔴':'🟠'} ${escapeHtml(a.text)}</div>
  `).join('') || '<div style="color:var(--text-muted);font-size:0.9rem">Aucune alerte 🎉</div>';

  // Counters
  const totalAssets = state.wallet.filter(a=>a.type!=='credit').reduce((s,a)=>s+assetLineValue(a),0);
  const totalDebts = state.wallet.filter(a=>a.type==='credit').reduce((s,a)=>s+parseFloat(a.capital_remaining||a.value||0),0);
  document.getElementById('countersContainer').innerHTML = `
    <div class="counter-box" style="cursor:pointer" onclick="navigateTo('tasks')"><div class="counter-value">${state.tasks.filter(t=>!t.done).length}</div><div class="counter-label">Tâches actives</div></div>
    <div class="counter-box" style="cursor:pointer" onclick="navigateTo('tasks')"><div class="counter-value">${state.tasks.filter(t=>!t.done && t.prio==='urgent').length}</div><div class="counter-label">Urgentes</div></div>
    <div class="counter-box" style="cursor:pointer" onclick="navigateTo('agenda')"><div class="counter-value">${todaysEvents.length}</div><div class="counter-label">Événements</div></div>
    <div class="counter-box" style="cursor:pointer" onclick="navigateTo('projects')"><div class="counter-value">${activeProjects.length}</div><div class="counter-label">Projets actifs</div></div>
    <div class="counter-box" style="cursor:pointer;grid-column:1/-1" onclick="navigateTo('wallet')"><div class="counter-value" style="color:var(--accent-sand)">${fmtMoney(totalAssets-totalDebts)}</div><div class="counter-label">Patrimoine net</div></div>
  `;
}

// ==================== AGENDA ====================
function renderAgenda() {
  const y = state.agendaDate.getFullYear(), m = state.agendaDate.getMonth();
  document.getElementById('agendaMonthLabel').textContent = state.agendaDate.toLocaleDateString('fr-FR', { month:'long', year:'numeric' });
  const firstDay = new Date(y, m, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const today = new Date(); today.setHours(0,0,0,0);
  const catFilter = document.getElementById('agendaCatFilter').value;

  const upcomingBox = document.getElementById('agendaUpcomingFiltered');
  if (catFilter) {
    const upcoming = state.events.filter(e => e.cat === catFilter && new Date(e.date) >= today)
      .sort((a,b) => a.date.localeCompare(b.date)).slice(0,10);
    upcomingBox.classList.remove('hidden');
    const catLabel = document.getElementById('agendaCatFilter').selectedOptions[0].textContent;
    upcomingBox.innerHTML = `<h3 class="section-title">Prochaines dates — ${catLabel}</h3>` + (upcoming.map(e => `
      <div class="task-item" style="border-left-color:${CAT_COLORS[e.cat]||'var(--border)'}" onclick="editEvent('${e.id}')">
        <div class="task-content"><div class="task-title">${escapeHtml(e.title)}</div><div class="task-meta">${formatDate(e.date)}${e.time?' · '+e.time:''}</div></div>
      </div>`).join('') || '<div class="empty-state" style="padding:20px">Aucune date à venir dans cette catégorie</div>');
  } else {
    upcomingBox.classList.add('hidden');
  }

  let html = '<div class="calendar-header">Lun</div><div class="calendar-header">Mar</div><div class="calendar-header">Mer</div><div class="calendar-header">Jeu</div><div class="calendar-header">Ven</div><div class="calendar-header">Sam</div><div class="calendar-header">Dim</div>';
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;
  for (let i=0; i<startOffset; i++) html += '<div class="calendar-day other-month"></div>';
  for (let d=1; d<=daysInMonth; d++) {
    const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = today.getTime() === new Date(y,m,d).setHours(0,0,0,0);
    let dayEvents = state.events.filter(e => e.date === dateStr);
    if (catFilter) dayEvents = dayEvents.filter(e => e.cat === catFilter);
    const dots = dayEvents.map(e => `<span class="calendar-dot" style="background:${CAT_COLORS[e.cat]||'var(--text-muted)'}"></span>`).join('');
    html += `<div class="calendar-day ${isToday?'today':''}" onclick="showDayDetail('${dateStr}')">
      <div class="calendar-day-number">${d}</div>
      <div>${dots}</div>
    </div>`;
  }
  document.getElementById('calendarGrid').innerHTML = html;
}

function exportEventsToICS() {
  if (!state.events.length) { toast('Aucun événement à exporter', 'error'); return; }
  const pad = n => String(n).padStart(2,'0');
  const toICSDate = (dateStr, timeStr) => {
    const [y,mo,d] = dateStr.split('-');
    if (timeStr) { const [h,mi] = timeStr.split(':'); return `${y}${mo}${d}T${pad(h)}${pad(mi)}00`; }
    return `${y}${mo}${d}`;
  };
  let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Carnet de Bord//FR\r\n';
  state.events.forEach(e => {
    ics += 'BEGIN:VEVENT\r\n';
    ics += `UID:${e.id}@carnetdebord\r\n`;
    if (e.time) { ics += `DTSTART:${toICSDate(e.date,e.time)}\r\n`; }
    else { ics += `DTSTART;VALUE=DATE:${toICSDate(e.date)}\r\n`; }
    ics += `SUMMARY:${(e.title||'').replace(/\r?\n/g,' ')}\r\n`;
    if (e.lieu) ics += `LOCATION:${e.lieu.replace(/\r?\n/g,' ')}\r\n`;
    if (e.notes) ics += `DESCRIPTION:${e.notes.replace(/\r?\n/g,' ')}\r\n`;
    ics += 'END:VEVENT\r\n';
  });
  ics += 'END:VCALENDAR\r\n';
  const blob = new Blob([ics], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'carnet-de-bord.ics';
  a.click(); URL.revokeObjectURL(url);
  toast('Fichier téléchargé — ouvre-le pour l\'importer dans ton calendrier', 'success');
}

function changeMonth(delta) {
  state.agendaDate.setMonth(state.agendaDate.getMonth() + delta);
  renderAgenda();
}

function showDayDetail(dateStr) {
  const dayEvents = state.events.filter(e => e.date === dateStr).sort((a,b)=>(a.time||'').localeCompare(b.time||''));
  const dayTasks = state.tasks.filter(t => t.due === dateStr && !t.done);
  document.getElementById('dayDetail').classList.remove('hidden');
  document.getElementById('dayDetailTitle').textContent = new Date(dateStr).toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });
  let html = '';
  if (dayEvents.length) {
    html += '<h4 style="color:var(--accent-sand);margin:12px 0 8px">Événements</h4>';
    html += dayEvents.map(e => `
      <div class="task-item" style="border-left-color:${CAT_COLORS[e.cat]||'var(--border)'}" onclick="editEvent('${e.id}')">
        <div class="task-content">
          <div class="task-title">${escapeHtml(e.title)}</div>
          <div class="task-meta">${e.time || ''} · ${e.cat} ${e.lieu ? '· ' + escapeHtml(e.lieu) : ''}</div>
        </div>
      </div>
    `).join('');
  }
  if (dayTasks.length) {
    html += '<h4 style="color:var(--accent-sand);margin:16px 0 8px">Tâches</h4>';
    html += dayTasks.map(t => `
      <div class="task-item ${t.prio}" onclick="editTask('${t.id}')">
        <div class="task-check ${t.done?'checked':''}" onclick="event.stopPropagation();toggleTask('${t.id}')"><span style="color:white;font-size:12px">${t.done?'✓':''}</span></div>
        <div class="task-content"><div class="task-title">${escapeHtml(t.title)}</div></div>
      </div>
    `).join('');
  }
  if (!dayEvents.length && !dayTasks.length) html = '<div class="empty-state" style="padding:20px">Rien de prévu ce jour</div>';
  document.getElementById('dayDetailContent').innerHTML = html;
}

function updateEventFields() {
  const cat = document.getElementById('evtCat').value;
  let extra = '';
  if (cat === 'sport') extra = '<div class="grid-2"><div class="form-group"><label>Type sport</label><input type="text" id="evtSportType"></div><div class="form-group"><label>Durée (min)</label><input type="number" id="evtDuration"></div></div>';
  if (cat === 'facture') extra = '<div class="grid-2"><div class="form-group"><label>Montant (€)</label><input type="number" id="evtBudget" step="0.01"></div><div class="form-group"><label>Organisme</label><input type="text" id="evtObjet"></div></div>';
  document.getElementById('evtExtraFields').innerHTML = extra;
}

async function saveEvent(e) {
  e.preventDefault();
  const obj = {
    user_id: state.user.id,
    title: document.getElementById('evtTitle').value,
    date: document.getElementById('evtDate').value,
    time: document.getElementById('evtTime').value,
    cat: document.getElementById('evtCat').value,
    rec: document.getElementById('evtRec').value,
    lieu: document.getElementById('evtLieu').value,
    numero: document.getElementById('evtNumero').value,
    lien: document.getElementById('evtLien').value,
    notes: document.getElementById('evtNotes').value,
    sport_type: document.getElementById('evtSportType')?.value || null,
    duration: document.getElementById('evtDuration')?.value || null,
    budget: document.getElementById('evtBudget')?.value || null,
    objet: document.getElementById('evtObjet')?.value || null,
    reminder: document.getElementById('evtReminder').value || null
  };
  if (state.editingType === 'event') {
    await sbUpdate('events', state.editingId, obj);
    toast('Événement mis à jour', 'success');
  } else {
    await sbInsert('events', obj);
    toast('Événement créé', 'success');
  }
  closeModal('eventModal'); await loadAllData(); renderCurrentView();
}

function editEvent(id) {
  const evt = state.events.find(e=>e.id===id); if (!evt) return;
  state.editingId = id; state.editingType = 'event';
  document.getElementById('evtTitle').value = evt.title;
  document.getElementById('evtDate').value = evt.date;
  document.getElementById('evtTime').value = evt.time || '';
  document.getElementById('evtCat').value = evt.cat;
  document.getElementById('evtRec').value = evt.rec || 'none';
  document.getElementById('evtLieu').value = evt.lieu || '';
  document.getElementById('evtNumero').value = evt.numero || '';
  document.getElementById('evtLien').value = evt.lien || '';
  document.getElementById('evtNotes').value = evt.notes || '';
  document.getElementById('evtReminder').value = evt.reminder || '';
  updateEventFields();
  if (document.getElementById('evtSportType')) document.getElementById('evtSportType').value = evt.sport_type || '';
  if (document.getElementById('evtDuration')) document.getElementById('evtDuration').value = evt.duration || '';
  populateTitleSuggestions('evtTitleSuggestions', state.events);
  openModal('eventModal');
}

// ==================== TÂCHES ====================
function periodRange(period, anchor) {
  const d = new Date(anchor);
  if (period === 'day') { const s = new Date(d); s.setHours(0,0,0,0); const e = new Date(s); e.setDate(e.getDate()+1); return [s,e]; }
  if (period === 'week') { const s = getMondayOf(d); const e = new Date(s); e.setDate(e.getDate()+7); return [s,e]; }
  if (period === 'month') { const s = new Date(d.getFullYear(), d.getMonth(), 1); const e = new Date(d.getFullYear(), d.getMonth()+1, 1); return [s,e]; }
  if (period === 'year') { const s = new Date(d.getFullYear(), 0, 1); const e = new Date(d.getFullYear()+1, 0, 1); return [s,e]; }
  return null;
}
function periodLabel(period, anchor) {
  const [s,e] = periodRange(period, anchor);
  const endIncl = new Date(e); endIncl.setDate(endIncl.getDate()-1);
  if (period === 'day') return anchor.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });
  if (period === 'week') return s.toLocaleDateString('fr-FR',{day:'numeric',month:'short'}) + ' – ' + endIncl.toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
  if (period === 'month') return anchor.toLocaleDateString('fr-FR', { month:'long', year:'numeric' });
  if (period === 'year') return String(anchor.getFullYear());
  return '';
}
function setTaskPeriod(period) {
  state.taskPeriod = period;
  state.taskPeriodDate = new Date();
  document.querySelectorAll('#taskPeriodTabs .tab').forEach(t => t.classList.toggle('active', t.dataset.period === period));
  document.getElementById('taskPeriodNav').classList.toggle('hidden', period === 'all');
  renderTasks();
}
function changeTaskPeriod(delta) {
  const d = state.taskPeriodDate;
  if (state.taskPeriod === 'day') d.setDate(d.getDate() + delta);
  else if (state.taskPeriod === 'week') d.setDate(d.getDate() + delta*7);
  else if (state.taskPeriod === 'month') d.setMonth(d.getMonth() + delta);
  else if (state.taskPeriod === 'year') d.setFullYear(d.getFullYear() + delta);
  renderTasks();
}

function taskCardHTML(t) {
  const isShopping = (t.template === 'courses') && Array.isArray(t.articles) && t.articles.length;
  return `
    <div class="task-item ${t.prio} ${t.done?'done':''} animate-fade">
      <div class="task-check ${t.done?'checked':''}" onclick="toggleTask('${t.id}')"><span style="color:white;font-size:12px">${t.done?'✓':''}</span></div>
      <div class="task-content" onclick="${isShopping ? `openShoppingMode('${t.id}')` : `editTask('${t.id}')`}" style="cursor:pointer">
        <div class="task-title">${escapeHtml(t.title)}</div>
        <div class="task-meta">
          ${t.prio==='urgent'?'<span style="color:var(--urgent)">🔴 Urgent</span>':(t.prio==='important'?'<span style="color:var(--invest)">🟠 Important</span>':'')}
          ${t.due ? '<span>📅 ' + formatDate(t.due) + '</span>' : ''}
          ${t.template && t.template !== 'standard' ? '<span>🏷️ ' + t.template + '</span>' : ''}
          ${isShopping ? `<span>${t.articles.filter(a=>a.bought).length}/${t.articles.length} articles</span>` : ''}
          ${t.project_id ? '<span style="color:var(--perso)">📁 ' + escapeHtml(state.projects.find(p=>p.id===t.project_id)?.title || '') + '</span>' : ''}
        </div>
      </div>
      <div class="task-actions">
        ${isShopping ? `<button class="btn btn-sm btn-ghost" onclick="event.stopPropagation();openShoppingMode('${t.id}')">🛒</button>` : ''}
        <button class="btn btn-sm btn-ghost" onclick="event.stopPropagation();editTask('${t.id}')">✏️</button>
        <button class="btn btn-sm btn-ghost" onclick="event.stopPropagation();deleteTask('${t.id}')">🗑️</button>
      </div>
    </div>`;
}

function renderTasks() {
  renderQuickSuggestions('quickSuggestTasks');
  const filter = document.getElementById('taskFilter').value;
  const tmpl = document.getElementById('taskTemplateFilter').value;
  const today = new Date().toISOString().split('T')[0];
  let list = state.tasks;
  if (filter === 'active') list = list.filter(t => !t.done);
  else if (filter === 'today') list = list.filter(t => !t.done && (t.due === today || t.prio === 'urgent'));
  else if (filter === 'done') list = list.filter(t => t.done);
  if (tmpl) list = list.filter(t => (t.template || 'standard') === tmpl);

  if (state.taskPeriod !== 'all') {
    document.getElementById('taskPeriodLabel').textContent = periodLabel(state.taskPeriod, state.taskPeriodDate);
    const [s,e] = periodRange(state.taskPeriod, state.taskPeriodDate);
    list = list.filter(t => { if (!t.due) return false; const d = new Date(t.due); return d >= s && d < e; });
  }

  list = list.sort((a,b) => {
    const prioOrder = { urgent:0, important:1, normal:2, someday:3 };
    return (prioOrder[a.prio]||2) - (prioOrder[b.prio]||2) || (a.due||'9999').localeCompare(b.due||'9999');
  });

  // Regroupement par jour pour la vue Semaine (plus lisible)
  if (state.taskPeriod === 'week') {
    const [s] = periodRange('week', state.taskPeriodDate);
    let html = '';
    for (let i=0; i<7; i++) {
      const d = new Date(s); d.setDate(d.getDate()+i);
      const dateStr = d.toISOString().split('T')[0];
      const dayTasks = list.filter(t => t.due === dateStr);
      if (!dayTasks.length) continue;
      html += `<h4 style="color:var(--accent-sand);margin:16px 0 8px;text-transform:capitalize">${d.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'short'})}</h4>`;
      html += dayTasks.map(taskCardHTML).join('');
    }
    document.getElementById('tasksContainer').innerHTML = html || '<div class="empty-state"><p>Aucune tâche cette semaine</p></div>';
    return;
  }

  document.getElementById('tasksContainer').innerHTML = list.map(taskCardHTML).join('') || '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg><p>Aucune tâche</p></div>';
}

function updateTaskFields() {
  const tmpl = document.getElementById('taskTemplate').value;
  let extra = '';
  if (tmpl === 'appel') extra = '<div class="form-group"><label>Numéro à appeler</label><input type="tel" id="taskNumero"></div><div class="form-group"><label>Objet de l\'appel</label><input type="text" id="taskObjet"></div>';
  if (tmpl === 'rdv') extra = '<div class="form-group"><label>Organisme / Contact</label><input type="text" id="taskContact"></div><div class="form-group"><label>Lien de réservation</label><input type="url" id="taskLien"></div>';
  if (tmpl === 'sport') extra = '<div class="grid-2"><div class="form-group"><label>Type d\'activité</label><input type="text" id="taskSportType"></div><div class="form-group"><label>Durée cible</label><input type="text" id="taskDuree"></div></div>';
  if (tmpl === 'doc') extra = '<div class="form-group"><label>Type de document</label><input type="text" id="taskObjet"></div><div class="form-group"><label>Organisme concerné</label><input type="text" id="taskContact"></div>';
  document.getElementById('taskExtraFields').innerHTML = extra;
  document.getElementById('taskArticlesGroup').style.display = tmpl === 'courses' ? 'block' : 'none';
  if (tmpl === 'courses') renderArticlesEditor([]);
}

// ==================== MODE COURSES (inspiré de Bring!) ====================
// Reconnaissance automatique du rayon + émoji à partir du nom de l'article
const AISLES = [
  { name: 'Fruits & Légumes', emoji: '🥦', keywords: ['pomme','poire','banane','orange','citron','salade','laitue','tomate','carotte','patate','pomme de terre','oignon','ail','courgette','poivron','concombre','avocat','fraise','raisin','ananas','mangue','brocoli','champignon','epinard','poireau','legume','fruit'] },
  { name: 'Boulangerie', emoji: '🥖', keywords: ['pain','baguette','croissant','brioche','biscotte','viennoiserie'] },
  { name: 'Produits laitiers & Œufs', emoji: '🥛', keywords: ['lait','yaourt','yoghourt','fromage','beurre','creme fraiche','crème fraîche','oeuf','œuf'] },
  { name: 'Viande & Poisson', emoji: '🍗', keywords: ['poulet','boeuf','bœuf','porc','jambon','saucisse','steak','poisson','saumon','thon','crevette','dinde','agneau','lardons','merguez','viande'] },
  { name: 'Épicerie salée', emoji: '🍝', keywords: ['pates','pâtes','riz','farine','huile','sel','poivre','sauce','conserve','lentille','haricot','pois chiche','soupe','bouillon','moutarde'] },
  { name: 'Épicerie sucrée', emoji: '🍫', keywords: ['sucre','chocolat','gateau','gâteau','biscuit','confiture','miel','cereales','céréales','bonbon','pate a tartiner'] },
  { name: 'Boissons', emoji: '🥤', keywords: ['eau','jus','soda','cafe','café','the','thé','vin','biere','bière'] },
  { name: 'Surgelés', emoji: '🧊', keywords: ['surgele','surgelé','glace','frites'] },
  { name: 'Hygiène & Entretien', emoji: '🧻', keywords: ['savon','shampoing','dentifrice','papier toilette','lessive','eponge','éponge','vaisselle','deodorant','déodorant'] },
  { name: 'Bébé', emoji: '🍼', keywords: ['couche','lait infantile','petit pot'] }
];
function getArticleMeta(name) {
  const n = (name||'').toLowerCase();
  for (const aisle of AISLES) {
    if (aisle.keywords.some(k => n.includes(k))) return aisle;
  }
  return { name: 'Autre', emoji: '🛒' };
}

// Base de produits façon Bring! : suggestions avec variantes courantes
const PRODUCT_DB = [
  'Œufs', 'Œufs (pack de 6)', 'Œufs (pack de 12)',
  'Lait', 'Lait demi-écrémé 1L', 'Lait entier 1L', 'Lait sans lactose',
  'Pain', 'Baguette', 'Pain de mie', 'Pain complet', 'Croissants (x4)',
  'Beurre', 'Beurre doux', 'Beurre demi-sel', 'Crème fraîche',
  'Yaourts nature (x8)', 'Yaourts aux fruits (x8)', 'Fromage râpé', 'Fromage blanc',
  'Pommes', 'Bananes', 'Oranges', 'Citrons', 'Fraises', 'Raisin',
  'Tomates', 'Salade', 'Carottes', 'Pommes de terre', 'Oignons', 'Ail', 'Courgettes', 'Poivrons', 'Concombre', 'Avocat',
  'Poulet (filets)', 'Bœuf haché', 'Steaks hachés (x4)', 'Jambon blanc', 'Saucisses', 'Lardons', 'Saumon fumé', 'Thon en boîte',
  'Pâtes', 'Riz', 'Farine', 'Huile d\'olive', 'Sel', 'Poivre', 'Sauce tomate', 'Lentilles', 'Haricots verts en conserve',
  'Sucre', 'Chocolat', 'Biscuits', 'Confiture', 'Miel', 'Céréales', 'Pâte à tartiner',
  'Eau (pack de 6)', 'Jus d\'orange', 'Café', 'Thé', 'Vin rouge', 'Bière (pack de 6)',
  'Glace', 'Frites surgelées', 'Légumes surgelés',
  'Papier toilette (pack)', 'Liquide vaisselle', 'Lessive', 'Éponges', 'Savon', 'Shampoing', 'Dentifrice',
  'Couches bébé'
];
function populateShoppingSuggestions() {
  const dl = document.getElementById('shoppingProductSuggestions');
  if (dl) dl.innerHTML = PRODUCT_DB.map(p => `<option value="${escapeHtml(p)}"></option>`).join('');
}

let shoppingModeTaskId = null;
function openShoppingMode(taskId) {
  shoppingModeTaskId = taskId;
  const t = state.tasks.find(x=>x.id===taskId); if (!t) return;
  document.getElementById('shoppingModeTitle').textContent = '🛒 ' + t.title;
  renderShoppingModeList();
  openModal('shoppingModeModal');
}

function renderShoppingModeList() {
  const t = state.tasks.find(x=>x.id===shoppingModeTaskId); if (!t) return;
  const articles = t.articles || [];
  // Regrouper par rayon, articles non achetés d'abord dans chaque rayon
  const byAisle = {};
  articles.forEach((a,i) => {
    const meta = getArticleMeta(a.name);
    if (!byAisle[meta.name]) byAisle[meta.name] = { emoji: meta.emoji, items: [] };
    byAisle[meta.name].items.push({ ...a, _index: i });
  });
  let html = '';
  Object.keys(byAisle).sort((a,b) => {
    const notBoughtA = byAisle[a].items.some(i=>!i.bought);
    const notBoughtB = byAisle[b].items.some(i=>!i.bought);
    return (notBoughtB?1:0) - (notBoughtA?1:0);
  }).forEach(aisleName => {
    const group = byAisle[aisleName];
    group.items.sort((a,b) => (a.bought?1:0) - (b.bought?1:0));
    html += `<div class="shop-aisle-header">${group.emoji} ${aisleName}</div>`;
    group.items.forEach(a => {
      html += `
        <div class="shop-row ${a.bought?'bought':''}" onclick="toggleShoppingArticle(${a._index})">
          <div class="shop-check-circle">${a.bought ? '<span style="color:white;font-size:13px">✓</span>' : ''}</div>
          <div class="shop-row-name">${escapeHtml(a.name)}</div>
          ${a.qty && a.qty !== 1 ? `<div class="shop-row-qty">×${a.qty}</div>` : ''}
          ${a.price ? `<div class="shop-row-price">${fmtMoney(a.price)}</div>` : ''}
          <button type="button" class="btn btn-sm btn-ghost" onclick="event.stopPropagation();removeShoppingArticle(${a._index})">×</button>
        </div>`;
    });
  });
  document.getElementById('shoppingModeList').innerHTML = html || '<div class="empty-state" style="padding:20px">Liste vide — ajoute un article ci-dessus</div>';

  const total = articles.reduce((s,a) => s + (parseFloat(a.price)||0), 0);
  const boughtCount = articles.filter(a=>a.bought).length;
  document.getElementById('shoppingModeTotal').textContent = `${boughtCount}/${articles.length} · ${fmtMoney(total)} estimé`;
}

async function persistShoppingArticles(articles) {
  await sbUpdate('tasks', shoppingModeTaskId, { articles });
  const t = state.tasks.find(x=>x.id===shoppingModeTaskId);
  if (t) t.articles = articles; // maj optimiste locale, évite un rechargement complet à chaque coche
}

function toggleShoppingArticle(index) {
  const t = state.tasks.find(x=>x.id===shoppingModeTaskId); if (!t) return;
  const articles = [...t.articles];
  articles[index] = { ...articles[index], bought: !articles[index].bought };
  persistShoppingArticles(articles);
  renderShoppingModeList();
}

function removeShoppingArticle(index) {
  const t = state.tasks.find(x=>x.id===shoppingModeTaskId); if (!t) return;
  const articles = t.articles.filter((_,i) => i !== index);
  persistShoppingArticles(articles);
  renderShoppingModeList();
}

function addShoppingArticleQuick(e) {
  e.preventDefault();
  const input = document.getElementById('shoppingQuickInput');
  const name = input.value.trim();
  if (!name) return;
  const t = state.tasks.find(x=>x.id===shoppingModeTaskId); if (!t) return;
  const articles = [...(t.articles||[]), { name, qty: 1, price: recallPrice(name) || '', bought: false }];
  persistShoppingArticles(articles);
  input.value = '';
  renderShoppingModeList();
}

function renderArticlesEditor(articles) {
  const container = document.getElementById('taskArticlesList');
  container.innerHTML = (articles || []).map((a,i) => `
    <div class="checklist-item">
      <input type="checkbox" ${a.bought?'checked':''} onchange="updateArticle(${i},'bought',this.checked)">
      <input type="text" value="${escapeHtml(a.name||'')}" placeholder="Article" style="flex:1" list="shoppingProductSuggestions" onchange="updateArticle(${i},'name',this.value)">
      <input type="number" value="${a.qty||1}" placeholder="Qté" style="width:60px" onchange="updateArticle(${i},'qty',this.value)">
      <input type="number" value="${a.price||''}" placeholder="Prix €" style="width:80px" step="0.01" onchange="updateArticle(${i},'price',this.value)">
      <button type="button" class="btn btn-sm btn-ghost" onclick="removeArticle(${i})">×</button>
    </div>
  `).join('');
}

let currentArticles = [];
function addArticleRow() { currentArticles.push({ name:'', qty:1, price:'', bought:false }); renderArticlesEditor(currentArticles); }
function priceMemoryKey() { return 'cbu_pricebook_' + (state.user?.id || 'anon'); }
function getPriceMemory() { try { return JSON.parse(localStorage.getItem(priceMemoryKey()) || '{}'); } catch { return {}; } }
function rememberPrice(name, price) {
  if (!name || !price) return;
  const mem = getPriceMemory();
  mem[name.trim().toLowerCase()] = parseFloat(price);
  localStorage.setItem(priceMemoryKey(), JSON.stringify(mem));
}
function recallPrice(name) {
  const mem = getPriceMemory();
  return mem[(name||'').trim().toLowerCase()] ?? '';
}

function updateArticle(i, k, v) {
  currentArticles[i][k] = v;
  if (k === 'price') rememberPrice(currentArticles[i].name, v);
  if (k === 'name' && !currentArticles[i].price) {
    const p = recallPrice(v);
    if (p) { currentArticles[i].price = p; renderArticlesEditor(currentArticles); }
  }
}
function removeArticle(i) { currentArticles.splice(i,1); renderArticlesEditor(currentArticles); }

function renderQuickSuggestions(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const suggestions = [
    { emoji:'🏢', label:'Travail', template:'standard' },
    { emoji:'📞', label:'Appel', template:'appel' },
    { emoji:'🛒', label:'Courses', template:'courses' },
    { emoji:'🏋️', label:'Sport', template:'sport' },
    { emoji:'📄', label:'Démarche admin', template:'doc' },
    { emoji:'📅', label:'RDV à prendre', template:'rdv' }
  ];
  el.innerHTML = suggestions.map(s => `<button type="button" class="quick-suggest-chip" onclick="openTaskModal('${s.template}','${s.label}')">${s.emoji} ${s.label}</button>`).join('');
}

async function quickAddTask(e) {
  e.preventDefault();
  const input = e.target.querySelector('input');
  const title = input.value.trim();
  if (!title) return;
  await sbInsert('tasks', { user_id: state.user.id, title, prio: 'normal', template: 'standard', notes: '' });
  input.value = '';
  toast('Ajouté ✓', 'success');
  await loadAllData(); renderCurrentView();
}

async function saveTask(e) {
  e.preventDefault();
  const tmpl = document.getElementById('taskTemplate').value;
  const obj = {
    user_id: state.user.id,
    title: document.getElementById('taskTitle').value,
    prio: document.getElementById('taskPrio').value,
    due: document.getElementById('taskDue').value || null,
    template: tmpl,
    project_id: document.getElementById('taskProject').value || null,
    notes: document.getElementById('taskNotes').value,
    numero: document.getElementById('taskNumero')?.value || null,
    objet: document.getElementById('taskObjet')?.value || null,
    contact: document.getElementById('taskContact')?.value || null,
    lieu: document.getElementById('taskLien')?.value || null,
    sport_type: document.getElementById('taskSportType')?.value || null,
    duree: document.getElementById('taskDuree')?.value || null,
    reminder: document.getElementById('taskReminder').value || null,
    articles: tmpl === 'courses' ? currentArticles : null
  };
  if (state.editingType === 'task') {
    await sbUpdate('tasks', state.editingId, obj);
    toast('Tâche mise à jour', 'success');
  } else {
    await sbInsert('tasks', obj);
    toast('Tâche créée', 'success');
  }
  closeModal('taskModal'); await loadAllData(); renderCurrentView();
}

function editTask(id) {
  const t = state.tasks.find(x=>x.id===id); if (!t) return;
  state.editingId = id; state.editingType = 'task';
  document.getElementById('taskTitle').value = t.title;
  document.getElementById('taskPrio').value = t.prio || 'normal';
  document.getElementById('taskDue').value = t.due || '';
  document.getElementById('taskTemplate').value = t.template || 'standard';
  document.getElementById('taskProject').value = t.project_id || '';
  document.getElementById('taskNotes').value = t.notes || '';
  document.getElementById('taskReminder').value = t.reminder || '';
  updateTaskFields();
  if (document.getElementById('taskNumero')) document.getElementById('taskNumero').value = t.numero || '';
  if (document.getElementById('taskObjet')) document.getElementById('taskObjet').value = t.objet || '';
  if (document.getElementById('taskContact')) document.getElementById('taskContact').value = t.contact || '';
  if (document.getElementById('taskLien')) document.getElementById('taskLien').value = t.lieu || '';
  if (document.getElementById('taskSportType')) document.getElementById('taskSportType').value = t.sport_type || '';
  if (document.getElementById('taskDuree')) document.getElementById('taskDuree').value = t.duree || '';
  if (t.template === 'courses' && t.articles) { currentArticles = JSON.parse(JSON.stringify(t.articles)); renderArticlesEditor(currentArticles); }
  populateTitleSuggestions('taskTitleSuggestions', state.tasks);
  openModal('taskModal');
}

async function toggleTask(id) {
  const t = state.tasks.find(x=>x.id===id);
  if (!t) return;
  await sbUpdate('tasks', id, { done: !t.done });
  await loadAllData(); renderCurrentView();
}

async function deleteTask(id) {
  if (!confirm('Supprimer cette tâche ?')) return;
  await sbDelete('tasks', id);
  await loadAllData(); renderCurrentView();
  toast('Tâche supprimée', 'info');
}

// ==================== RECETTES ====================
let currentRecipeIngredients = [];
function openRecipeModal() {
  state.editingType = null; state.editingId = null;
  document.getElementById('recipeModal').querySelector('form').reset();
  currentRecipeIngredients = [{ name:'', qty:'', unit:'' }];
  renderRecipeIngredientsEditor();
  openModal('recipeModal');
}
function renderRecipeIngredientsEditor() {
  document.getElementById('recipeIngredientsList').innerHTML = currentRecipeIngredients.map((ing,i) => `
    <div class="checklist-item">
      <input type="text" value="${escapeHtml(ing.name||'')}" placeholder="Ingrédient" style="flex:2" onchange="updateRecipeIngredient(${i},'name',this.value)">
      <input type="number" value="${ing.qty||''}" placeholder="Qté" style="width:60px" step="0.01" onchange="updateRecipeIngredient(${i},'qty',this.value)">
      <input type="text" value="${escapeHtml(ing.unit||'')}" placeholder="Unité" style="width:70px" onchange="updateRecipeIngredient(${i},'unit',this.value)">
      <button type="button" class="btn btn-sm btn-ghost" onclick="removeRecipeIngredient(${i})">×</button>
    </div>
  `).join('');
}
function addRecipeIngredientRow() { currentRecipeIngredients.push({ name:'', qty:'', unit:'' }); renderRecipeIngredientsEditor(); }
function updateRecipeIngredient(i,k,v) { currentRecipeIngredients[i][k] = v; }
function removeRecipeIngredient(i) { currentRecipeIngredients.splice(i,1); renderRecipeIngredientsEditor(); }

async function saveRecipe(e) {
  e.preventDefault();
  const obj = {
    user_id: state.user.id,
    name: document.getElementById('recipeName').value,
    ingredients: currentRecipeIngredients.filter(i => i.name && i.name.trim())
  };
  if (state.editingType === 'recipe') { await sbUpdate('recipes', state.editingId, obj); toast('Recette mise à jour', 'success'); }
  else { await sbInsert('recipes', obj); toast('Recette enregistrée', 'success'); }
  closeModal('recipeModal'); await loadAllData(); renderCurrentView();
}
function editRecipe(id) {
  const r = state.recipes.find(x=>x.id===id); if (!r) return;
  state.editingId = id; state.editingType = 'recipe';
  document.getElementById('recipeName').value = r.name;
  currentRecipeIngredients = JSON.parse(JSON.stringify(r.ingredients || [{name:'',qty:'',unit:''}]));
  renderRecipeIngredientsEditor();
  openModal('recipeModal');
}
async function deleteRecipe(id) {
  if (!confirm('Supprimer cette recette ?')) return;
  await sbDelete('recipes', id);
  await loadAllData(); renderCurrentView();
  toast('Recette supprimée', 'info');
}
function renderRecipesContainer() {
  document.getElementById('recipesContainer').innerHTML = state.recipes.map(r => `
    <div class="card animate-fade">
      <div style="font-weight:600;margin-bottom:8px">🍽️ ${escapeHtml(r.name)}</div>
      <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:12px">${(r.ingredients||[]).map(i=>escapeHtml(i.name)).join(', ') || 'Aucun ingrédient'}</div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm" onclick="editRecipe('${r.id}')">Modifier</button>
        <button class="btn btn-sm btn-ghost" onclick="deleteRecipe('${r.id}')">Supprimer</button>
      </div>
    </div>
  `).join('') || '<div class="empty-state" style="grid-column:1/-1"><p>Aucune recette pour l\'instant</p><button class="btn btn-primary mt-4" onclick="openRecipeModal()">+ Créer ta première recette</button></div>';
}

// ==================== MENUS (planificateur hebdomadaire) ====================
function getMondayOf(d) { const x = new Date(d); const day = (x.getDay()+6)%7; x.setDate(x.getDate()-day); x.setHours(0,0,0,0); return x; }
function changeMenuWeek(delta) {
  state.menuWeekDate.setDate(state.menuWeekDate.getDate() + delta*7);
  renderMenus();
}
function renderMenus() {
  const monday = getMondayOf(state.menuWeekDate);
  const days = [...Array(7)].map((_,i) => { const d = new Date(monday); d.setDate(d.getDate()+i); return d; });
  const sunday = days[6];
  document.getElementById('menuWeekLabel').textContent = monday.toLocaleDateString('fr-FR',{day:'numeric',month:'short'}) + ' – ' + sunday.toLocaleDateString('fr-FR',{day:'numeric',month:'short'});

  const dayLabels = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
  let html = '<div></div>' + days.map((d,i) => `<div class="menu-grid-header">${dayLabels[i]}<br><span style="font-weight:400;text-transform:none">${d.getDate()}</span></div>`).join('');
  ['dejeuner','diner'].forEach(slot => {
    html += `<div class="menu-slot-label">${slot==='dejeuner'?'☀️ Déj.':'🌙 Dîner'}</div>`;
    days.forEach(d => {
      const dateStr = d.toISOString().split('T')[0];
      const meal = state.menus.find(m => m.date === dateStr && m.slot === slot);
      const label = meal ? (meal.recipe_id ? (state.recipes.find(r=>r.id===meal.recipe_id)?.name || '?') : meal.free_text) : '+';
      html += `<div class="menu-cell ${meal?'filled':'empty'}" onclick="openMealPick('${dateStr}','${slot}')">${escapeHtml(label)}</div>`;
    });
  });
  document.getElementById('menuGrid').innerHTML = html;
}

let mealPickTarget = null;
function openMealPick(dateStr, slot) {
  mealPickTarget = { dateStr, slot };
  document.getElementById('mealPickTitle').textContent = new Date(dateStr).toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'}) + ' — ' + (slot==='dejeuner'?'Déjeuner':'Dîner');
  document.getElementById('mealPickFreeText').value = '';
  document.getElementById('mealPickList').innerHTML = state.recipes.map(r => `
    <button type="button" class="btn w-full" style="justify-content:flex-start" onclick="assignMeal('${r.id}')">🍽️ ${escapeHtml(r.name)}</button>
  `).join('') || '<p style="color:var(--text-muted);font-size:0.9rem">Aucune recette — crée-en une depuis "Mes recettes", ou tape un texte libre ci-dessous.</p>';
  openModal('mealPickModal');
}
async function assignMeal(recipeId) {
  const { dateStr, slot } = mealPickTarget;
  const existing = state.menus.find(m => m.date === dateStr && m.slot === slot);
  const obj = { user_id: state.user.id, date: dateStr, slot, recipe_id: recipeId, free_text: null };
  if (existing) await sbUpdate('menus', existing.id, obj); else await sbInsert('menus', obj);
  closeModal('mealPickModal'); await loadAllData(); renderCurrentView();
}
async function confirmFreeTextMeal() {
  const text = document.getElementById('mealPickFreeText').value.trim();
  if (!text) return;
  const { dateStr, slot } = mealPickTarget;
  const existing = state.menus.find(m => m.date === dateStr && m.slot === slot);
  const obj = { user_id: state.user.id, date: dateStr, slot, recipe_id: null, free_text: text };
  if (existing) await sbUpdate('menus', existing.id, obj); else await sbInsert('menus', obj);
  closeModal('mealPickModal'); await loadAllData(); renderCurrentView();
}
async function clearMealSlot() {
  const { dateStr, slot } = mealPickTarget;
  const existing = state.menus.find(m => m.date === dateStr && m.slot === slot);
  if (existing) await sbDelete('menus', existing.id);
  closeModal('mealPickModal'); await loadAllData(); renderCurrentView();
}

async function generateShoppingList() {
  const monday = getMondayOf(state.menuWeekDate);
  const days = [...Array(7)].map((_,i) => { const d = new Date(monday); d.setDate(d.getDate()+i); return d.toISOString().split('T')[0]; });
  const weekMenus = state.menus.filter(m => days.includes(m.date) && m.recipe_id);
  if (!weekMenus.length) { toast('Aucune recette assignée cette semaine — remplis le planning d\'abord.', 'error'); return; }

  const consolidated = {};
  weekMenus.forEach(m => {
    const recipe = state.recipes.find(r => r.id === m.recipe_id);
    if (!recipe) return;
    (recipe.ingredients || []).forEach(ing => {
      const key = (ing.name||'').trim().toLowerCase() + '|' + (ing.unit||'');
      if (!consolidated[key]) consolidated[key] = { name: ing.name, unit: ing.unit || '', qty: 0 };
      consolidated[key].qty += parseFloat(ing.qty) || 0;
    });
  });
  const articles = Object.values(consolidated).map(a => ({
    name: a.unit ? `${a.name} (${a.qty} ${a.unit})` : a.name,
    qty: 1, bought: false, price: recallPrice(a.name) || ''
  }));
  const estimatedTotal = articles.reduce((s,a) => s + (parseFloat(a.price)||0), 0);

  const { data } = await sbInsert('tasks', {
    user_id: state.user.id,
    title: 'Courses de la semaine',
    prio: 'normal',
    template: 'courses',
    notes: estimatedTotal > 0 ? `Budget estimé (sur la base de tes prix habituels) : ${fmtMoney(estimatedTotal)}` : '',
    articles
  });
  toast('Liste de courses générée ✓', 'success');
  await loadAllData();
  navigateTo('tasks');
  const newTask = data?.[0];
  if (newTask) openShoppingMode(newTask.id);
}

// ==================== PROJETS ====================
function updateProjectPhases() {
  const cat = document.getElementById('projCat').value;
  const sel = document.getElementById('projPhase');
  sel.innerHTML = PHASES[cat].map(p => `<option value="${p}">${p}</option>`).join('');
}

const PROJECT_CAT_META = {
  perso: { label: 'Perso', color: 'var(--perso)', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/></svg>' },
  collaboratif: { label: 'Collaboratif', color: 'var(--collab)', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' },
  investissement: { label: 'Investissement', color: 'var(--invest)', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>' }
};
state.projectCurrentCat = null;

function renderProjects() {
  if (state.projectCurrentCat) { renderProjectsList(); return; }
  showProjectCategories();
}

function showProjectCategories() {
  state.projectCurrentCat = null;
  document.getElementById('projectsPageTitle').textContent = 'Projets';
  document.getElementById('projectsBackBtn').classList.add('hidden');
  document.getElementById('projectsContainer').classList.add('hidden');
  document.getElementById('projectCategoriesContainer').classList.remove('hidden');

  document.getElementById('projectCategoriesContainer').innerHTML = Object.keys(PROJECT_CAT_META).map(cat => {
    const meta = PROJECT_CAT_META[cat];
    const items = state.projects.filter(p => p.cat === cat);
    const activeCount = items.filter(p => !['Terminé','Abandonné','Acquis'].includes(p.phase)).length;
    return `
      <div class="cat-panel animate-fade" onclick="openProjectCategory('${cat}')">
        <div class="cat-panel-icon" style="color:${meta.color};border-color:${meta.color}">${meta.icon}</div>
        <div class="cat-panel-body">
          <div class="cat-panel-title">${meta.label}</div>
          <div class="cat-panel-meta">${items.length} projet${items.length>1?'s':''}${activeCount ? ' · '+activeCount+' actif'+(activeCount>1?'s':'') : ''}</div>
        </div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-muted);flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>
      </div>`;
  }).join('');
}

function openProjectCategory(cat) {
  state.projectCurrentCat = cat;
  renderProjectsList();
}

function renderProjectsList() {
  const cat = state.projectCurrentCat;
  const meta = PROJECT_CAT_META[cat];
  document.getElementById('projectsPageTitle').innerHTML = `<span style="color:${meta.color};vertical-align:middle;margin-right:8px">${meta.icon}</span>${meta.label}`;
  document.getElementById('projectsBackBtn').classList.remove('hidden');
  document.getElementById('projectCategoriesContainer').classList.add('hidden');
  document.getElementById('projectsContainer').classList.remove('hidden');

  const list = state.projects.filter(p => p.cat === cat);
  document.getElementById('projectsContainer').innerHTML = list.map(p => {
    const progress = p.budget_target > 0 ? Math.round((p.budget_saved / p.budget_target) * 100) : 0;
    return `
    <div class="project-card animate-fade" style="border-left:3px solid ${meta.color}">
      <div class="project-header">
        <div>
          <div class="project-title">${escapeHtml(p.title)}</div>
          <span class="badge badge-${p.cat}">${p.cat}</span>
        </div>
        <span class="project-phase">${p.phase}</span>
      </div>
      <div class="project-next">→ ${escapeHtml(p.next || 'Aucune action définie')}</div>
      ${p.budget_target > 0 ? `
        <div style="display:flex;justify-content:space-between;font-size:0.8rem;color:var(--text-muted);margin-bottom:4px">
          <span>${p.budget_saved||0} € / ${p.budget_target} €</span>
          <span>${progress}%</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
      ` : ''}
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-sm" onclick="editProject('${p.id}')">Modifier</button>
        <button class="btn btn-sm btn-ghost" onclick="deleteProject('${p.id}')">Supprimer</button>
      </div>
    </div>
  `}).join('') || `<div class="empty-state" style="grid-column:1/-1"><p>Aucun projet ${meta.label.toLowerCase()} pour l'instant</p><button class="btn btn-primary mt-4" onclick="openProjectModal()">+ Créer un projet ${meta.label.toLowerCase()}</button></div>`;
}

async function saveProject(e) {
  e.preventDefault();
  const obj = {
    owner_id: state.user.id,
    title: document.getElementById('projTitle').value,
    cat: document.getElementById('projCat').value,
    phase: document.getElementById('projPhase').value,
    start: document.getElementById('projStart').value || null,
    end: document.getElementById('projEnd').value || null,
    next: document.getElementById('projNext').value,
    notes: document.getElementById('projNotes').value,
    budget_target: parseFloat(document.getElementById('projBudgetTarget').value) || 0,
    budget_saved: parseFloat(document.getElementById('projBudgetSaved').value) || 0
  };
  if (state.editingType === 'project') {
    await sbUpdate('projects', state.editingId, obj);
    toast('Projet mis à jour', 'success');
  } else {
    await sbInsert('projects', obj);
    toast('Projet créé', 'success');
  }
  closeModal('projectModal'); await loadAllData(); renderCurrentView();
}

function editProject(id) {
  const p = state.projects.find(x=>x.id===id); if (!p) return;
  state.editingId = id; state.editingType = 'project';
  document.getElementById('projTitle').value = p.title;
  document.getElementById('projCat').value = p.cat;
  updateProjectPhases();
  document.getElementById('projPhase').value = p.phase;
  document.getElementById('projStart').value = p.start || '';
  document.getElementById('projEnd').value = p.end || '';
  document.getElementById('projNext').value = p.next || '';
  document.getElementById('projNotes').value = p.notes || '';
  document.getElementById('projBudgetTarget').value = p.budget_target || '';
  document.getElementById('projBudgetSaved').value = p.budget_saved || '';
  openModal('projectModal');
}

async function deleteProject(id) {
  if (!confirm('Supprimer ce projet et toutes ses données ?')) return;
  await sbDelete('projects', id);
  await loadAllData(); renderCurrentView();
  toast('Projet supprimé', 'info');
}

// ==================== WALLET ====================
const ASSET_TYPE_LABELS = {
  liquidites: { label: 'Liquidités', icon: '💶' },
  bourse: { label: 'Bourse / ETF', icon: '📈' },
  crypto: { label: 'Crypto', icon: '🪙' },
  immobilier: { label: 'Immobilier locatif', icon: '🏠' },
  credit: { label: 'Crédit', icon: '🏦' },
  physique: { label: 'Projet physique', icon: '🛠️' },
  autre: { label: 'Autre', icon: '📦' }
};

function assetLineValue(a) {
  const qty = parseFloat(a.quantity || 1);
  const val = parseFloat(a.value_current || a.value || 0);
  return val * qty;
}

function renderWallet() {
  const assets = state.wallet.filter(a => a.type !== 'credit');
  const debts = state.wallet.filter(a => a.type === 'credit');
  const totalAssets = assets.reduce((s,a) => s + assetLineValue(a), 0);
  const totalDebts = debts.reduce((s,a) => s + (parseFloat(a.capital_remaining || a.value || 0)), 0);
  const netWorth = totalAssets - totalDebts;
  const totalInvested = assets.reduce((s,a) => s + (parseFloat(a.price_buy || 0) * parseFloat(a.quantity || 1)), 0);
  const pnl = totalAssets - totalInvested;
  const globalReturnPct = totalInvested > 0 ? (pnl / totalInvested * 100) : null;
  const totalMonthlyDebt = debts.reduce((s,a) => s + (parseFloat(a.monthly) || 0), 0);
  const totalMonthlyRent = state.wallet.filter(a=>a.type==='immobilier').reduce((s,a) => s + (parseFloat(a.rent)||0), 0);

  document.getElementById('walletSummary').innerHTML = `
    <div class="wallet-card"><div class="wallet-value">${fmtMoney(totalAssets)}</div><div class="wallet-label">Patrimoine brut</div></div>
    <div class="wallet-card"><div class="wallet-value">${fmtMoney(totalDebts)}</div><div class="wallet-label">Dettes</div></div>
    <div class="wallet-card"><div class="wallet-value">${fmtMoney(netWorth)}</div><div class="wallet-label">Patrimoine net</div></div>
    <div class="wallet-card"><div class="wallet-value" style="color:${pnl>=0?'var(--ok)':'var(--urgent)'}">${pnl>=0?'+':''}${fmtMoney(pnl)}</div><div class="wallet-label">+/- Value</div></div>
    <div class="wallet-card"><div class="wallet-value" style="color:${globalReturnPct===null?'var(--text-muted)':(globalReturnPct>=0?'var(--ok)':'var(--urgent)')}">${globalReturnPct===null?'—':(globalReturnPct>=0?'+':'')+globalReturnPct.toFixed(1)+'%'}</div><div class="wallet-label">Rendement global</div></div>
    <div class="wallet-card"><div class="wallet-value">${fmtMoney(totalMonthlyDebt)}</div><div class="wallet-label">Charges crédit / mois</div></div>
    ${totalMonthlyRent > 0 ? `<div class="wallet-card"><div class="wallet-value" style="color:var(--ok)">${fmtMoney(totalMonthlyRent)}</div><div class="wallet-label">Loyers perçus / mois</div></div>` : ''}
  `;

  // Regrouper par catégorie
  const byType = {};
  state.wallet.forEach(a => {
    const t = a.type || 'autre';
    if (!byType[t]) byType[t] = [];
    byType[t].push(a);
  });

  const typesOrder = Object.keys(ASSET_TYPE_LABELS);
  const cards = typesOrder.filter(t => byType[t] && byType[t].length).map(t => {
    const items = byType[t];
    const activeCount = items.filter(a => (a.status||'actif') !== 'termine').length;
    const doneCount = items.length - activeCount;
    const total = t === 'credit'
      ? items.reduce((s,a) => s + parseFloat(a.capital_remaining || a.value || 0), 0)
      : items.reduce((s,a) => s + assetLineValue(a), 0);
    const meta = ASSET_TYPE_LABELS[t];
    return `
      <div class="card animate-fade" style="cursor:pointer" onclick="openWalletCategory('${t}')">
        <div style="font-size:1.8rem;margin-bottom:6px">${meta.icon}</div>
        <div style="font-weight:600;margin-bottom:4px">${meta.label}</div>
        <div class="wallet-value" style="font-size:1.3rem">${fmtMoney(total)}</div>
        <div style="font-size:0.8rem;color:var(--text-muted);margin-top:6px">
          ${activeCount} actif${activeCount>1?'s':''}${doneCount ? ' · ' + doneCount + ' terminé'+(doneCount>1?'s':'') : ''}
        </div>
      </div>`;
  }).join('');

  document.getElementById('walletCategoriesContainer').innerHTML = cards || `
    <div class="empty-state" style="grid-column:1/-1">
      <p>Aucun actif pour le moment</p>
      <button class="btn btn-primary mt-4" onclick="openAssetModal()">+ Ajouter ton premier actif</button>
    </div>`;
  renderWalletTable();
}

function renderWalletTable() {
  const rows = state.wallet.filter(a => (a.status||'actif') === 'actif').map(a => {
    const qty = parseFloat(a.quantity || 1);
    const buy = parseFloat(a.price_buy || 0);
    const val = parseFloat(a.value_current || a.value || 0);
    const isCredit = a.type === 'credit';
    const displayValue = isCredit ? (a.capital_remaining || a.value || 0) : (val * qty);
    const returnPct = (!isCredit && buy > 0) ? ((val-buy)/buy*100) : null;
    return { a, displayValue, returnPct };
  }).sort((x,y) => y.displayValue - x.displayValue);

  const rowsHtml = rows.map(({a, displayValue, returnPct}) => {
    const meta = ASSET_TYPE_LABELS[a.type] || {icon:'📦', label:a.type};
    const pctClass = returnPct === null ? 'pct-flat' : (returnPct >= 0 ? 'pct-up' : 'pct-down');
    const pctLabel = returnPct === null ? '—' : (returnPct>=0?'▲ +':'▼ ')+Math.abs(returnPct).toFixed(1)+'%';
    return `
      <tr onclick="editAsset('${a.id}')">
        <td>${meta.icon} <strong>${escapeHtml(a.name)}</strong>${a.platform ? '<br><span style="color:var(--text-muted);font-size:0.78rem">'+escapeHtml(a.platform)+'</span>' : ''}</td>
        <td>${meta.label}</td>
        <td class="mono">${fmtMoney(displayValue)}</td>
        <td><span class="pct-badge ${pctClass}">${pctLabel}</span></td>
      </tr>`;
  }).join('');

  document.getElementById('walletTable').innerHTML = `
    <thead><tr><th>Ligne</th><th>Type</th><th>Valeur</th><th>Performance</th></tr></thead>
    <tbody>${rowsHtml || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:32px">Aucune ligne active</td></tr>'}</tbody>
  `;
}

function openWalletCategory(type) {
  state.walletDetailType = type;
  state.walletDetailStatus = 'actif';
  document.getElementById('walletDetailTitle').textContent = (ASSET_TYPE_LABELS[type]?.icon||'') + ' ' + (ASSET_TYPE_LABELS[type]?.label || type);
  document.querySelectorAll('#walletDetailTabs .tab').forEach(t => t.classList.toggle('active', t.dataset.status === 'actif'));
  renderWalletDetailList();
  openModal('walletDetailModal');
}

function setWalletDetailStatus(status) {
  state.walletDetailStatus = status;
  document.querySelectorAll('#walletDetailTabs .tab').forEach(t => t.classList.toggle('active', t.dataset.status === status));
  renderWalletDetailList();
}

function durationSince(dateStr) {
  if (!dateStr) return '';
  const start = new Date(dateStr);
  const now = new Date();
  let months = (now.getFullYear()-start.getFullYear())*12 + (now.getMonth()-start.getMonth());
  if (months < 1) return 'ce mois-ci';
  if (months < 12) return `depuis ${months} mois`;
  const years = Math.floor(months/12); const rem = months%12;
  return `depuis ${years} an${years>1?'s':''}${rem?' et '+rem+' mois':''}`;
}

function renderWalletDetailList() {
  const type = state.walletDetailType;
  const items = state.wallet.filter(a => (a.type||'autre') === type && (a.status||'actif') === state.walletDetailStatus);
  document.getElementById('walletDetailList').innerHTML = items.map(a => {
    const qty = parseFloat(a.quantity || 1);
    const buy = parseFloat(a.price_buy || 0);
    const val = parseFloat(a.value_current || a.value || 0);
    const pnlItem = (val - buy) * qty;
    const returnPct = (buy > 0) ? ((val-buy)/buy*100) : null;
    const displayValue = type === 'credit' ? (a.capital_remaining || a.value || 0) : (val * qty);
    const rentalYield = (type === 'immobilier' && a.rent && val) ? (a.rent*12/val*100) : null;
    return `
    <div class="task-item animate-fade" style="cursor:pointer" onclick="editAsset('${a.id}')">
      <div class="task-content">
        <div class="task-title">${escapeHtml(a.name)}${a.platform ? ' <span style="color:var(--text-muted);font-weight:400">· '+escapeHtml(a.platform)+'</span>' : ''}</div>
        <div class="task-meta">
          <span>${fmtMoney(displayValue)}</span>
          ${qty && qty!==1 ? '<span>Qté ' + qty + '</span>' : ''}
          ${type !== 'credit' && returnPct !== null ? `<span style="color:${pnlItem>=0?'var(--ok)':'var(--urgent)'}">${pnlItem>=0?'+':''}${fmtMoney(pnlItem)} (${returnPct>=0?'+':''}${returnPct.toFixed(1)}%)</span>` : ''}
          ${type === 'credit' && a.monthly ? `<span>${fmtMoney(a.monthly)}/mois</span>` : ''}
          ${rentalYield !== null ? `<span style="color:var(--ok)">🏠 ${fmtMoney(a.rent)}/mois · rendement locatif ${rentalYield.toFixed(1)}%</span>` : ''}
          ${a.start_date ? `<span>${durationSince(a.start_date)}</span>` : ''}
        </div>
      </div>
      <div class="task-actions">
        <button class="btn btn-sm btn-ghost" onclick="event.stopPropagation();deleteAsset('${a.id}')">🗑️</button>
      </div>
    </div>`;
  }).join('') || `<div class="empty-state" style="padding:24px">Aucun élément ${state.walletDetailStatus === 'actif' ? 'actif' : 'terminé'} ici</div>`;
}

async function updateAssetFields() {
  const t = document.getElementById('assetType').value;
  document.getElementById('assetRentGroup').style.display = t === 'immobilier' ? 'block' : 'none';
}

async function saveAsset(e) {
  e.preventDefault();
  const obj = {
    user_id: state.user.id,
    type: document.getElementById('assetType').value,
    name: document.getElementById('assetName').value,
    value: parseFloat(document.getElementById('assetValue').value) || 0,
    quantity: parseFloat(document.getElementById('assetQty').value) || 1,
    price_buy: parseFloat(document.getElementById('assetPriceBuy').value) || 0,
    monthly: parseFloat(document.getElementById('assetMonthly').value) || 0,
    platform: document.getElementById('assetPlatform').value || null,
    start_date: document.getElementById('assetStartDate').value || null,
    rent: parseFloat(document.getElementById('assetRent').value) || 0,
    status: document.getElementById('assetStatus').value,
    notes: document.getElementById('assetNotes').value
  };
  if (state.editingType === 'asset') {
    await sbUpdate('wallet_assets', state.editingId, obj);
    toast('Actif mis à jour', 'success');
  } else {
    await sbInsert('wallet_assets', obj);
    toast('Actif créé', 'success');
  }
  closeModal('assetModal'); await loadAllData(); renderCurrentView();
}

function editAsset(id) {
  const a = state.wallet.find(x=>x.id===id); if (!a) return;
  state.editingId = id; state.editingType = 'asset';
  document.getElementById('assetType').value = a.type;
  document.getElementById('assetName').value = a.name;
  document.getElementById('assetValue').value = a.value_current ?? a.value ?? '';
  document.getElementById('assetQty').value = a.quantity || '';
  document.getElementById('assetPriceBuy').value = a.price_buy || '';
  document.getElementById('assetMonthly').value = a.monthly || '';
  document.getElementById('assetPlatform').value = a.platform || '';
  document.getElementById('assetStartDate').value = a.start_date || '';
  document.getElementById('assetRent').value = a.rent || '';
  document.getElementById('assetStatus').value = a.status || 'actif';
  document.getElementById('assetNotes').value = a.notes || '';
  updateAssetFields();
  openModal('assetModal');
}

async function deleteAsset(id) {
  if (!confirm('Supprimer cet actif ?')) return;
  await sbDelete('wallet_assets', id);
  await loadAllData();
  if (document.getElementById('walletDetailModal').classList.contains('active')) renderWalletDetailList();
  renderCurrentView();
  toast('Actif supprimé', 'info');
}

// ==================== EXPORT / IMPORT ====================
function exportData() {
  const data = {
    version: '3.0',
    exported_at: new Date().toISOString(),
    user: { pseudo: state.user.user_metadata?.pseudo, email: state.user.email },
    events: state.events,
    tasks: state.tasks,
    projects: state.projects,
    wallet: state.wallet
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `carnet-de-bord-export-${new Date().toISOString().split('T')[0]}.json`;
  a.click(); URL.revokeObjectURL(url);
  toast('Export téléchargé', 'success');
}

async function importData(input) {
  const file = input.files[0]; if (!file) return;
  const text = await file.text();
  try {
    const data = JSON.parse(text);
    if (data.events) { for (const e of data.events) { e.user_id = state.user.id; await sbInsert('events', e); } }
    if (data.tasks) { for (const t of data.tasks) { t.user_id = state.user.id; await sbInsert('tasks', t); } }
    if (data.projects) { for (const p of data.projects) { p.owner_id = state.user.id; await sbInsert('projects', p); } }
    if (data.wallet) { for (const w of data.wallet) { w.user_id = state.user.id; await sbInsert('wallet_assets', w); } }
    await loadAllData(); renderCurrentView();
    toast('Import réussi', 'success');
  } catch(e) { toast('Fichier invalide', 'error'); }
}

async function deleteAccount() {
  if (!confirm('ATTENTION : Cela supprimera TOUTES tes données de façon irréversible. Continuer ?')) return;
  if (!confirm('Dernière chance. Es-tu absolument sûr ?')) return;
  for (const e of state.events) await sbDelete('events', e.id);
  for (const t of state.tasks) await sbDelete('tasks', t.id);
  for (const p of state.projects) await sbDelete('projects', p.id);
  for (const w of state.wallet) await sbDelete('wallet_assets', w.id);
  if (sbAvailable && supabase) await supabase.auth.signOut();
  localStorage.clear();
  toast('Compte supprimé', 'info');
  setTimeout(() => location.reload(), 1500);
}

// ==================== SETTINGS ====================
function saveSupabaseConfig() {
  const url = document.getElementById('sbUrl').value.trim();
  const key = document.getElementById('sbKey').value.trim();
  if (!url || !key) { toast('Renseigne les deux champs', 'error'); return; }
  localStorage.setItem('sb_url', url);
  localStorage.setItem('sb_key', key);
  toast('Config sauvegardée, rechargement...', 'success');
  setTimeout(() => location.reload(), 1000);
}

// ==================== MODALS ====================
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); state.editingId = null; state.editingType = null; }
function openQuickCreate() { openModal('quickCreateModal'); }
const COMMON_TASKS = [
  'Faire les courses', 'Appeler le médecin', 'Prendre rendez-vous chez le dentiste', 'Payer une facture',
  'Aller à la salle de sport', 'Sortir les poubelles', 'Faire la lessive', 'Réunion équipe',
  'Appeler la banque', 'Renouveler une ordonnance', 'Faire le plein d\'essence', 'Récupérer un colis',
  'Préparer les documents administratifs', 'Nettoyer la maison', 'Faire les vitres', 'Arroser les plantes',
  'Prendre rendez-vous chez le coiffeur', 'Réviser la voiture', 'Déclarer les impôts', 'Résilier un abonnement',
  'Anniversaire à préparer', 'Appeler un ami', 'Rendez-vous médecin', 'Contrôle technique voiture'
];
function populateTitleSuggestions(datalistId, historySource) {
  const dl = document.getElementById(datalistId);
  const history = [...new Set((historySource||[]).map(x => x.title).filter(Boolean))];
  const combined = [...new Set([...history, ...COMMON_TASKS])].slice(0, 60);
  dl.innerHTML = combined.map(t => `<option value="${escapeHtml(t)}"></option>`).join('');
}

function openEventModal() {
  state.editingId = null; state.editingType = null;
  document.getElementById('eventModal').querySelector('form').reset();
  document.getElementById('evtRec').value = 'none';
  openModal('eventModal'); updateEventFields();
  populateTitleSuggestions('evtTitleSuggestions', state.events);
}
function openTaskModal(prefillTemplate, prefillTitle) {
  state.editingId = null; state.editingType = null;
  document.getElementById('taskModal').querySelector('form').reset();
  currentArticles = [];
  openModal('taskModal'); updateTaskFields();
  populateTitleSuggestions('taskTitleSuggestions', state.tasks);
  if (prefillTemplate) document.getElementById('taskTemplate').value = prefillTemplate;
  if (prefillTitle) document.getElementById('taskTitle').value = prefillTitle;
  if (prefillTemplate) updateTaskFields();
}
function openProjectModal() {
  state.editingId = null; state.editingType = null;
  document.getElementById('projectModal').querySelector('form').reset();
  openModal('projectModal'); updateProjectPhases();
  if (state.projectCurrentCat) { document.getElementById('projCat').value = state.projectCurrentCat; updateProjectPhases(); }
}
function openAssetModal(prefillType) {
  state.editingId = null; state.editingType = null;
  document.getElementById('assetModal').querySelector('form').reset();
  if (prefillType) document.getElementById('assetType').value = prefillType;
  openModal('assetModal');
  updateAssetFields();
}

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => {
    if (e.target === o) {
      o.classList.remove('active');
      if (o.id === 'onboardingModal') closeOnboarding();
    }
  });
});

// ==================== SEARCH ====================
function openSearch() { document.getElementById('searchOverlay').classList.add('active'); document.getElementById('searchInput').focus(); }
function closeSearch() { document.getElementById('searchOverlay').classList.remove('active'); document.getElementById('searchInput').value = ''; document.getElementById('searchResults').innerHTML = ''; }
function doSearch(q) {
  if (!q) { document.getElementById('searchResults').innerHTML = ''; return; }
  const qlow = q.toLowerCase();
  const results = [];
  state.events.filter(e => e.title.toLowerCase().includes(qlow)).forEach(e => results.push({ type:'Événement', title:e.title, meta:e.date + (e.time?' '+e.time:''), action:()=>{navigateTo('agenda');closeSearch();} }));
  state.tasks.filter(t => t.title.toLowerCase().includes(qlow)).forEach(t => results.push({ type:'Tâche', title:t.title, meta:(t.due||'Sans échéance'), action:()=>{navigateTo('tasks');closeSearch();} }));
  state.projects.filter(p => p.title.toLowerCase().includes(qlow)).forEach(p => results.push({ type:'Projet', title:p.title, meta:p.cat+' · '+p.phase, action:()=>{navigateTo('projects');closeSearch();} }));
  state.wallet.filter(a => (a.name||'').toLowerCase().includes(qlow)).forEach(a => results.push({ type:'Actif', title:a.name, meta:a.type, action:()=>{navigateTo('wallet');closeSearch();} }));
  document.getElementById('searchResults').innerHTML = results.slice(0,10).map(r => `
    <div class="search-result-item" onclick="(${r.action.toString()})()">
      <div class="search-result-type">${r.type}</div>
      <div class="search-result-title">${escapeHtml(r.title)}</div>
      <div class="search-result-meta">${r.meta}</div>
    </div>
  `).join('') || '<div style="padding:20px;color:var(--text-muted)">Aucun résultat</div>';
}

// ==================== FOCUS MODE ====================
// ==================== LÉGAL ====================
const LEGAL_TEXTS = {
  mentions: `
    <p><strong>⚠️ Modèle à personnaliser</strong> — remplace les crochets par tes vraies informations avant toute mise en ligne publique et fais valider ce document par un professionnel du droit avant toute commercialisation.</p>
    <p><strong>Éditeur du site :</strong> [Ton nom / raison sociale], [statut juridique — ex : auto-entreprise], [adresse], [email de contact], [n° SIREN si applicable].</p>
    <p><strong>Hébergement :</strong> Ce site est hébergé par Netlify, Inc. Les données sont stockées via Supabase (base de données hébergée en Union Européenne — Irlande).</p>
    <p><strong>Directeur de publication :</strong> [Ton nom].</p>
    <p><strong>Contact :</strong> Pour toute question, écris à [ton email].</p>
  `,
  cgu: `
    <p><strong>⚠️ Modèle à personnaliser et faire valider par un avocat avant toute commercialisation.</strong></p>
    <p><strong>1. Objet.</strong> Carnet de Bord est un outil personnel d'organisation (agenda, tâches, projets, suivi de patrimoine). L'utilisateur saisit lui-même toutes les données, y compris les valeurs financières.</p>
    <p><strong>2. Pas de conseil financier.</strong> Carnet de Bord n'est ni un conseiller en investissement, ni un établissement financier, ni un agrégateur bancaire automatique. Les valeurs affichées dans la section Wallet sont saisies manuellement par l'utilisateur ; elles ne sont ni vérifiées ni garanties par l'éditeur. Aucune information de l'application ne constitue un conseil en investissement.</p>
    <p><strong>3. Compte utilisateur.</strong> L'utilisateur doit avoir 15 ans ou plus. Il est responsable de la confidentialité de ses identifiants.</p>
    <p><strong>4. Disponibilité.</strong> L'application est fournie "en l'état", sans garantie de disponibilité continue ni d'absence d'erreurs. L'éditeur ne pourra être tenu responsable d'une perte de données, sous réserve des dispositions d'ordre public applicables.</p>
    <p><strong>5. Responsabilité.</strong> Dans la limite permise par la loi, la responsabilité de l'éditeur ne pourra être engagée qu'en cas de faute prouvée, et sera limitée aux sommes effectivement versées par l'utilisateur au cours des 12 derniers mois.</p>
    <p><strong>6. Résiliation.</strong> L'utilisateur peut supprimer son compte à tout moment depuis les Paramètres, ce qui entraîne la suppression de ses données.</p>
    <p><strong>7. Droit applicable.</strong> Les présentes CGU sont soumises au droit français.</p>
  `,
  confidentialite: `
    <p><strong>⚠️ Modèle à personnaliser et faire valider avant toute commercialisation.</strong></p>
    <p><strong>Données collectées :</strong> email, pseudo, mot de passe (chiffré), et les données que tu saisis toi-même (événements, tâches, projets, actifs patrimoniaux).</p>
    <p><strong>Finalité :</strong> ces données servent uniquement à faire fonctionner l'application pour toi. Elles ne sont ni vendues, ni partagées avec des tiers à des fins publicitaires.</p>
    <p><strong>Hébergement :</strong> les données sont stockées chez Supabase, dans un centre de données situé en Union Européenne (Irlande), avec un accès protégé par des règles de sécurité au niveau de chaque ligne (Row Level Security) : chaque utilisateur ne peut voir que ses propres données.</p>
    <p><strong>Tes droits (RGPD) :</strong> tu peux à tout moment exporter tes données (Paramètres → Exporter) ou supprimer définitivement ton compte et toutes tes données (Paramètres → Supprimer mon compte).</p>
    <p><strong>Conservation :</strong> tes données sont conservées tant que ton compte est actif, et supprimées définitivement en cas de suppression de compte.</p>
    <p><strong>Contact :</strong> pour toute question relative à tes données, écris à [ton email].</p>
  `
};
function openLegal(tab) {
  setLegalTab(tab || 'mentions');
  openModal('legalModal');
}
function setLegalTab(tab) {
  document.querySelectorAll('#legalTabs .tab').forEach(t => t.classList.toggle('active', t.dataset.legal === tab));
  document.getElementById('legalContent').innerHTML = LEGAL_TEXTS[tab];
}

function toggleFocus() {
  state.focusMode = !state.focusMode;
  document.body.classList.toggle('focus-mode', state.focusMode);
  document.getElementById('focusToggle').textContent = state.focusMode ? '✕' : '☕';
  toast(state.focusMode ? 'Mode Focus activé' : 'Mode Focus désactivé', 'info');
}

// ==================== KEYBOARD SHORTCUTS ====================
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeSearch(); document.querySelectorAll('.modal-overlay.active').forEach(m=>m.classList.remove('active')); return; }
  // Ignore les raccourcis lettres/chiffres si on est en train de taper dans un champ
  const tag = (e.target.tagName || '').toLowerCase();
  const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
  if (e.key === 'k' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openSearch(); return; }
  if (e.key === 'n' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openQuickCreate(); return; }
  if (isTyping) return;
  if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); toggleFocus(); }
  if (e.key === '0' && !e.ctrlKey && !e.metaKey && !e.altKey) { navigateTo('accueil'); }
  if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[1-6]$/.test(e.key)) {
    const views = ['filrouge','agenda','tasks','menus','projects','wallet'];
    navigateTo(views[parseInt(e.key)-1]);
  }
});

// ==================== UTILITIES ====================
function escapeHtml(t) { if (!t) return ''; return t.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function fmtMoney(n) { return new Intl.NumberFormat('fr-FR', { style:'currency', currency:'EUR' }).format(n || 0); }
function formatDate(d) { if (!d) return ''; return new Date(d).toLocaleDateString('fr-FR'); }
function isToday(d) { if (!d) return false; return new Date(d).toISOString().split('T')[0] === new Date().toISOString().split('T')[0]; }
function daysDiff(a, b) { return Math.ceil((new Date(a) - new Date(b)) / (1000*60*60*24)); }
function toast(msg, type='info') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// Init
updateProjectPhases();
updateEventFields();
