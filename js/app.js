import { firebaseConfig, ADMIN_EMAILS, USE_DEMO_WHEN_UNCONFIGURED } from './firebaseConfig.js';

const FIREBASE_CDN_VERSION = '10.13.2';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const app = $('#app');
const toastZone = document.createElement('div');
toastZone.className = 'toast-zone';
document.body.appendChild(toastZone);

const emptyComponents = () => ({ tecnica: [], teorico: [], repertorio: [], creativo: [] });
const componentLabels = {
  tecnica: 'Técnica',
  teorico: 'Teórico',
  repertorio: 'Repertorio',
  creativo: 'Creativo / expresivo'
};
const componentEmojis = {
  tecnica: '🎯',
  teorico: '🧠',
  repertorio: '🎼',
  creativo: '✨'
};
const defaultComponentLabels = { ...componentLabels };
const defaultComponentEmojis = { ...componentEmojis };
const statusLabels = {
  draft: 'Borrador',
  review: 'En revisión',
  published: 'Publicado',
  archived: 'Archivado'
};
const roleLabels = {
  admin: 'Admin',
  docente_editor: 'Docente editor',
  docente_lector: 'Docente lector',
  coordinador: 'Coordinador'
};
const difficultyLabels = {
  inicial: 'Inicial',
  basico: 'Básico',
  intermedio: 'Intermedio',
  avanzado: 'Avanzado'
};

let services = null;
let state = {
  mode: 'loading',
  firebaseReady: false,
  authTab: 'login',
  user: null,
  profile: null,
  view: 'dashboard',
  mobileMenu: false,
  loading: true,
  arts: [],
  routes: [],
  experiences: [],
  skills: [],
  users: [],
  invites: [],
  logs: [],
  settings: {
    componentCatalog: {},
    categoryCatalog: []
  },
  filters: {
    search: '',
    artId: 'all',
    routeId: 'all',
    status: 'active'
  },
  libraryFilters: {
    search: '',
    artId: 'all',
    routeId: 'all',
    component: 'all',
    category: 'all',
    difficulty: 'all'
  },
  selectedArtId: 'all',
  selectedRouteId: 'all',
  prereqViewMode: 'columns',
  editingArtId: null,
  editingRouteId: null,
  editingExperienceId: null,
  draftExperience: null,
  skillEditorOpen: false,
  editingSkillId: null,
  draftSkill: null,
  expandedSkillIds: new Set(),
  report: null,
  modal: null
};

function normalizeEmail(email = '') {
  return String(email).trim().toLowerCase();
}

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function slugify(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || uid('slug');
}

function duplicateKey(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function cleanCategory(value) {
  return String(value ?? '').trim();
}

function skillCategory(skill) {
  return cleanCategory(skill?.category);
}

function categoryLabel(skill) {
  return skillCategory(skill) || 'Sin categoría';
}

function normalizeCategoryCatalog(catalog = []) {
  return (Array.isArray(catalog) ? catalog : [])
    .map(item => ({
      id: item.id || uid('cat'),
      component: componentKeys().includes(item.component) ? item.component : 'tecnica',
      name: cleanCategory(item.name),
      active: item.active !== false
    }))
    .filter(item => item.name);
}

function categoryCatalogItems() {
  const configured = normalizeCategoryCatalog(state.settings?.categoryCatalog || []);
  const byKey = new Map();
  configured.forEach(item => byKey.set(`${item.component}::${duplicateKey(item.name)}`, item));

  // Compatibilidad: si ya había saberes con categoría antes del catálogo, los mostramos
  // hasta que el admin los formalice o los reemplace.
  state.skills.forEach(skill => {
    const name = skillCategory(skill);
    if (!name || !componentKeys().includes(skill.component)) return;
    const key = `${skill.component}::${duplicateKey(name)}`;
    if (!byKey.has(key)) {
      byKey.set(key, { id: uid('cat'), component: skill.component, name, active: true, derived: true });
    }
  });

  return [...byKey.values()].sort((a, b) =>
    (componentLabels[a.component] || a.component).localeCompare(componentLabels[b.component] || b.component) ||
    a.name.localeCompare(b.name)
  );
}

function activeCategoriesForComponent(component, current = '') {
  const currentKey = duplicateKey(current);
  const items = categoryCatalogItems()
    .filter(item => item.component === component)
    .filter(item => item.active || duplicateKey(item.name) === currentKey);
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

function prerequisiteClosure(skillId, seen = new Set()) {
  if (!skillId || seen.has(skillId)) return [];
  seen.add(skillId);
  const skill = getSkill(skillId);
  if (!skill) return [];
  return (skill.prerequisites || []).flatMap(id => [id, ...prerequisiteClosure(id, seen)]);
}

function hasDuplicateIn(items, value, field, currentId = null, scope = () => true) {
  const key = duplicateKey(value);
  if (!key) return false;
  return items.some(item => item.id !== currentId && scope(item) && duplicateKey(item[field]) === key);
}

function firstDuplicateResource(resources) {
  const seenTitles = new Set();
  const seenUrls = new Set();
  for (const resource of resources) {
    const title = duplicateKey(resource.title);
    const url = duplicateKey(resource.url);
    if (title) {
      if (seenTitles.has(title)) return 'Hay dos recursos con el mismo título en esta experiencia.';
      seenTitles.add(title);
    }
    if (url) {
      if (seenUrls.has(url)) return 'Hay dos recursos con la misma URL en esta experiencia.';
      seenUrls.add(url);
    }
  }
  return '';
}

function nowISO() {
  return new Date().toISOString();
}

function formatDate(value) {
  if (!value) return 'Sin fecha';
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function toast(message, type = 'ok') {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  toastZone.appendChild(node);
  setTimeout(() => node.remove(), 4200);
}

function isFirebaseConfigured() {
  return Boolean(firebaseConfig?.apiKey && firebaseConfig.apiKey !== 'TU_API_KEY' && firebaseConfig.projectId && firebaseConfig.projectId !== 'TU_PROYECTO');
}

function isAdminEmail(email) {
  return ADMIN_EMAILS.map(normalizeEmail).includes(normalizeEmail(email));
}

function hasRole(...roles) {
  if (!state.profile) return false;
  if (state.profile.role === 'admin') return true;
  return roles.includes(state.profile.role);
}

function canEditRoute(routeId, artId) {
  if (!state.profile) return false;
  if (state.profile.role === 'admin') return true;
  if (!['docente_editor', 'coordinador'].includes(state.profile.role)) return false;
  const arts = state.profile.allowedArts || [];
  const routes = state.profile.allowedRoutes || [];
  const artOk = arts.includes('*') || arts.includes(artId);
  const routeOk = routes.includes('*') || routes.includes(routeId);
  return artOk && routeOk;
}

function readableRole(profile = state.profile) {
  return roleLabels[profile?.role] || 'Sin rol';
}

function statusBadge(status) {
  const cls = status === 'published' ? 'published' : status === 'review' ? 'review' : status === 'archived' ? 'archived' : 'draft';
  return `<span class="badge ${cls}">${escapeHtml(statusLabels[status] || status || 'Borrador')}</span>`;
}

function difficultyBadge(difficulty) {
  const known = difficultyLabels[difficulty] ? difficulty : null;
  return `<span class="badge ${known ? `diff-${known}` : ''}">${escapeHtml(difficultyLabels[difficulty] || difficulty || 'Sin dificultad')}</span>`;
}

function roleBadge(role) {
  const cls = role === 'admin' ? 'admin' : role === 'docente_editor' || role === 'coordinador' ? 'editor' : 'viewer';
  return `<span class="badge ${cls}">${escapeHtml(roleLabels[role] || role || 'Sin rol')}</span>`;
}

function getArt(id) { return state.arts.find(a => a.id === id); }
function getRoute(id) { return state.routes.find(r => r.id === id); }
function getExperience(id) { return state.experiences.find(e => e.id === id); }
function getSkill(id) { return state.skills.find(s => s.id === id); }

function canEditArt(artId) {
  if (!state.profile) return false;
  if (state.profile.role === 'admin') return true;
  if (!['docente_editor', 'coordinador'].includes(state.profile.role)) return false;
  const arts = state.profile.allowedArts || [];
  return arts.includes('*') || arts.includes(artId);
}

function editableArts() {
  return state.arts.filter(a => canEditArt(a.id)).sort((a, b) => (a.order || 0) - (b.order || 0));
}

function skillsByArt(artId) {
  return state.skills.filter(s => artId === 'all' || s.artId === artId);
}

function skillRouteIds(skill) {
  return Array.isArray(skill?.routeIds) ? skill.routeIds.filter(Boolean) : [];
}

function skillAppliesToRoute(skill, routeId) {
  if (!routeId || routeId === 'all') return true;
  const routeIds = skillRouteIds(skill);
  return routeIds.includes(routeId);
}

function skillsByRoute(route) {
  if (!route) return [];
  return skillsByArt(route.artId).filter(skill => skillAppliesToRoute(skill, route.id));
}

function skillRouteLabels(skill) {
  const routeIds = skillRouteIds(skill);
  if (!routeIds.length) return ['Sin ruta asignada'];
  return routeIds.map(id => getRoute(id)?.name).filter(Boolean);
}

function allComponentKeys() {
  return Object.keys(defaultComponentLabels);
}

function componentCatalogEntry(key) {
  return state.settings?.componentCatalog?.[key] || {};
}

function componentKeys() {
  return allComponentKeys().filter(key => !componentCatalogEntry(key).deleted);
}

function isComponentActive(key) {
  const entry = componentCatalogEntry(key);
  return !entry.deleted && entry.active !== false;
}

function activeComponentKeys() {
  return componentKeys().filter(isComponentActive);
}

function applyComponentCatalog(catalog = {}) {
  allComponentKeys().forEach(key => {
    const item = catalog[key] || {};
    componentLabels[key] = String(item.label || defaultComponentLabels[key] || key).trim();
    componentEmojis[key] = String(item.emoji || defaultComponentEmojis[key] || '').trim();
  });
}

function currentComponentCatalog() {
  const catalog = { ...(state.settings?.componentCatalog || {}) };
  allComponentKeys().forEach(key => {
    if (catalog[key]?.deleted) return;
    catalog[key] = {
      label: componentLabels[key] || defaultComponentLabels[key],
      emoji: componentEmojis[key] || defaultComponentEmojis[key] || '',
      active: isComponentActive(key)
    };
  });
  return catalog;
}

// Resuelve los skillRefs de una experiencia contra la biblioteca, descartando saberes borrados.
function resolveSkillRefs(refs) {
  return (refs || [])
    .map(ref => ({ ref, skill: getSkill(ref.skillId) }))
    .filter(entry => entry.skill);
}

// Cuenta saberes por componente. Usa skillRefs; cae a components heredados si no hay refs.
function experienceComponentCounts(exp) {
  const counts = { tecnica: 0, teorico: 0, repertorio: 0, creativo: 0 };
  if (exp.skillRefs && exp.skillRefs.length) {
    resolveSkillRefs(exp.skillRefs).forEach(({ skill }) => {
      if (counts[skill.component] != null) counts[skill.component] += 1;
    });
  } else {
    const comps = exp.components || {};
    Object.keys(counts).forEach(key => { counts[key] = (comps[key] || []).length; });
  }
  return counts;
}

// Ítems {title, achievement, note} de una experiencia para un componente, desde skillRefs (o components heredados).
function experienceComponentItems(exp, component) {
  if (exp.skillRefs && exp.skillRefs.length) {
    return resolveSkillRefs(exp.skillRefs)
      .filter(({ skill }) => skill.component === component)
      .map(({ ref, skill }) => ({ skillId: skill.id, title: skill.title, achievement: skill.achievement, note: ref.note }));
  }
  return exp.components?.[component] || [];
}
function routesByArt(artId) { return state.routes.filter(r => artId === 'all' || r.artId === artId).sort((a,b) => (a.order || 0) - (b.order || 0)); }
function experiencesByRoute(routeId) { return state.experiences.filter(e => e.routeId === routeId && e.status !== 'archived').sort((a,b) => (a.order || 0) - (b.order || 0)); }

function priorExperiencesForDraft(draft = state.draftExperience) {
  if (!draft?.routeId) return [];
  const currentOrder = Number(draft.order || 0);
  const routeExperiences = experiencesByRoute(draft.routeId)
    .filter(exp => exp.id !== state.editingExperienceId && exp.id !== draft.id);
  const previousByOrder = routeExperiences.filter(exp => !currentOrder || Number(exp.order || 0) < currentOrder);
  return previousByOrder.length || draft.id || state.editingExperienceId ? previousByOrder : routeExperiences;
}

function skillIdsUsedBeforeDraft(draft = state.draftExperience) {
  const used = new Set();
  priorExperiencesForDraft(draft).forEach(exp => {
    (exp.skillRefs || []).forEach(ref => {
      if (ref.skillId) used.add(ref.skillId);
    });
  });
  return used;
}

function experienceLabel(exp) {
  return `${exp.label || `Experiencia ${exp.order || ''}`} ${exp.name ? `· ${exp.name}` : ''}`.trim();
}

function prerequisiteExperienceNames(ids = []) {
  return ids.map(id => getExperience(id)).filter(Boolean).map(experienceLabel);
}

function canSeeExperience(exp) {
  if (!state.profile) return false;
  if (state.profile.role === 'admin') return true;
  if (exp.status === 'published') return true;
  return canEditRoute(exp.routeId, exp.artId);
}

function canEditExperience(exp) {
  return canEditRoute(exp.routeId, exp.artId);
}

async function init() {
  app.innerHTML = renderLoading();
  services = await createServices();
  state.mode = services.mode;
  await services.auth.init(async (user, profile) => {
    state.user = user;
    state.profile = profile;
    if (user && profile) {
      await loadData();
      state.loading = false;
      render();
    } else {
      state.loading = false;
      render();
    }
  });
}

async function loadData() {
  state.loading = true;
  try {
    const data = await services.data.loadAll();
    state.arts = data.arts || [];
    state.routes = data.routes || [];
    state.experiences = (data.experiences || []).filter(canSeeExperience);
    state.skills = data.skills || [];
    state.users = data.users || [];
    state.invites = data.invites || [];
    state.logs = data.logs || [];
    state.settings = data.settings || { componentCatalog: {}, categoryCatalog: [] };
    applyComponentCatalog(state.settings.componentCatalog);
    autoSelectFilters();
  } catch (error) {
    console.error(error);
    toast(`No pude cargar datos: ${error.message}`, 'error');
  } finally {
    state.loading = false;
  }
}

function autoSelectFilters() {
  if (state.selectedArtId !== 'all' && !getArt(state.selectedArtId)) state.selectedArtId = 'all';
  if (state.selectedRouteId !== 'all' && !getRoute(state.selectedRouteId)) state.selectedRouteId = 'all';
  if (state.filters.artId !== 'all' && !getArt(state.filters.artId)) state.filters.artId = 'all';
  if (state.filters.routeId !== 'all' && !getRoute(state.filters.routeId)) state.filters.routeId = 'all';
}

function render() {
  if (state.loading && !state.user) {
    app.innerHTML = renderLoading();
    return;
  }
  if (!state.user || !state.profile) {
    app.innerHTML = renderAuth();
    bindAuthEvents();
    return;
  }

  app.innerHTML = renderShell();
  bindShellEvents();
  if (state.view === 'prereqs' && state.prereqViewMode === 'tree') requestAnimationFrame(drawPrereqBranches);
}

function renderLoading() {
  return `<div class="login-page"><div class="card center"><div class="brand-mark" style="margin-inline:auto">🎶</div><h2>Cargando Mapa CREA...</h2><p class="muted">Dándole cuerda al mapa curricular, porque aparentemente las rutas de aprendizaje no se ordenan solas.</p></div></div>`;
}

function renderAuth() {
  const demoNote = state.mode === 'demo'
    ? `<div class="card soft small"><strong>Modo demo local activo.</strong><br>La app funciona con localStorage hasta que pegues tu configuración real en <code>js/firebaseConfig.js</code>.</div>`
    : '';
  return `
    <main class="login-page">
      <section class="login-card">
        <div class="login-hero">
          <div class="brand-mark">🎶</div>
          <h1>Mapa CREA<br>Musicala</h1>
          <p>Constructor de experiencias por arte, ruta y nivel. Técnica, teoría, repertorio y creación organizados sin depender de memoria, intuición y el clásico “yo juraba que eso estaba en algún lado”.</p>
          <div class="hero-list">
            <div class="hero-pill">🎯 Experiencias progresivas por ruta</div>
            <div class="hero-pill">👩‍🏫 Roles para admins y docentes</div>
            <div class="hero-pill">🧩 Componentes técnico, teórico y repertorio</div>
            <div class="hero-pill">🔥 Firebase Auth + Firestore</div>
          </div>
        </div>
        <div class="auth-panel">
          <h2>Entrar</h2>
          <p class="muted">Ingresa con tu cuenta de Google. Los admins iniciales son Alek y Cata; los docentes deben estar invitados por un admin.</p>
          <button class="btn primary full" id="google-signin" type="button">
            <span style="display:inline-flex;align-items:center;gap:10px">
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path fill="#fff" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.88 2.68-6.62z" opacity=".9"/><path fill="#fff" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" opacity=".75"/><path fill="#fff" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l3.01-2.33z" opacity=".6"/><path fill="#fff" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" opacity=".85"/></svg>
              Ingresar con Google
            </span>
          </button>
          <div class="stack" style="margin-top:16px">${demoNote}</div>
        </div>
      </section>
    </main>
  `;
}

function renderShell() {
  const viewContent = renderView();
  return `
    <div class="mobile-top">
      <button class="btn" data-action="toggle-menu">☰ Menú</button>
      <strong>Mapa CREA</strong>
    </div>
    <div class="layout">
      <aside class="sidebar ${state.mobileMenu ? 'open' : ''}">
        <div class="sidebar-brand">
          <div class="sidebar-logo">🎶</div>
          <div>
            <h2>Mapa CREA</h2>
            <p>Musicala · ${state.mode === 'demo' ? 'Demo local' : 'Firebase'}</p>
          </div>
        </div>
        <nav class="nav">
          ${navButton('dashboard', '📊', 'Inicio')}
          ${navButton('map', '🗺️', 'Mapa de experiencias')}
          ${navButton('library', '📚', 'Biblioteca de saberes')}
          ${navButton('board', '🧲', 'Tablero de armado')}
          ${navButton('prereqs', '🕸️', 'Prerrequisitos')}
          ${navButton('experiences', '🧩', 'Experiencias')}
          ${navButton('compare', '🔎', 'Comparar ruta')}
          ${hasRole('admin') ? navButton('structure', '🏛️', 'Artes y rutas') : ''}
          ${hasRole('admin') ? navButton('teachers', '👩‍🏫', 'Docentes') : ''}
          ${navButton('logs', '🕰️', 'Historial')}
          ${navButton('settings', '⚙️', 'Configuración')}
        </nav>
        <div class="sidebar-footer">
          <div class="row">
            <div class="avatar">${escapeHtml((state.profile.name || state.user.email || '?').charAt(0).toUpperCase())}</div>
            <div style="min-width:0">
              <div class="strong" style="overflow:hidden;text-overflow:ellipsis">${escapeHtml(state.profile.name || state.user.email)}</div>
              <div class="small muted">${roleBadge(state.profile.role)}</div>
            </div>
          </div>
          <button class="btn ghost full" data-action="logout" style="margin-top:12px">Salir</button>
        </div>
      </aside>
      <main class="main">
        <section class="topbar">
          <div>
            <h1>${escapeHtml(viewTitle())}</h1>
            <p>${escapeHtml(viewDescription())}</p>
          </div>
          <div class="row">
            <button class="btn teal" data-action="open-report" title="Genera un consolidado para revisar con una IA">📄 Informe</button>
            <div class="user-chip">
              <div class="avatar">${escapeHtml((state.profile.name || state.user.email || '?').charAt(0).toUpperCase())}</div>
              <div>
                <div class="strong">${escapeHtml(state.profile.name || 'Usuario')}</div>
                <div class="small muted">${escapeHtml(readableRole())}</div>
              </div>
            </div>
          </div>
        </section>
        ${viewContent}
      </main>
    </div>
    ${state.modal ? renderModal() : ''}
  `;
}

function navButton(view, icon, label) {
  return `<button class="${state.view === view ? 'active' : ''}" data-view="${view}"><span>${icon}</span>${label}</button>`;
}

function viewTitle() {
  return ({
    dashboard: 'Inicio',
    map: 'Mapa de experiencias',
    library: state.skillEditorOpen ? 'Editor de saber' : 'Biblioteca de saberes',
    board: 'Tablero de armado',
    prereqs: 'Prerrequisitos',
    experiences: state.editingExperienceId || state.draftExperience ? 'Editor de experiencia' : 'Experiencias',
    compare: 'Comparador de ruta',
    structure: 'Artes y rutas',
    teachers: 'Docentes y permisos',
    logs: 'Historial de cambios',
    settings: 'Configuración'
  })[state.view] || 'Mapa CREA';
}

function viewDescription() {
  return ({
    dashboard: 'Resumen del mapa curricular vivo: artes, rutas, experiencias y avances de construcción.',
    map: 'Visualiza la progresión por arte y ruta, de Experiencia I hacia adelante, sin andar pescando en documentos perdidos.',
    library: 'El universo completo de saberes por arte: técnica, teoría, repertorio y creación, listos para armar cualquier ruta.',
    board: 'Arrastra saberes de la biblioteca a cada nivel y entre niveles. La cobertura de arriba te muestra los vacíos de un vistazo.',
    prereqs: 'Mapa de dependencias entre saberes, ordenado por capas. Valida que cada saber de una ruta venga después de sus prerrequisitos.',
    experiences: 'Crea, edita, ordena y publica experiencias con componentes técnico, teórico, repertorio y creativo.',
    compare: 'Compara experiencias de una misma ruta para detectar saltos raros, vacíos o repeticiones que nadie pidió.',
    structure: 'Administra las artes y rutas base del mapa curricular.',
    teachers: 'Invita docentes, define roles y limita qué artes o rutas pueden editar.',
    logs: 'Revisa cambios importantes hechos en el sistema.',
    settings: 'Guía de conexión Firebase, modo actual y herramientas de respaldo.'
  })[state.view] || 'Constructor curricular de Musicala.';
}

function renderView() {
  if (state.view === 'dashboard') return renderDashboard();
  if (state.view === 'map') return renderMap();
  if (state.view === 'library') return state.skillEditorOpen ? renderSkillEditor() : renderLibrary();
  if (state.view === 'board') return renderBoard();
  if (state.view === 'prereqs') return renderPrereqs();
  if (state.view === 'experiences') return state.draftExperience ? renderExperienceEditor() : renderExperiences();
  if (state.view === 'compare') return renderCompare();
  if (state.view === 'structure') return renderStructure();
  if (state.view === 'teachers') return renderTeachers();
  if (state.view === 'logs') return renderLogs();
  if (state.view === 'settings') return renderSettings();
  return renderDashboard();
}

function renderDashboard() {
  const activeExperiences = state.experiences.filter(e => e.status !== 'archived');
  const published = activeExperiences.filter(e => e.status === 'published').length;
  const drafts = activeExperiences.filter(e => e.status === 'draft').length;
  const review = activeExperiences.filter(e => e.status === 'review').length;
  const latest = [...state.experiences].sort((a,b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)).slice(0, 5);
  return `
    <div class="grid cols-4">
      ${statCard('Artes', state.arts.length, 'Lenguajes artísticos')}
      ${statCard('Rutas', state.routes.length, 'Instrumentos / líneas')}
      ${statCard('Experiencias', activeExperiences.length, 'Activas')}
      ${statCard('Publicadas', published, 'Ruta oficial')}
    </div>
    <div class="grid cols-2" style="margin-top:18px">
      <section class="card">
        <h2>Estado del mapa</h2>
        <div class="grid cols-3">
          ${statCard('Borrador', drafts, 'En construcción')}
          ${statCard('Revisión', review, 'Para validar')}
          ${statCard('Archivadas', state.experiences.filter(e => e.status === 'archived').length, 'No visibles')}
        </div>
      </section>
      <section class="card soft">
        <h2>Siguiente paso sensato</h2>
        <p>Primero creen el mapa por arte y ruta. Después conectan estudiantes y progreso individual. Si hacen todo de una, la app nace con 47 responsabilidades y una crisis de identidad, como cualquier sistema empresarial promedio.</p>
        <div class="row">
          <button class="btn primary" data-action="new-experience">Nueva experiencia</button>
          ${hasRole('admin') ? `<button class="btn" data-view="structure">Crear arte/ruta</button>` : ''}
        </div>
      </section>
    </div>
    <section class="card" style="margin-top:18px">
      <h2>Últimas experiencias editadas</h2>
      ${latest.length ? `<div class="grid cols-2">${latest.map(renderExperienceCard).join('')}</div>` : renderEmpty('Todavía no hay experiencias. Un lienzo vacío: hermoso, intimidante y ligeramente acusador.')}
    </section>
  `;
}

function statCard(label, value, sublabel) {
  return `<div class="stat-card"><div class="value">${escapeHtml(value)}</div><div class="label">${escapeHtml(label)}</div><div class="small muted">${escapeHtml(sublabel)}</div></div>`;
}

function renderMap() {
  const artOptions = [`<option value="all">Todas las artes</option>`, ...state.arts.map(a => `<option value="${a.id}" ${state.selectedArtId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`)].join('');
  const routeOptions = [`<option value="all">Todas las rutas</option>`, ...routesByArt(state.selectedArtId).map(r => `<option value="${r.id}" ${state.selectedRouteId === r.id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`)].join('');
  const visibleRoutes = routesByArt(state.selectedArtId).filter(r => state.selectedRouteId === 'all' || r.id === state.selectedRouteId);
  return `
    <section class="card">
      <div class="toolbar">
        <div class="filters">
          <select data-filter="selectedArtId">${artOptions}</select>
          <select data-filter="selectedRouteId">${routeOptions}</select>
        </div>
        <button class="btn primary" data-action="new-experience">Nueva experiencia</button>
      </div>
      ${visibleRoutes.length ? visibleRoutes.map(renderRouteTimeline).join('') : renderEmpty('No hay rutas para mostrar. El mapa curricular necesita caminos, terrible pero cierto.')}
    </section>
  `;
}

function renderRouteTimeline(route) {
  const art = getArt(route.artId);
  const exps = experiencesByRoute(route.id).filter(canSeeExperience);
  return `
    <div class="card" style="margin-top:16px">
      <div class="row-between">
        <div>
          <h2>${escapeHtml(route.name)}</h2>
          <p class="muted" style="margin:0">${escapeHtml(art?.name || 'Sin arte')} · ${escapeHtml(route.description || 'Sin descripción')}</p>
        </div>
        ${canEditRoute(route.id, route.artId) ? `<button class="btn teal" data-action="new-experience" data-route-id="${route.id}">Agregar experiencia</button>` : ''}
      </div>
      ${exps.length ? `<div class="timeline" style="margin-top:18px">${exps.map(exp => `<div class="timeline-item">${renderExperienceCard(exp)}</div>`).join('')}</div>` : renderEmpty('Esta ruta no tiene experiencias todavía.')}
    </div>
  `;
}

function renderExperienceCard(exp) {
  const route = getRoute(exp.routeId);
  const art = getArt(exp.artId);
  const counts = experienceComponentCounts(exp);
  const prereqNames = prerequisiteExperienceNames(exp.prerequisiteExperienceIds || []);
  return `
    <article class="experience-card">
      <div class="row-between">
        <div>
          <div class="row small muted"><span>${escapeHtml(art?.name || 'Sin arte')}</span><span>›</span><span>${escapeHtml(route?.name || 'Sin ruta')}</span></div>
          <h3>${escapeHtml(exp.label || `Experiencia ${exp.order || ''}`)} · ${escapeHtml(exp.name || 'Sin nombre')}</h3>
        </div>
        ${statusBadge(exp.status)}
      </div>
      <p class="muted" style="margin:0">${escapeHtml(exp.objective || exp.description || 'Sin objetivo escrito todavía.')}</p>
      ${prereqNames.length ? `<p class="small muted" style="margin:0">&rarr; Requiere: ${prereqNames.map(escapeHtml).join(', ')}</p>` : ''}
      <div class="component-grid">
        ${activeComponentKeys().map(key => `<div class="component-pill" data-component="${key}"><strong>${componentEmojis[key]} ${componentLabels[key]}</strong><span>${counts[key]} saber(es)</span></div>`).join('')}
      </div>
      <div class="row-between">
        ${difficultyBadge(exp.difficulty)}
        <div class="row">
          <button class="btn small" data-action="view-experience" data-id="${exp.id}">Ver</button>
          ${canEditExperience(exp) ? `<button class="btn small teal" data-action="edit-experience" data-id="${exp.id}">Editar</button><button class="btn small danger" data-action="delete-experience" data-id="${exp.id}">Eliminar</button>` : ''}
        </div>
      </div>
    </article>
  `;
}

function libraryArtOptions() {
  return [`<option value="all">Todas las artes</option>`, ...state.arts.map(a => `<option value="${a.id}" ${state.libraryFilters.artId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`)].join('');
}

function libraryRouteOptions() {
  const routes = routesByArt(state.libraryFilters.artId);
  return [`<option value="all">Todas las rutas</option>`, ...routes.map(route => `<option value="${route.id}" ${state.libraryFilters.routeId === route.id ? 'selected' : ''}>${escapeHtml(route.name)}</option>`)].join('');
}

function componentFilterOptions() {
  return [`<option value="all">Todos los componentes</option>`, ...activeComponentKeys().map(key => `<option value="${key}" ${state.libraryFilters.component === key ? 'selected' : ''}>${componentEmojis[key]} ${componentLabels[key]}</option>`)].join('');
}

function categoryFilterOptions() {
  const componentScope = state.libraryFilters.component;
  const categories = categoryCatalogItems()
    .filter(item => item.active)
    .filter(item => componentScope === 'all' || item.component === componentScope)
    .map(item => item.name);
  const unique = [...new Set(categories)].sort((a, b) => a.localeCompare(b));
  return [`<option value="all">Todas las categorías</option>`, ...unique.map(category => `<option value="${escapeHtml(category)}" ${state.libraryFilters.category === category ? 'selected' : ''}>${escapeHtml(category)}</option>`)].join('');
}

function difficultyFilterOptions() {
  return [`<option value="all">Todas las dificultades</option>`, ...Object.entries(difficultyLabels).map(([key, label]) => `<option value="${key}" ${state.libraryFilters.difficulty === key ? 'selected' : ''}>${label}</option>`)].join('');
}

function filteredSkills() {
  const f = state.libraryFilters;
  const search = (f.search || '').trim().toLowerCase();
  return state.skills
    .filter(s => f.artId === 'all' || s.artId === f.artId)
    .filter(s => f.routeId === 'all' || skillAppliesToRoute(s, f.routeId))
    .filter(s => f.component === 'all' || s.component === f.component)
    .filter(s => f.category === 'all' || skillCategory(s) === f.category)
    .filter(s => f.difficulty === 'all' || s.difficulty === f.difficulty)
    .filter(s => {
      if (!search) return true;
      const haystack = [s.title, s.category, s.description, s.achievement, (s.tags || []).join(' '), getArt(s.artId)?.name, skillRouteLabels(s).join(' ')].join(' ').toLowerCase();
      return haystack.includes(search);
    });
}

function renderLibrary() {
  const canCreate = editableArts().length > 0;
  const skills = filteredSkills();
  const total = state.skills.length;
  const componentsToShow = state.libraryFilters.component === 'all'
    ? activeComponentKeys()
    : [state.libraryFilters.component];

  const sections = componentsToShow.map(key => {
    const items = skills.filter(s => s.component === key).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    if (!items.length) return '';
    const byCategory = items.reduce((groups, skill) => {
      const category = categoryLabel(skill);
      groups[category] ||= [];
      groups[category].push(skill);
      return groups;
    }, {});
    const categorySections = Object.entries(byCategory)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, categoryItems]) => `
        <div class="library-category">
          <div class="library-category-head">
            <h3>${escapeHtml(category)}</h3>
            <span class="badge">${categoryItems.length} saber(es)</span>
          </div>
          <div class="grid cols-2 library-skill-grid">${categoryItems.map(renderSkillCard).join('')}</div>
        </div>
      `).join('');
    return `
      <div class="card library-section" data-component="${key}" style="margin-top:16px">
        <div class="row-between">
          <h2>${componentEmojis[key]} ${componentLabels[key]}</h2>
          <span class="badge">${items.length} saber(es)</span>
        </div>
        <div class="library-category-list">${categorySections}</div>
      </div>
    `;
  }).join('');
  return `
    <section class="card">
      <div class="toolbar">
        <div class="filters">
          <input type="search" placeholder="Buscar saber..." value="${escapeHtml(state.libraryFilters.search)}" data-library-filter="search" />
          <select data-library-filter="artId">${libraryArtOptions()}</select>
          <select data-library-filter="routeId">${libraryRouteOptions()}</select>
          <select data-library-filter="component">${componentFilterOptions()}</select>
          <select data-library-filter="category">${categoryFilterOptions()}</select>
          <select data-library-filter="difficulty">${difficultyFilterOptions()}</select>
        </div>
        ${canCreate ? `<button class="btn primary" data-action="new-skill">Nuevo saber</button>` : ''}
      </div>
      <p class="small muted" style="margin:4px 0 0">Mostrando ${skills.length} de ${total} saber(es). Este es el universo completo que después se reparte por experiencias.</p>
    </section>
    ${skills.length ? sections : renderEmpty(total ? 'Ningún saber coincide con esos filtros.' : 'Todavía no hay saberes. Empieza a poblar el universo: cada escala, concepto y pieza que se pueda enseñar.')}
  `;
}

function renderSkillCard(skill) {
  const art = getArt(skill.artId);
  const prereqs = (skill.prerequisites || []).map(id => getSkill(id)?.title).filter(Boolean);
  const tags = skill.tags || [];
  const isExpanded = state.expandedSkillIds.has(skill.id);
  const hasDetails = Boolean(skill.description || skill.achievement || tags.length || prereqs.length);
  const category = skillCategory(skill);
  const routes = skillRouteLabels(skill);
  return `
    <article class="experience-card skill-card compact ${isExpanded ? 'is-expanded' : ''}" data-component="${skill.component}" data-skill-id="${skill.id}">
      <div class="skill-card-main">
        <div class="skill-card-copy">
          <div class="row small muted skill-card-meta"><span>${escapeHtml(art?.name || 'Sin arte')}</span><span>›</span><span>${componentEmojis[skill.component] || ''} ${escapeHtml(componentLabels[skill.component] || skill.component || '')}</span>${category ? `<span>›</span><span>${escapeHtml(category)}</span>` : ''}</div>
          <h3>${escapeHtml(skill.title || 'Sin título')}</h3>
        </div>
        ${difficultyBadge(skill.difficulty)}
      </div>
      ${isExpanded ? `
        <div class="skill-card-details">
          ${skill.description ? `<p class="muted">${escapeHtml(skill.description)}</p>` : ''}
          ${skill.achievement ? `<p class="small muted"><strong>Logro:</strong> ${escapeHtml(skill.achievement)}</p>` : ''}
          <p class="small muted"><strong>Rutas:</strong> ${routes.map(escapeHtml).join(', ')}</p>
          ${tags.length ? `<div class="row small muted">${tags.map(t => `<span class="badge">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
          ${prereqs.length ? `<p class="small muted">↳ Requiere: ${prereqs.map(escapeHtml).join(', ')}</p>` : ''}
        </div>
      ` : ''}
      <div class="skill-card-actions">
        ${hasDetails ? `<button class="btn small" data-action="toggle-skill-details" data-id="${skill.id}">${isExpanded ? 'Ver menos' : 'Ver más'}</button>` : '<span></span>'}
        ${canEditArt(skill.artId) ? `<div class="row" style="gap:8px"><button class="btn small danger" data-action="delete-skill" data-id="${skill.id}">Eliminar</button><button class="btn small teal" data-action="edit-skill" data-id="${skill.id}">Editar</button></div>` : ''}
      </div>
    </article>
  `;
}

function renderSkillEditor() {
  const d = state.draftSkill;
  const arts = editableArts();
  const artOptions = arts.map(a => `<option value="${a.id}" ${d.artId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('');
  const routeChoices = routesByArt(d.artId).filter(route => canEditRoute(route.id, route.artId));
  const selectedRouteIds = new Set(d.routeIds || []);
  const routeChecks = routeChoices.length
    ? routeChoices.map(route => `<label class="prereq-option"><input type="checkbox" data-skill-route="${route.id}" ${selectedRouteIds.has(route.id) ? 'checked' : ''} /><span>${escapeHtml(route.name)}</span></label>`).join('')
    : '<span class="muted small">Crea rutas para esta arte antes de asignar el saber.</span>';
  const optionKeys = activeComponentKeys().includes(d.component) ? activeComponentKeys() : [d.component, ...activeComponentKeys()];
  const componentOptions = optionKeys.map(key => `<option value="${key}" ${d.component === key ? 'selected' : ''}>${componentEmojis[key]} ${componentLabels[key]}</option>`).join('');
  const categoryOptions = [
    '<option value="">Elige categoría</option>',
    ...activeCategoriesForComponent(d.component, d.category)
      .map(item => `<option value="${escapeHtml(item.name)}" ${d.category === item.name ? 'selected' : ''}>${escapeHtml(item.name)}${item.derived ? ' (en uso)' : ''}</option>`)
  ].join('');
  const difficultyOptions = Object.entries(difficultyLabels).map(([key, label]) => `<option value="${key}" ${d.difficulty === key ? 'selected' : ''}>${label}</option>`).join('');
  const prereqCandidates = state.skills
    .filter(s => s.artId === d.artId && s.component === d.component && skillCategory(s) === cleanCategory(d.category) && s.id !== state.editingSkillId)
    .filter(s => {
      const selectedRoutes = d.routeIds || [];
      const candidateRoutes = skillRouteIds(s);
      return !selectedRoutes.length || candidateRoutes.some(id => selectedRoutes.includes(id));
    })
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  const prereqChecks = prereqCandidates.length
    ? prereqCandidates.map(s => `<label class="prereq-option"><input type="checkbox" data-skill-prereq="${s.id}" ${(d.prerequisites || []).includes(s.id) ? 'checked' : ''} /><span>${componentEmojis[s.component] || ''} ${escapeHtml(s.title)}</span></label>`).join('')
    : `<span class="muted small">${cleanCategory(d.category) ? 'No hay otros saberes en esta categoría todavía.' : 'Elige una categoría para ver prerrequisitos de esa rama.'}</span>`;

  return `
    <form id="skill-form" class="stack">
      <div class="row-between">
        <h2>${state.editingSkillId ? 'Editar saber' : 'Nuevo saber'}</h2>
        <button type="button" class="btn" data-action="cancel-skill-editor">Cancelar</button>
      </div>
      <div class="grid cols-2">
        <div class="form-field"><label>Arte</label><select data-skill="artId">${artOptions}</select></div>
        <div class="form-field"><label>Componente</label><select data-skill="component">${componentOptions}</select></div>
      </div>
      <div class="card soft stack">
        <strong>Rutas / instrumentos donde aplica</strong>
        <p class="small muted" style="margin:0">Marca solo los instrumentos que trabajan este saber. Si no lo marcas para una ruta, no aparecerá en su tablero.</p>
        <div class="prereq-list small">${routeChecks}</div>
      </div>
      <div class="form-field">
        <label>Categoría</label>
        <select data-skill="category">${categoryOptions}</select>
      </div>
      <div class="form-field"><label>Título</label><input data-skill="title" value="${escapeHtml(d.title)}" placeholder="Ej: Escala de Do mayor, dos octavas" required /></div>
      <div class="form-field"><label>Descripción</label><textarea data-skill="description" placeholder="Qué se trabaja exactamente">${escapeHtml(d.description)}</textarea></div>
      <div class="form-field"><label>Criterio de logro</label><textarea data-skill="achievement" placeholder="Cómo se evidencia que se domina">${escapeHtml(d.achievement)}</textarea></div>
      <div class="grid cols-2">
        <div class="form-field"><label>Dificultad</label><select data-skill="difficulty">${difficultyOptions}</select></div>
        <div class="form-field"><label>Etiquetas (separadas por coma)</label><input data-skill="tagsText" value="${escapeHtml(d.tagsText)}" placeholder="escalas, lectura, Bach" /></div>
      </div>
      <div class="card soft stack">
        <strong>Prerrequisitos (otros saberes de esta arte)</strong>
        <p class="small muted" style="margin:0">Solo se muestran saberes de la misma categoría. Si marcas un saber que ya tiene prerrequisitos, la cadena anterior se agrega automáticamente.</p>
        <div class="prereq-list small">${prereqChecks}</div>
      </div>
      <button class="btn primary full" type="submit">${state.editingSkillId ? 'Guardar cambios' : 'Crear saber'}</button>
    </form>
  `;
}

// ---------- Tablero de armado (Fase 3) ----------

let compareDrag = null; // { skillId, source } al mover un saber entre experiencias en el comparador.
let boardDrag = null; // { skillId, source } durante un arrastre. Fuera del estado para no re-renderizar.

function boardData(route) {
  const exps = experiencesByRoute(route.id).filter(canSeeExperience);
  const assigned = new Set();
  exps.forEach(e => (e.skillRefs || []).forEach(r => assigned.add(r.skillId)));
  const unassigned = skillsByRoute(route)
    .filter(s => !assigned.has(s.id))
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  return { exps, unassigned };
}

function renderBoard() {
  const artOptions = [`<option value="all">Elige arte</option>`, ...state.arts.map(a => `<option value="${a.id}" ${state.selectedArtId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`)].join('');
  const routeOptions = [`<option value="all">Elige ruta</option>`, ...routesByArt(state.selectedArtId).map(r => `<option value="${r.id}" ${state.selectedRouteId === r.id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`)].join('');
  const route = getRoute(state.selectedRouteId);

  const toolbar = `
    <div class="toolbar">
      <div class="filters">
        <select data-filter="selectedArtId">${artOptions}</select>
        <select data-filter="selectedRouteId">${routeOptions}</select>
      </div>
      ${route && canEditRoute(route.id, route.artId) ? `<button class="btn primary" data-action="new-experience" data-route-id="${route.id}">Nuevo nivel</button>` : ''}
    </div>`;

  if (!route) {
    return `<section class="card">${toolbar}${renderEmpty('Elige un arte y una ruta para empezar a armar el tablero.')}</section>`;
  }

  const { exps, unassigned } = boardData(route);
  const editable = canEditRoute(route.id, route.artId);

  const libraryColumn = renderBoardColumn({
    id: 'library',
    title: '📚 Biblioteca (sin asignar)',
    skills: unassigned.map(s => ({ skill: s, ref: null })),
    source: 'library',
    editable,
    empty: 'Todos los saberes de esta arte ya están en algún nivel.'
  });

  const levelColumns = exps.map(exp => renderBoardColumn({
    id: exp.id,
    title: `${escapeHtml(exp.label || 'Nivel')} · ${escapeHtml(exp.name || '')}`,
    skills: resolveSkillRefs(exp.skillRefs),
    source: exp.id,
    editable,
    empty: editable ? 'Arrastra saberes aquí.' : 'Sin saberes.'
  })).join('');

  return `
    <section class="card">${toolbar}</section>
    ${renderCoverage(exps, route)}
    <div class="board">${libraryColumn}${levelColumns || ''}</div>
    ${editable ? '' : `<p class="small muted" style="margin-top:10px">Modo solo lectura: no puedes mover saberes en esta ruta.</p>`}
  `;
}

function renderBoardColumn({ id, title, skills, source, editable, empty }) {
  const cards = skills.length
    ? skills.map(({ skill, ref }) => renderBoardSkillCard(skill, source, editable, ref)).join('')
    : `<p class="muted small board-empty">${empty}</p>`;
  return `
    <div class="board-col ${id === 'library' ? 'board-col-library' : ''}" data-target="${id}">
      <div class="board-col-head"><span>${title}</span><span class="badge">${skills.length}</span></div>
      <div class="board-col-body">${cards}</div>
    </div>
  `;
}

function renderBoardSkillCard(skill, source, editable, ref) {
  const category = skillCategory(skill);
  return `
    <div class="board-card" data-component="${skill.component}" data-skill-id="${skill.id}" data-source="${source}" ${editable ? 'draggable="true"' : ''}>
      <div class="strong small">${escapeHtml(skill.title || 'Sin título')}</div>
      <div class="row small muted" style="gap:6px;margin-top:4px">${componentEmojis[skill.component] || ''} ${category ? `${escapeHtml(category)} · ` : ''}${difficultyBadge(skill.difficulty)}</div>
      ${ref?.note ? `<div class="small muted" style="margin-top:4px">📝 ${escapeHtml(ref.note)}</div>` : ''}
    </div>
  `;
}

function renderCoverage(exps, route) {
  if (!exps.length) return '';
  const components = activeComponentKeys();
  const availByComp = {};
  components.forEach(c => { availByComp[c] = skillsByRoute(route).filter(s => s.component === c).length; });

  const headRow = `<tr><th>Nivel</th>${components.map(c => `<th data-component="${c}" style="text-align:center">${componentEmojis[c]} ${componentLabels[c]}</th>`).join('')}<th style="text-align:center">Total</th></tr>`;

  const rows = exps.map(exp => {
    const counts = experienceComponentCounts(exp);
    const total = components.reduce((sum, c) => sum + counts[c], 0);
    return `<tr><th>${escapeHtml(exp.label || '')} ${escapeHtml(exp.name || '')}</th>${components.map(c => {
      const n = counts[c];
      const fill = n === 0 ? '0' : (n <= 2 ? 'low' : 'high');
      return `<td class="cov-cell" data-component="${c}" data-fill="${fill}">${n}</td>`;
    }).join('')}<td class="cov-cell" data-fill="${total === 0 ? '0' : 'high'}" style="--accent:#475467;--accent-soft:#e4e7ec">${total}</td></tr>`;
  }).join('');

  const availRow = `<tr><th class="muted">En biblioteca</th>${components.map(c => `<td data-component="${c}" class="small muted" style="text-align:center">${availByComp[c]}</td>`).join('')}<td class="small muted" style="text-align:center">${components.reduce((s,c)=>s+availByComp[c],0)}</td></tr>`;

  return `
    <section class="card" style="margin-top:14px">
      <h2>Cobertura de la ruta</h2>
      <p class="small muted" style="margin:0 0 12px">Saberes por nivel y componente. Las celdas vacías son tus vacíos curriculares.</p>
      <div class="table-wrap"><table class="coverage-table"><thead>${headRow}</thead><tbody>${rows}${availRow}</tbody></table></div>
    </section>
  `;
}

// ---------- Grafo de prerrequisitos (Fase 4) ----------

// Ordena los saberes de un arte en capas topológicas (Kahn). Devuelve también dependientes y cíclicos.
function topoLayers(artSkills) {
  const byId = new Map(artSkills.map(s => [s.id, s]));
  const prereqs = new Map(artSkills.map(s => [s.id, (s.prerequisites || []).filter(p => byId.has(p))]));
  const indeg = new Map(artSkills.map(s => [s.id, prereqs.get(s.id).length]));
  const dependents = new Map(artSkills.map(s => [s.id, []]));
  artSkills.forEach(s => prereqs.get(s.id).forEach(p => dependents.get(p).push(s.id)));

  const layers = [];
  const placed = new Set();
  let frontier = artSkills.filter(s => indeg.get(s.id) === 0).map(s => s.id);
  while (frontier.length) {
    frontier.sort((a, b) => (byId.get(a).title || '').localeCompare(byId.get(b).title || ''));
    layers.push(frontier.map(id => byId.get(id)));
    frontier.forEach(id => placed.add(id));
    const next = [];
    frontier.forEach(id => dependents.get(id).forEach(d => {
      indeg.set(d, indeg.get(d) - 1);
      if (indeg.get(d) === 0) next.push(d);
    }));
    frontier = next;
  }
  const cyclic = artSkills.filter(s => !placed.has(s.id));
  return { layers, cyclic, dependents };
}

// Detecta saberes ubicados en una ruta antes (o sin) sus prerrequisitos.
function routeOrderingIssues(route) {
  const exps = experiencesByRoute(route.id).filter(canSeeExperience);
  const levelOf = new Map();
  exps.forEach((e, idx) => (e.skillRefs || []).forEach(r => { if (!levelOf.has(r.skillId)) levelOf.set(r.skillId, idx); }));

  const issues = [];
  exps.forEach((e, idx) => (e.skillRefs || []).forEach(r => {
    const skill = getSkill(r.skillId);
    if (!skill) return;
    (skill.prerequisites || []).forEach(pid => {
      const pre = getSkill(pid);
      if (!pre) return;
      if (!levelOf.has(pid)) {
        issues.push({ type: 'missing', expLabel: e.label, skill: skill.title, pre: pre.title });
      } else if (levelOf.get(pid) > idx) {
        issues.push({ type: 'late', expLabel: e.label, skill: skill.title, pre: pre.title, preExpLabel: exps[levelOf.get(pid)].label });
      }
    });
  }));
  return issues;
}

function renderPrereqs() {
  const artOptions = [`<option value="all">Elige arte</option>`, ...state.arts.map(a => `<option value="${a.id}" ${state.selectedArtId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`)].join('');
  const routeOptions = [`<option value="all">Validar ruta (opcional)</option>`, ...routesByArt(state.selectedArtId).map(r => `<option value="${r.id}" ${state.selectedRouteId === r.id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`)].join('');
  const art = getArt(state.selectedArtId);

  const toolbar = `
    <div class="toolbar">
      <div class="filters">
        <select data-filter="selectedArtId">${artOptions}</select>
        <select data-filter="selectedRouteId">${routeOptions}</select>
      </div>
    </div>`;

  if (!art) {
    return `<section class="card">${toolbar}${renderEmpty('Elige un arte para ver su mapa de dependencias entre saberes.')}</section>`;
  }

  const artSkills = skillsByArt(art.id);
  if (!artSkills.length) {
    return `<section class="card">${toolbar}${renderEmpty('Esta arte no tiene saberes todavía. Crea algunos en la Biblioteca y define sus prerrequisitos.')}</section>`;
  }

  const { layers, cyclic, dependents } = topoLayers(artSkills);
  const treeLayers = orderedTreeLayers(layers);
  const route = getRoute(state.selectedRouteId);
  const validationBlock = route ? renderOrderingValidation(route) : '';
  const isTree = state.prereqViewMode === 'tree';

  const cyclesBlock = cyclic.length
    ? `<div class="card soft" style="margin-top:14px;border-color:#fecdd3"><strong>⚠️ Prerrequisitos en círculo</strong><p class="small muted" style="margin:6px 0 0">Estos saberes dependen entre sí en un ciclo y no se pueden ordenar. Revisa sus prerrequisitos: ${cyclic.map(s => escapeHtml(s.title)).join(', ')}.</p></div>`
    : '';

  const columns = layers.map((layer, i) => {
    const title = i === 0 ? '🌱 Base (sin prerrequisitos)' : `Capa ${i}`;
    const cards = layer.map(s => renderPrereqCard(s, dependents.get(s.id).length, 'board-card')).join('');
    return `
      <div class="board-col">
        <div class="board-col-head"><span>${title}</span><span class="badge">${layer.length}</span></div>
        <div class="board-col-body">${cards}</div>
      </div>`;
  }).join('');

  const treeColumns = treeLayers.map((layer, i) => {
    const title = i === 0 ? 'Base (sin prerrequisitos)' : `Capa ${i}`;
    const cards = layer.map(s => renderPrereqCard(s, dependents.get(s.id).length, 'prereq-node')).join('');
    return `
      <div class="prereq-level">
        <div class="prereq-level-head"><span>${title}</span><span class="badge">${layer.length}</span></div>
        <div class="prereq-level-nodes">${cards}</div>
      </div>`;
  }).join('');

  const viewSwitch = `
    <div class="row" style="margin-top:14px">
      <button class="btn small ${!isTree ? 'teal' : ''}" data-action="prereq-columns">Vista por capas</button>
      <button class="btn small ${isTree ? 'teal' : ''}" data-action="prereq-tree">Ver &aacute;rbol en pantalla completa</button>
    </div>`;

  const treeView = `
    <div class="prereq-presentation" aria-label="Vista de &aacute;rbol de prerrequisitos">
      <div class="prereq-presentation-bar">
        <div>
          <strong>&Aacute;rbol de prerrequisitos</strong>
          <p class="small muted" style="margin:3px 0 0">${escapeHtml(art.name)}${route ? ` - ${escapeHtml(route.name)}` : ''}</p>
        </div>
        <button class="btn small" data-action="prereq-columns">Salir y volver a capas</button>
      </div>
      <p class="small muted prereq-tree-help">Cada l&iacute;nea va desde el saber requisito hacia el saber que lo necesita. Las tarjetas est&aacute;n reordenadas por capa para que las uniones crucen menos.</p>
      <div class="prereq-tree-scroll" aria-label="&Aacute;rbol de prerrequisitos">
        <div class="prereq-tree">
          <svg class="prereq-branches" aria-hidden="true"></svg>
          ${treeColumns}
        </div>
      </div>
    </div>`;

  return `
    <section class="card">
      ${toolbar}
      ${viewSwitch}
      <p class="small muted" style="margin:0">Las dependencias fluyen de izquierda (se enseña primero) a derecha. Cada saber aparece después de todos sus prerrequisitos.</p>
    </section>
    ${validationBlock}
    ${cyclesBlock}
    ${isTree ? treeView : `<div class="board prereq-board">${columns}</div>`}
  `;
}

function renderPrereqCard(skill, dependentCount, className = 'prereq-node') {
  const prereqs = (skill.prerequisites || []).map(id => getSkill(id)?.title).filter(Boolean);
  return `
    <article class="${className}" data-skill-id="${escapeHtml(skill.id)}" data-component="${skill.component}">
      <div class="strong small">${escapeHtml(skill.title || 'Sin título')}</div>
      <div class="row small muted" style="gap:6px;margin-top:4px">${componentEmojis[skill.component] || ''} ${difficultyBadge(skill.difficulty)}</div>
      ${prereqs.length ? `<div class="small muted" style="margin-top:6px">↳ requiere: ${prereqs.map(escapeHtml).join(', ')}</div>` : ''}
      ${dependentCount ? `<div class="small muted" style="margin-top:2px">↦ habilita ${dependentCount} saber(es)</div>` : ''}
    </article>
  `;
}

function orderedTreeLayers(layers) {
  const order = new Map();
  return layers.map((layer, layerIndex) => {
    const arranged = [...layer].sort((a, b) => {
      const aPrereqs = (a.prerequisites || []).map(id => order.get(id)).filter(n => Number.isFinite(n));
      const bPrereqs = (b.prerequisites || []).map(id => order.get(id)).filter(n => Number.isFinite(n));
      const aAnchor = aPrereqs.length ? aPrereqs.reduce((sum, n) => sum + n, 0) / aPrereqs.length : Number.MAX_SAFE_INTEGER;
      const bAnchor = bPrereqs.length ? bPrereqs.reduce((sum, n) => sum + n, 0) / bPrereqs.length : Number.MAX_SAFE_INTEGER;
      if (aAnchor !== bAnchor) return aAnchor - bAnchor;
      const aPrereqCount = (a.prerequisites || []).length;
      const bPrereqCount = (b.prerequisites || []).length;
      if (aPrereqCount !== bPrereqCount) return bPrereqCount - aPrereqCount;
      return (a.title || '').localeCompare(b.title || '');
    });
    arranged.forEach((skill, index) => order.set(skill.id, index + (layerIndex * 0.01)));
    return arranged;
  });
}

function drawPrereqBranches() {
  const tree = document.querySelector('.prereq-tree');
  const svg = tree?.querySelector('.prereq-branches');
  if (!tree || !svg) return;

  const treeRect = tree.getBoundingClientRect();
  const nodes = [...tree.querySelectorAll('.prereq-node')];
  const nodesById = new Map(nodes.map(node => [node.dataset.skillId, node]));
  svg.setAttribute('width', tree.scrollWidth);
  svg.setAttribute('height', tree.scrollHeight);
  svg.setAttribute('viewBox', `0 0 ${tree.scrollWidth} ${tree.scrollHeight}`);

  const paths = [];
  nodes.forEach(node => {
    const skill = getSkill(node.dataset.skillId);
    (skill?.prerequisites || []).forEach(prereqId => {
      const source = nodesById.get(prereqId);
      if (!source) return;
      const a = source.getBoundingClientRect();
      const b = node.getBoundingClientRect();
      const x1 = a.right - treeRect.left;
      const y1 = a.top + a.height / 2 - treeRect.top;
      const x2 = b.left - treeRect.left;
      const y2 = b.top + b.height / 2 - treeRect.top;
      const bend = Math.max(34, (x2 - x1) * .46);
      paths.push(`<path d="M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}" />`);
    });
  });
  svg.innerHTML = paths.join('');
}

window.addEventListener('resize', () => {
  if (state.view === 'prereqs' && state.prereqViewMode === 'tree') requestAnimationFrame(drawPrereqBranches);
});

function renderOrderingValidation(route) {
  const issues = routeOrderingIssues(route);
  if (!issues.length) {
    return `<section class="card" style="margin-top:14px;border-color:#bbf7d0"><div class="row"><strong>✅ Orden correcto en ${escapeHtml(route.name)}</strong></div><p class="small muted" style="margin:6px 0 0">Cada saber de esta ruta viene después de sus prerrequisitos. Secuencia sana.</p></section>`;
  }
  const rows = issues.map(issue => issue.type === 'missing'
    ? `<li><strong>${escapeHtml(issue.expLabel)}</strong>: “${escapeHtml(issue.skill)}” requiere “${escapeHtml(issue.pre)}”, que <strong>no está en la ruta</strong>.</li>`
    : `<li><strong>${escapeHtml(issue.expLabel)}</strong>: “${escapeHtml(issue.skill)}” requiere “${escapeHtml(issue.pre)}”, que está más adelante en <strong>${escapeHtml(issue.preExpLabel)}</strong>.</li>`
  ).join('');
  return `
    <section class="card" style="margin-top:14px;border-color:#fed7aa">
      <div class="row-between"><h2 style="margin:0">⚠️ Revisar orden en ${escapeHtml(route.name)}</h2><span class="badge review">${issues.length} aviso(s)</span></div>
      <p class="small muted" style="margin:6px 0 12px">Estos saberes aparecen antes que sus prerrequisitos. Muévelos en el <strong>Tablero</strong> o ajusta los prerrequisitos en la Biblioteca.</p>
      <ul class="compare-cell-list">${rows}</ul>
    </section>
  `;
}

function renderExperiences() {
  const filtered = filteredExperiences();
  return `
    <section class="card">
      <div class="toolbar">
        <div class="filters">
          <input type="search" placeholder="Buscar experiencia..." value="${escapeHtml(state.filters.search)}" data-list-filter="search" />
          <select data-list-filter="artId">${filterArtOptions()}</select>
          <select data-list-filter="routeId">${filterRouteOptions()}</select>
          <select data-list-filter="status">
            <option value="active" ${state.filters.status === 'active' ? 'selected' : ''}>Activas</option>
            <option value="all" ${state.filters.status === 'all' ? 'selected' : ''}>Todas</option>
            <option value="draft" ${state.filters.status === 'draft' ? 'selected' : ''}>Borrador</option>
            <option value="review" ${state.filters.status === 'review' ? 'selected' : ''}>En revisión</option>
            <option value="published" ${state.filters.status === 'published' ? 'selected' : ''}>Publicadas</option>
            <option value="archived" ${state.filters.status === 'archived' ? 'selected' : ''}>Archivadas</option>
          </select>
        </div>
        <button class="btn primary" data-action="new-experience">Nueva experiencia</button>
      </div>
      ${filtered.length ? `<div class="grid cols-2">${filtered.map(renderExperienceCard).join('')}</div>` : renderEmpty('No encontré experiencias con esos filtros. Qué dramático, pero corregible.')}
    </section>
  `;
}

function filterArtOptions() {
  return [`<option value="all">Todas las artes</option>`, ...state.arts.map(a => `<option value="${a.id}" ${state.filters.artId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`)].join('');
}

function filterRouteOptions() {
  return [`<option value="all">Todas las rutas</option>`, ...routesByArt(state.filters.artId).map(r => `<option value="${r.id}" ${state.filters.routeId === r.id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`)].join('');
}

function filteredExperiences() {
  const search = state.filters.search.trim().toLowerCase();
  return state.experiences
    .filter(canSeeExperience)
    .filter(exp => state.filters.status === 'all' ? true : state.filters.status === 'active' ? exp.status !== 'archived' : exp.status === state.filters.status)
    .filter(exp => state.filters.artId === 'all' || exp.artId === state.filters.artId)
    .filter(exp => state.filters.routeId === 'all' || exp.routeId === state.filters.routeId)
    .filter(exp => {
      if (!search) return true;
      const haystack = [exp.name, exp.label, exp.description, exp.objective, exp.prerequisites, exp.evidence, exp.teacherNotes, exp.internalNotes, getArt(exp.artId)?.name, getRoute(exp.routeId)?.name].join(' ').toLowerCase();
      return haystack.includes(search);
    })
    .sort((a,b) => (a.order || 0) - (b.order || 0));
}

function renderExperienceEditor() {
  const d = state.draftExperience;
  const allowedRoutes = state.routes.filter(r => canEditRoute(r.id, r.artId));
  const artOptions = state.arts.map(a => `<option value="${a.id}" ${d.artId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('');
  const routeOptions = allowedRoutes.filter(r => !d.artId || r.artId === d.artId).map(r => `<option value="${r.id}" ${d.routeId === r.id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('');

  return `
    <div class="editor-layout">
      <form id="experience-form" class="card stack-lg">
        <div class="row-between">
          <h2>${d.id ? 'Editar experiencia' : 'Nueva experiencia'}</h2>
          <div class="row">
            <button class="btn" type="button" data-action="cancel-editor">Cancelar</button>
            <button class="btn primary" type="submit">Guardar</button>
          </div>
        </div>
        <div class="form-grid">
          <div class="form-field"><label>Arte</label><select data-draft="artId" required>${artOptions}</select></div>
          <div class="form-field"><label>Ruta</label><select data-draft="routeId" required>${routeOptions}</select></div>
          <div class="form-field"><label>Etiqueta / nivel</label><input data-draft="label" value="${escapeHtml(d.label)}" placeholder="Experiencia I" required /></div>
          <div class="form-field"><label>Nombre</label><input data-draft="name" value="${escapeHtml(d.name)}" placeholder="Escalas en primera posición" required /></div>
          <div class="form-field"><label>Orden</label><input data-draft="order" type="number" min="1" value="${escapeHtml(d.order || 1)}" required /></div>
          <div class="form-field"><label>Dificultad</label><select data-draft="difficulty">${Object.entries(difficultyLabels).map(([key, label]) => `<option value="${key}" ${d.difficulty === key ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
          <div class="form-field"><label>Duración estimada</label><input data-draft="estimatedDuration" value="${escapeHtml(d.estimatedDuration)}" placeholder="4 a 6 clases" /></div>
          <div class="form-field"><label>Edad / etapa sugerida</label><input data-draft="suggestedAge" value="${escapeHtml(d.suggestedAge)}" placeholder="Infantil, juvenil, adulto..." /></div>
        </div>
        <div class="form-field"><label>Descripción</label><textarea data-draft="description" placeholder="Resumen corto de la experiencia">${escapeHtml(d.description)}</textarea></div>
        <div class="form-field"><label>Objetivo general</label><textarea data-draft="objective" placeholder="Qué debe lograr el estudiante">${escapeHtml(d.objective)}</textarea></div>
        <div class="form-grid">
          <div class="form-field"><label>Experiencias previas requeridas</label>${renderPrerequisiteExperiencePicker()}</div>
          <div class="form-field"><label>Prerrequisitos / notas</label><textarea data-draft="prerequisites" placeholder="Qué debería dominar antes">${escapeHtml(d.prerequisites)}</textarea></div>
          <div class="form-field"><label>Evidencias de logro</label><textarea data-draft="evidence" placeholder="Cómo sabemos que puede avanzar">${escapeHtml(d.evidence)}</textarea></div>
        </div>
        <div class="form-grid">
          <div class="form-field"><label>Recomendaciones docentes</label><textarea data-draft="teacherNotes" placeholder="Tips de enseñanza, advertencias, secuencia sugerida">${escapeHtml(d.teacherNotes)}</textarea></div>
          <div class="form-field"><label>Observaciones internas</label><textarea data-draft="internalNotes" placeholder="Notas internas de coordinación">${escapeHtml(d.internalNotes)}</textarea></div>
        </div>
        <div class="form-field"><label>Estado</label><select data-draft="status">${Object.entries(statusLabels).map(([key, label]) => `<option value="${key}" ${d.status === key ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
      </form>
      <aside class="stack-lg">
        ${renderComponentsEditor()}
        ${renderResourcesEditor()}
      </aside>
    </div>
  `;
}

function renderPrerequisiteExperiencePicker() {
  const d = state.draftExperience;
  const options = priorExperiencesForDraft(d);
  if (!d.routeId) return `<p class="small muted">Elige una ruta para ver experiencias previas disponibles.</p>`;
  if (!options.length) return `<p class="small muted">Esta es la primera experiencia de la ruta, así que no hay experiencias previas para marcar como prerrequisito.</p>`;
  const selected = new Set(d.prerequisiteExperienceIds || []);
  return `
    <div class="prereq-list">
      ${options.map(exp => `
        <label class="prereq-option">
          <input type="checkbox" data-experience-prereq="${exp.id}" ${selected.has(exp.id) ? 'checked' : ''} />
          <span>${escapeHtml(experienceLabel(exp))}</span>
        </label>
      `).join('')}
    </div>
  `;
}

function renderComponentsEditor() {
  const d = state.draftExperience;
  const refs = d.skillRefs || [];
  const usedIds = new Set(refs.map(r => r.skillId));
  const usedBeforeIds = skillIdsUsedBeforeDraft(d);
  const route = getRoute(d.routeId);
  const available = (route ? skillsByRoute(route) : skillsByArt(d.artId))
    .filter(s => !usedIds.has(s.id) && !usedBeforeIds.has(s.id));

  const selected = refs.length
    ? resolveSkillRefs(refs).map(({ ref, skill }, index) => renderSkillRefRow(ref, skill, index, refs.length)).join('')
    : `<p class="muted small">Aún no agregas saberes. Elige de la biblioteca de abajo para armar este nivel.</p>`;

  const availableGrouped = activeComponentKeys().map(key => {
    const items = available.filter(s => s.component === key);
    if (!items.length) return '';
    return `
      <div class="component-editor" data-component="${key}">
        <h3 style="margin:0 0 8px">${componentEmojis[key]} ${componentLabels[key]}</h3>
        <div class="stack" style="gap:8px">
          ${items.map(s => `
            <div class="skill-pick">
              <div style="min-width:0">
                <div class="strong" style="overflow:hidden;text-overflow:ellipsis">${escapeHtml(s.title)}</div>
                <div class="small muted">${escapeHtml(difficultyLabels[s.difficulty] || '')}</div>
              </div>
              <button type="button" class="btn small teal" data-action="add-skill-ref" data-id="${s.id}">+ Agregar</button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');

  const availableBlock = !d.artId
    ? `<p class="muted small">Elige primero un arte arriba.</p>`
    : (available.length
      ? availableGrouped
      : `<p class="muted small">No hay más saberes disponibles para esta ruta. ${(route ? skillsByRoute(route) : skillsByArt(d.artId)).length ? 'Los saberes de experiencias previas ya quedan reservados y no se repiten en este nivel.' : 'Crea saberes en la <strong>Biblioteca</strong> primero y asígnalos a esta ruta.'}</p>`);

  return `
    <section class="card stack">
      <div class="row-between">
        <h2>Saberes de este nivel</h2>
        <span class="badge">${refs.length} en el nivel</span>
      </div>
      <p class="small muted" style="margin:0">Arma la experiencia eligiendo saberes de la biblioteca. Ordénalos en la secuencia que se enseñan.</p>
      <div class="stack" style="gap:10px">${selected}</div>
      <details ${available.length ? 'open' : ''}>
        <summary class="strong" style="cursor:pointer;margin-top:6px">➕ Agregar saberes de la biblioteca</summary>
        <div class="stack" style="margin-top:12px">${availableBlock}</div>
      </details>
    </section>
  `;
}

function renderSkillRefRow(ref, skill, index, total) {
  const category = skillCategory(skill);
  return `
    <div class="skill-ref" data-component="${skill.component}">
      <div class="skill-ref-head">
        <div style="min-width:0">
          <div class="strong" style="overflow:hidden;text-overflow:ellipsis">${escapeHtml(skill.title)}</div>
          <div class="small muted">${componentEmojis[skill.component] || ''} ${escapeHtml(componentLabels[skill.component] || '')}${category ? ` · ${escapeHtml(category)}` : ''} · ${escapeHtml(difficultyLabels[skill.difficulty] || '')}</div>
        </div>
        <div class="row" style="gap:6px">
          <button type="button" class="btn small" data-action="move-skill-ref" data-id="${skill.id}" data-dir="up" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="btn small" data-action="move-skill-ref" data-id="${skill.id}" data-dir="down" ${index === total - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="btn small teal" data-action="edit-skill" data-id="${skill.id}">Editar saber</button>
          <button type="button" class="btn small danger" data-action="remove-skill-ref" data-id="${skill.id}">Quitar del mapa</button>
        </div>
      </div>
      <input data-skillref-note="${skill.id}" value="${escapeHtml(ref.note || '')}" placeholder="Nota para este nivel (opcional): énfasis, variación, tempo..." />
    </div>
  `;
}

function renderResourcesEditor() {
  const resources = state.draftExperience.resources || [];
  return `
    <section class="card stack">
      <div class="row-between">
        <h2>Recursos</h2>
        <button type="button" class="btn small" data-action="add-resource">Agregar recurso</button>
      </div>
      ${resources.length ? resources.map((r, i) => renderResourceItem(r, i)).join('') : `<p class="muted small">Puedes agregar enlaces a partituras, PDFs, videos o materiales.</p>`}
    </section>
  `;
}

function renderResourceItem(resource, index) {
  return `
    <div class="resource-item">
      <div class="form-field"><label>Título</label><input data-resource-field="title" data-index="${index}" value="${escapeHtml(resource.title)}" /></div>
      <div class="form-field"><label>Tipo</label><select data-resource-field="type" data-index="${index}">
        ${['link','pdf','video','imagen','partitura','audio','otro'].map(t => `<option value="${t}" ${resource.type === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select></div>
      <div class="form-field"><label>URL</label><input data-resource-field="url" data-index="${index}" value="${escapeHtml(resource.url)}" placeholder="https://..." /></div>
      <button type="button" class="btn danger small" data-action="remove-resource" data-index="${index}">Quitar</button>
    </div>
  `;
}

function renderCompare() {
  const artOptions = [`<option value="all">Elige arte</option>`, ...state.arts.map(a => `<option value="${a.id}" ${state.selectedArtId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`)].join('');
  const routeOptions = [`<option value="all">Elige ruta</option>`, ...routesByArt(state.selectedArtId).map(r => `<option value="${r.id}" ${state.selectedRouteId === r.id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`)].join('');
  const route = getRoute(state.selectedRouteId);
  const exps = route ? experiencesByRoute(route.id).filter(canSeeExperience) : [];
  return `
    <section class="card">
      <div class="toolbar">
        <div class="filters">
          <select data-filter="selectedArtId">${artOptions}</select>
          <select data-filter="selectedRouteId">${routeOptions}</select>
        </div>
      </div>
      ${route && exps.length ? renderCompareTable(exps) : renderEmpty('Elige una ruta con experiencias para comparar componentes. Sin ruta no hay comparación, escandaloso pero lógico.')}
    </section>
  `;
}

function renderCompareTable(exps) {
  const rows = ['tecnica','teorico','repertorio','creativo'];
  return `
    <div class="table-wrap">
      <table class="compare-table">
        <thead><tr><th>Componente</th>${exps.map(exp => `<th>${escapeHtml(exp.label)}<br><span class="small muted">${escapeHtml(exp.name)}</span></th>`).join('')}</tr></thead>
        <tbody>
          ${rows.map(row => `<tr><th>${componentEmojis[row]} ${componentLabels[row]}</th>${exps.map(exp => `<td class="compare-cell" data-move-target="${exp.id}" data-component="${row}">${renderCompareCell(experienceComponentItems(exp, row), exp, exps)}</td>`).join('')}</tr>`).join('')}
          <tr><th>Objetivo</th>${exps.map(exp => `<td>${escapeHtml(exp.objective || 'Sin objetivo')}</td>`).join('')}</tr>
          <tr><th>Evidencia</th>${exps.map(exp => `<td>${escapeHtml(exp.evidence || 'Sin evidencia')}</td>`).join('')}</tr>
        </tbody>
      </table>
    </div>
  `;
}

function renderCompareCell(items, exp, exps = []) {
  const canMove = exp ? canEditExperience(exp) : false;
  if (!items.length) return '<span class="muted">Sin saberes</span>';
  return `<ul class="compare-cell-list">${items.map(item => {
    const movable = canMove && item.skillId;
    const targets = movable ? exps.filter(other => other.id !== exp.id && canEditExperience(other)) : [];
    return `
      <li class="compare-item ${movable ? 'movable' : ''}" ${movable ? `draggable="true" data-move-skill="${item.skillId}" data-move-source="${exp.id}"` : ''}>
        <strong>${escapeHtml(item.title || 'Sin título')}</strong>
        ${item.achievement ? `<br><span class="small muted">${escapeHtml(item.achievement)}</span>` : ''}
        ${item.note ? `<br><span class="small muted">📝 ${escapeHtml(item.note)}</span>` : ''}
        ${targets.length ? `
          <select class="compare-move-select" data-move-skill-id="${item.skillId}" data-move-from="${exp.id}" title="Mover este saber a otra experiencia">
            <option value="">↔ Mover a…</option>
            ${targets.map(other => `<option value="${other.id}">${escapeHtml(other.label || other.name)}</option>`).join('')}
          </select>` : ''}
      </li>`;
  }).join('')}</ul>`;
}

function renderStructure() {
  if (!hasRole('admin')) return renderNoAccess();
  const editingArt = state.editingArtId ? getArt(state.editingArtId) : null;
  const editingRoute = state.editingRouteId ? getRoute(state.editingRouteId) : null;
  return `
    <div class="grid cols-2">
      <section class="card stack">
        <div class="row-between">
          <h2>${editingArt ? 'Editar arte' : 'Crear arte'}</h2>
          ${editingArt ? `<button class="btn small ghost" type="button" data-action="cancel-art-editor">Cancelar</button>` : ''}
        </div>
        <form id="art-form" class="stack">
          <div class="form-field"><label>Nombre del arte</label><input name="name" required placeholder="Música, Danza, Teatro..." value="${escapeHtml(editingArt?.name || '')}" /></div>
          <div class="form-field"><label>Descripción</label><textarea name="description" placeholder="Descripción breve">${escapeHtml(editingArt?.description || '')}</textarea></div>
          <div class="form-field"><label>Orden</label><input name="order" type="number" min="1" value="${escapeHtml(editingArt?.order || state.arts.length + 1)}" /><p class="small muted" style="margin:0">Define en qué posición aparece esta arte en menús y listados. 1 aparece primero.</p></div>
          <button class="btn primary" type="submit">${editingArt ? 'Guardar cambios' : 'Crear arte'}</button>
        </form>
      </section>
      <section class="card stack">
        <div class="row-between">
          <h2>${editingRoute ? 'Editar ruta' : 'Crear ruta'}</h2>
          ${editingRoute ? `<button class="btn small ghost" type="button" data-action="cancel-route-editor">Cancelar</button>` : ''}
        </div>
        <form id="route-form" class="stack">
          <div class="form-field"><label>Arte</label><select name="artId" required>${state.arts.map(a => `<option value="${a.id}" ${editingRoute?.artId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}</select></div>
          <div class="form-field"><label>Nombre de la ruta</label><input name="name" required placeholder="Piano, Guitarra, Dibujo..." value="${escapeHtml(editingRoute?.name || '')}" /></div>
          <div class="form-field"><label>Descripción</label><textarea name="description" placeholder="Descripción breve">${escapeHtml(editingRoute?.description || '')}</textarea></div>
          <div class="form-field"><label>Orden</label><input name="order" type="number" min="1" value="${escapeHtml(editingRoute?.order || state.routes.length + 1)}" /><p class="small muted" style="margin:0">Define en qué posición aparece esta ruta dentro del arte. 1 aparece primero.</p></div>
          <button class="btn teal" type="submit">${editingRoute ? 'Guardar cambios' : 'Crear ruta'}</button>
        </form>
      </section>
    </div>
    <section class="card" style="margin-top:18px">
      <h2>Artes y rutas existentes</h2>
      ${state.arts.length ? state.arts.sort((a,b)=>(a.order||0)-(b.order||0)).map(a => `
        <div class="card soft" style="margin-top:12px">
          <div class="row-between">
            <div><h3>${escapeHtml(a.name)}</h3><p class="muted" style="margin:0">${escapeHtml(a.description || 'Sin descripción')}</p></div>
            <div class="row">
              <span class="badge">Orden ${escapeHtml(a.order || 0)}</span>
              <button class="btn small" type="button" data-action="edit-art" data-id="${a.id}">Editar</button>
              <button class="btn small danger" type="button" data-action="delete-art" data-id="${a.id}">Eliminar</button>
            </div>
          </div>
          <div class="grid cols-3" style="margin-top:12px">${state.routes.filter(r => r.artId === a.id).sort((x,y)=>(x.order||0)-(y.order||0)).map(r => `<div class="stat-card stack"><div class="row-between"><div><div class="strong">${escapeHtml(r.name)}</div><div class="small muted">${escapeHtml(r.description || 'Sin descripción')}</div></div><span class="badge">Orden ${escapeHtml(r.order || 0)}</span></div><div class="small muted">${experiencesByRoute(r.id).length} experiencia(s)</div><div class="row"><button class="btn small" type="button" data-action="edit-route" data-id="${r.id}">Editar</button><button class="btn small danger" type="button" data-action="delete-route" data-id="${r.id}">Eliminar</button></div></div>`).join('') || '<p class="muted">Sin rutas todavía.</p>'}</div>
        </div>
      `).join('') : renderEmpty('No hay artes creadas.')}
    </section>
  `;
}
function renderTeachers() {
  if (!hasRole('admin')) return renderNoAccess();
  const artChecks = state.arts.map(a => `<label class="row"><input type="checkbox" name="allowedArts" value="${a.id}" /> ${escapeHtml(a.name)}</label>`).join('');
  const routeChecks = state.routes.map(r => `<label class="row"><input type="checkbox" name="allowedRoutes" value="${r.id}" /> ${escapeHtml(getArt(r.artId)?.name || '')} · ${escapeHtml(r.name)}</label>`).join('');
  return `
    <div class="grid cols-2">
      <section class="card stack">
        <h2>Invitar docente</h2>
        <form id="invite-form" class="stack">
          <div class="form-field"><label>Nombre</label><input name="name" required placeholder="Nombre docente" /></div>
          <div class="form-field"><label>Correo</label><input name="email" type="email" required placeholder="docente@correo.com" /></div>
          <div class="form-field"><label>Rol</label><select name="role">
            <option value="docente_editor">Docente editor</option>
            <option value="docente_lector">Docente lector</option>
            <option value="coordinador">Coordinador</option>
            <option value="admin">Admin</option>
          </select></div>
          <div class="card soft stack">
            <div class="row-between"><strong>Artes permitidas</strong><label class="row"><input type="checkbox" name="allArts" /> Todas</label></div>
            <div class="stack small">${artChecks || '<span class="muted">Crea artes primero.</span>'}</div>
          </div>
          <div class="card soft stack">
            <div class="row-between"><strong>Rutas permitidas</strong><label class="row"><input type="checkbox" name="allRoutes" /> Todas</label></div>
            <div class="stack small">${routeChecks || '<span class="muted">Crea rutas primero.</span>'}</div>
          </div>
          <button class="btn primary" type="submit">Guardar invitación</button>
          <p class="small muted">Después el docente entra a “Crear cuenta” con ese mismo correo. Sí, toca ese paso; Firebase no lee mentes todavía.</p>
        </form>
      </section>
      <section class="card stack">
        <h2>Invitaciones</h2>
        ${state.invites.length ? state.invites.map(inv => `<div class="experience-card"><div class="row-between"><div><strong>${escapeHtml(inv.name)}</strong><div class="small muted">${escapeHtml(inv.email)}</div></div>${roleBadge(inv.role)}</div><div class="small muted">Artes: ${(inv.allowedArts || []).join(', ') || 'Ninguna'}<br>Rutas: ${(inv.allowedRoutes || []).join(', ') || 'Ninguna'}</div></div>`).join('') : renderEmpty('No hay invitaciones guardadas.')}
        <h2>Usuarios activos</h2>
        ${state.users.length ? state.users.map(user => `<div class="experience-card"><div class="row-between"><div><strong>${escapeHtml(user.name || user.email)}</strong><div class="small muted">${escapeHtml(user.email)}</div></div>${roleBadge(user.role)}</div><div class="small muted">Activo: ${user.active === false ? 'No' : 'Sí'}</div></div>`).join('') : renderEmpty('No hay usuarios creados todavía.')}
      </section>
    </div>
  `;
}

function renderLogs() {
  const logs = state.logs.slice(0, 100);
  return `
    <section class="card">
      ${logs.length ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Detalle</th></tr></thead><tbody>${logs.map(log => `<tr><td>${formatDate(log.createdAt)}</td><td>${escapeHtml(log.userEmail || log.userId || 'Sistema')}</td><td>${escapeHtml(log.action)}</td><td>${escapeHtml(log.entityType)}<br><span class="small muted">${escapeHtml(log.entityId || '')}</span></td><td>${escapeHtml(log.summary || '')}</td></tr>`).join('')}</tbody></table></div>` : renderEmpty('Todavía no hay historial. El pasado está limpio, sospechosamente limpio.')}
    </section>
  `;
}

function renderSettings() {
  return `
    <div class="grid cols-2">
      <section class="card stack">
        <h2>Estado técnico</h2>
        <p><strong>Modo actual:</strong> ${state.mode === 'demo' ? 'Demo local con localStorage' : 'Firebase conectado'}</p>
        <p class="muted">Para conectar Firebase pega tu configuración real en <code>js/firebaseConfig.js</code>, activa Email/Password y publica las reglas de <code>firestore.rules</code>.</p>
        <div class="row">
          <button class="btn primary" data-action="open-report">📄 Informe para IA</button>
          <button class="btn" data-action="export-json">Exportar JSON</button>
          ${state.mode === 'demo' ? `<button class="btn danger" data-action="reset-demo">Reiniciar demo</button>` : ''}
        </div>
      </section>
      <section class="card soft stack">
        <h2>Admins iniciales</h2>
        ${ADMIN_EMAILS.map(email => `<div class="hero-pill">🔐 ${escapeHtml(email)}</div>`).join('')}
        <p class="small muted">Estos correos quedan reconocidos como admin en la app y también en las reglas sugeridas de Firestore.</p>
      </section>
    </div>
    ${hasRole('admin') ? renderComponentCatalogSettings() : ''}
    ${hasRole('admin') ? renderCategoryCatalogSettings() : ''}
  `;
}

function renderComponentCatalogSettings() {
  return `
    <section class="card stack" style="margin-top:18px">
      <div class="row-between">
        <div>
          <h2>Componentes de la biblioteca</h2>
          <p class="small muted" style="margin:4px 0 0">Edita o elimina componentes de la lista que aparece al crear o editar saberes.</p>
        </div>
        <button class="btn small" type="button" data-action="reset-component-catalog">Restaurar base</button>
      </div>
      <form id="component-catalog-form" class="stack">
        <div class="component-catalog-grid">
          ${componentKeys().map(key => `
            <div class="component-catalog-row ${isComponentActive(key) ? '' : 'is-inactive'}" data-component="${key}">
              <div>
                <div class="small muted">${escapeHtml(key)}</div>
                ${isComponentActive(key) ? '' : '<span class="badge">Eliminado</span>'}
              </div>
              <div class="form-field">
                <label>Icono</label>
                <input data-component-setting="emoji" data-component-key="${key}" value="${escapeHtml(componentEmojis[key] || '')}" maxlength="4" ${isComponentActive(key) ? '' : 'disabled'} />
              </div>
              <div class="form-field">
                <label>Nombre visible</label>
                <input data-component-setting="label" data-component-key="${key}" value="${escapeHtml(componentLabels[key] || '')}" ${isComponentActive(key) ? 'required' : 'disabled'} />
              </div>
              <button class="btn small ${isComponentActive(key) ? 'danger' : 'teal'}" type="button" data-action="${isComponentActive(key) ? 'delete-component-catalog-item' : 'restore-component-catalog-item'}" data-id="${key}">
                ${isComponentActive(key) ? 'Eliminar' : 'Reactivar'}
              </button>
              ${!isComponentActive(key) ? `<button class="btn small danger" type="button" data-action="purge-component-catalog-item" data-id="${key}">Eliminar definitivamente</button>` : ''}
            </div>
          `).join('')}
        </div>
        <button class="btn primary" type="submit">Guardar componentes</button>
      </form>
    </section>
  `;
}

function renderCategoryCatalogSettings() {
  const componentOptions = activeComponentKeys()
    .map(key => `<option value="${key}">${componentEmojis[key]} ${componentLabels[key]}</option>`)
    .join('');
  const items = categoryCatalogItems();
  const rows = items.length
    ? items.map(item => {
      const used = state.skills.filter(skill => skill.component === item.component && duplicateKey(skillCategory(skill)) === duplicateKey(item.name)).length;
      return `
        <div class="category-catalog-row ${item.active ? '' : 'is-inactive'}" data-component="${item.component}">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <div class="small muted">${componentEmojis[item.component] || ''} ${escapeHtml(componentLabels[item.component] || item.component)}${item.derived ? ' · detectada en saberes existentes' : ''}</div>
          </div>
          <span class="badge">${used} saber(es)</span>
          <button class="btn small ${item.active ? 'danger' : 'teal'}" type="button" data-action="${item.active ? 'delete-category-catalog-item' : 'restore-category-catalog-item'}" data-id="${escapeHtml(item.id)}" data-component-key="${item.component}" data-name="${escapeHtml(item.name)}">
            ${item.active ? 'Eliminar' : 'Reactivar'}
          </button>
          ${!item.active && !item.derived ? `<button class="btn small danger" type="button" data-action="purge-category-catalog-item" data-component-key="${item.component}" data-name="${escapeHtml(item.name)}">Eliminar definitivamente</button>` : ''}
        </div>
      `;
    }).join('')
    : '<p class="muted small">Aún no hay categorías. Crea las primeras para ordenar la biblioteca.</p>';

  return `
    <section class="card stack" style="margin-top:18px">
      <div>
        <h2>Categorías de saberes</h2>
        <p class="small muted" style="margin:4px 0 0">Estas opciones aparecen en el desplegable Categoría al crear o editar saberes.</p>
      </div>
      <form id="category-catalog-form" class="category-catalog-form">
        <div class="form-field">
          <label>Componente</label>
          <select name="component" required>${componentOptions}</select>
        </div>
        <div class="form-field">
          <label>Nueva categoría</label>
          <input name="name" placeholder="Ej: Postura, Escalas, Lectura rítmica" required />
        </div>
        <button class="btn primary" type="submit">Agregar categoría</button>
      </form>
      <div class="category-catalog-list">${rows}</div>
    </section>
  `;
}

function renderModal() {
  if (state.modal?.type === 'report') return renderReportModal();
  if (state.modal?.type === 'experience') {
    const exp = getExperience(state.modal.id);
    if (!exp) return '';
    const resources = exp.resources || [];
    const prereqExperienceNames = prerequisiteExperienceNames(exp.prerequisiteExperienceIds || []);
    return `
      <div class="modal-backdrop" data-action="close-modal">
        <article class="modal" onclick="event.stopPropagation()">
          <div class="row-between">
            <div>
              <h2>${escapeHtml(exp.label)} · ${escapeHtml(exp.name)}</h2>
              <p class="muted" style="margin-top:4px">${escapeHtml(getArt(exp.artId)?.name || '')} › ${escapeHtml(getRoute(exp.routeId)?.name || '')}</p>
            </div>
            <button class="btn" data-action="close-modal">Cerrar</button>
          </div>
          <div class="row" style="margin:12px 0">${statusBadge(exp.status)}${difficultyBadge(exp.difficulty)}</div>
          <p>${escapeHtml(exp.description || '')}</p>
          <h3>Objetivo</h3><p>${escapeHtml(exp.objective || 'Sin objetivo')}</p>
          <div class="grid cols-2">
            <div><h3>Prerrequisitos</h3><p class="muted">${escapeHtml([prereqExperienceNames.length ? `Experiencias previas: ${prereqExperienceNames.join(', ')}` : '', exp.prerequisites || ''].filter(Boolean).join(' · ') || 'Sin prerrequisitos')}</p></div>
            <div><h3>Evidencias</h3><p class="muted">${escapeHtml(exp.evidence || 'Sin evidencias')}</p></div>
          </div>
          ${Object.entries(componentLabels).map(([key, label]) => `<h3>${componentEmojis[key]} ${label}</h3>${renderCompareCell(experienceComponentItems(exp, key))}`).join('')}
          <h3>Recursos</h3>
          ${resources.length ? resources.map(r => `<p>🔗 <a href="${escapeHtml(r.url)}" target="_blank" rel="noreferrer">${escapeHtml(r.title || r.url)}</a> <span class="small muted">${escapeHtml(r.type || '')}</span></p>`).join('') : '<p class="muted">Sin recursos.</p>'}
          ${canEditExperience(exp) ? `<button class="btn teal" data-action="edit-experience" data-id="${exp.id}">Editar experiencia</button>` : ''}
        </article>
      </div>
    `;
  }
  return '';
}

function renderNoAccess() {
  return `<section class="card">${renderEmpty('No tienes acceso a esta sección. Cruel, pero sano para la seguridad.')}</section>`;
}

function renderEmpty(text) {
  return `<div class="empty-state">${escapeHtml(text)}</div>`;
}

function bindAuthEvents() {
  $('#google-signin')?.addEventListener('click', async () => {
    try {
      await services.auth.loginWithGoogle();
      toast('Entrada correcta. El mapa curricular sobrevivió otro día.');
    } catch (error) {
      console.error(error);
      toast(error.message || 'No se pudo autenticar.', 'error');
    }
  });
}

function bindShellEvents() {
  $$('[data-view]').forEach(btn => btn.addEventListener('click', () => {
    state.view = btn.dataset.view;
    state.mobileMenu = false;
    state.draftExperience = null;
    state.editingExperienceId = null;
    render();
  }));

  $$('[data-action]').forEach(el => el.addEventListener('click', handleAction));
  $$('[data-filter]').forEach(el => el.addEventListener('change', handleMainFilter));
  $$('[data-list-filter]').forEach(el => el.addEventListener('input', handleListFilter));
  $$('[data-list-filter]').forEach(el => el.addEventListener('change', handleListFilter));
  $$('[data-library-filter]').forEach(el => el.addEventListener('input', handleLibraryFilter));
  $$('[data-library-filter]').forEach(el => el.addEventListener('change', handleLibraryFilter));
  $$('[data-skill]').forEach(el => el.addEventListener('input', handleSkillDraftChange));
  $$('[data-skill]').forEach(el => el.addEventListener('change', handleSkillDraftChange));
  $$('[data-skill-route]').forEach(el => el.addEventListener('change', handleSkillRouteToggle));
  $$('[data-skill-prereq]').forEach(el => el.addEventListener('change', handleSkillPrereqToggle));
  $$('[data-draft]').forEach(el => {
    el.addEventListener('input', handleDraftChange);
    el.addEventListener('change', handleDraftChange);
  });
  $$('[data-skillref-note]').forEach(el => el.addEventListener('input', handleSkillRefNote));
  $$('[data-report]').forEach(el => el.addEventListener('change', handleReportConfigChange));

  // Drag & drop del tablero de armado.
  $$('.board-card[draggable="true"]').forEach(card => {
    card.addEventListener('dragstart', () => {
      boardDrag = { skillId: card.dataset.skillId, source: card.dataset.source };
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  });
  $$('.board-col').forEach(col => {
    col.addEventListener('dragover', event => { event.preventDefault(); col.classList.add('drop-hover'); });
    col.addEventListener('dragleave', () => col.classList.remove('drop-hover'));
    col.addEventListener('drop', async event => {
      event.preventDefault();
      col.classList.remove('drop-hover');
      await handleBoardDrop(col.dataset.target);
    });
  });
  // Mover saberes entre experiencias desde el comparador de ruta.
  $$('.compare-item.movable').forEach(item => {
    item.addEventListener('dragstart', event => {
      compareDrag = { skillId: item.dataset.moveSkill, source: item.dataset.moveSource };
      item.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
  });
  $$('td.compare-cell').forEach(cell => {
    cell.addEventListener('dragover', event => {
      if (!compareDrag || compareDrag.source === cell.dataset.moveTarget) return;
      event.preventDefault();
      cell.classList.add('drop-hover');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('drop-hover'));
    cell.addEventListener('drop', async event => {
      event.preventDefault();
      cell.classList.remove('drop-hover');
      const drag = compareDrag;
      compareDrag = null;
      if (!drag) return;
      await moveSkillBetweenExperiences(drag.skillId, drag.source, cell.dataset.moveTarget);
    });
  });
  $$('.compare-move-select').forEach(select => {
    select.addEventListener('change', async event => {
      const targetId = event.currentTarget.value;
      if (!targetId) return;
      await moveSkillBetweenExperiences(event.currentTarget.dataset.moveSkillId, event.currentTarget.dataset.moveFrom, targetId);
    });
  });
  $$('[data-resource-field]').forEach(el => el.addEventListener('input', handleResourceDraftChange));
  $$('[data-resource-field]').forEach(el => el.addEventListener('change', handleResourceDraftChange));
  $$('[data-experience-prereq]').forEach(el => el.addEventListener('change', handleExperiencePrereqToggle));

  $('#experience-form')?.addEventListener('submit', saveExperience);
  $('#skill-form')?.addEventListener('submit', saveSkill);
  $('#art-form')?.addEventListener('submit', saveArt);
  $('#route-form')?.addEventListener('submit', saveRoute);
  $('#invite-form')?.addEventListener('submit', saveInvite);
  $('#component-catalog-form')?.addEventListener('submit', saveComponentCatalog);
  $('#category-catalog-form')?.addEventListener('submit', saveCategoryCatalogItem);
}

async function handleAction(event) {
  const action = event.currentTarget.dataset.action;
  const id = event.currentTarget.dataset.id;
  const routeId = event.currentTarget.dataset.routeId;
  try {
    if (action === 'toggle-menu') { state.mobileMenu = !state.mobileMenu; render(); }
    if (action === 'logout') await services.auth.logout();
    if (action === 'prereq-columns') { state.prereqViewMode = 'columns'; render(); }
    if (action === 'prereq-tree') { state.prereqViewMode = 'tree'; render(); }
    if (action === 'new-experience') startNewExperience(routeId);
    if (action === 'edit-experience') startEditExperience(id);
    if (action === 'delete-experience') await deleteExperience(id);
    if (action === 'view-experience') { state.modal = { type: 'experience', id }; render(); }
    if (action === 'close-modal') { state.modal = null; render(); }
    if (action === 'cancel-editor') { state.draftExperience = null; state.editingExperienceId = null; render(); }
    if (action === 'new-skill') startNewSkill();
    if (action === 'toggle-skill-details') toggleSkillDetails(id);
    if (action === 'edit-skill') startEditSkill(id);
    if (action === 'delete-skill') await deleteSkill(id);
    if (action === 'edit-art') startEditArt(id);
    if (action === 'delete-art') await deleteArt(id);
    if (action === 'cancel-art-editor') cancelArtEditor();
    if (action === 'edit-route') startEditRoute(id);
    if (action === 'delete-route') await deleteRoute(id);
    if (action === 'cancel-route-editor') cancelRouteEditor();
    if (action === 'cancel-skill-editor') cancelSkillEditor();
    if (action === 'add-skill-ref') addSkillRef(id);
    if (action === 'remove-skill-ref') removeSkillRef(id);
    if (action === 'move-skill-ref') moveSkillRef(id, event.currentTarget.dataset.dir);
    if (action === 'add-resource') addResource();
    if (action === 'remove-resource') removeResource(Number(event.currentTarget.dataset.index));
    if (action === 'export-json') exportJson();
    if (action === 'open-report') openReportModal();
    if (action === 'report-preset') setReportPreset(id);
    if (action === 'download-report') downloadReport();
    if (action === 'copy-report') await copyReport();
    if (action === 'delete-component-catalog-item') deleteComponentCatalogItem(id);
    if (action === 'restore-component-catalog-item') restoreComponentCatalogItem(id);
    if (action === 'purge-component-catalog-item') purgeComponentCatalogItem(id);
    if (action === 'delete-category-catalog-item') deleteCategoryCatalogItem(event.currentTarget.dataset.componentKey, event.currentTarget.dataset.name);
    if (action === 'restore-category-catalog-item') restoreCategoryCatalogItem(event.currentTarget.dataset.componentKey, event.currentTarget.dataset.name);
    if (action === 'purge-category-catalog-item') purgeCategoryCatalogItem(event.currentTarget.dataset.componentKey, event.currentTarget.dataset.name);
    if (action === 'reset-component-catalog') resetComponentCatalog();
    if (action === 'reset-demo') resetDemo();
  } catch (error) {
    console.error(error);
    toast(error.message || 'Algo falló. Qué raro, un sistema fallando.', 'error');
  }
}

function toggleSkillDetails(id) {
  if (!id) return;
  if (state.expandedSkillIds.has(id)) state.expandedSkillIds.delete(id);
  else state.expandedSkillIds.add(id);
  render();
}

function handleMainFilter(event) {
  const key = event.currentTarget.dataset.filter;
  state[key] = event.currentTarget.value;
  if (key === 'selectedArtId') state.selectedRouteId = 'all';
  render();
}

function handleListFilter(event) {
  const key = event.currentTarget.dataset.listFilter;
  state.filters[key] = event.currentTarget.value;
  if (key === 'artId') state.filters.routeId = 'all';
  render();
}

function handleLibraryFilter(event) {
  const key = event.currentTarget.dataset.libraryFilter;
  const isSearch = key === 'search';
  const active = document.activeElement;
  state.libraryFilters[key] = event.currentTarget.value;
  if (key === 'artId') state.libraryFilters.routeId = 'all';
  if (key === 'artId' || key === 'component') state.libraryFilters.category = 'all';
  render();
  // Mantener el foco y el cursor en el buscador tras re-render.
  if (isSearch) {
    const input = $('[data-library-filter="search"]');
    if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  }
}

function startNewExperience(routeId = null) {
  let route = routeId ? getRoute(routeId) : null;
  if (!route) route = state.routes.find(r => canEditRoute(r.id, r.artId));
  if (!route) {
    toast('Primero crea una ruta o pide permiso sobre alguna. El mapa necesita dónde poner la experiencia.', 'error');
    return;
  }
  const routeExps = experiencesByRoute(route.id);
  const nextOrder = routeExps.reduce((max, exp) => Math.max(max, Number(exp.order || 0)), 0) + 1;
  state.view = 'experiences';
  state.editingExperienceId = null;
  state.draftExperience = {
    artId: route.artId,
    routeId: route.id,
    label: `Experiencia ${roman(nextOrder)}`,
    name: '',
    order: nextOrder,
    difficulty: 'inicial',
    estimatedDuration: '',
    suggestedAge: '',
    description: '',
    objective: '',
    prerequisites: '',
    prerequisiteExperienceIds: routeExps.map(exp => exp.id),
    evidence: '',
    teacherNotes: '',
    internalNotes: '',
    status: 'draft',
    components: emptyComponents(),
    skillRefs: [],
    resources: []
  };
  render();
}

function startEditExperience(id) {
  const exp = getExperience(id);
  if (!exp) return toast('No encontré esa experiencia.', 'error');
  if (!canEditExperience(exp)) return toast('No tienes permiso para editar esta experiencia.', 'error');
  state.modal = null;
  state.view = 'experiences';
  state.editingExperienceId = id;
  state.draftExperience = JSON.parse(JSON.stringify({ ...exp, components: { ...emptyComponents(), ...(exp.components || {}) }, skillRefs: exp.skillRefs || [], prerequisiteExperienceIds: exp.prerequisiteExperienceIds || [], resources: exp.resources || [] }));
  render();
}

async function deleteExperience(id) {
  const exp = getExperience(id);
  if (!exp) return;
  if (!canEditExperience(exp)) return toast('No tienes permiso para eliminar esta experiencia.', 'error');
  const label = `${exp.label || 'Experiencia'} ${exp.name || ''}`.trim();
  if (!confirm(`¿Eliminar "${label}"? Esto también quitará sus saberes y recursos asociados a esta experiencia.`)) return;
  await services.data.deleteExperience(id, exp);
  await loadData();
  if (state.editingExperienceId === id) {
    state.editingExperienceId = null;
    state.draftExperience = null;
  }
  state.modal = null;
  toast('Experiencia eliminada. Ya puedes liberar esa ruta o arte si no tiene más conexiones.');
  render();
}

function startNewSkill() {
  const arts = editableArts();
  if (!arts.length) {
    toast('Primero necesitas permiso de edición sobre alguna arte. La biblioteca no se llena sola.', 'error');
    return;
  }
  const presetArt = arts.find(a => a.id === state.libraryFilters.artId) || arts[0];
  const activeComponents = activeComponentKeys();
  const defaultComponent = activeComponents.includes(state.libraryFilters.component)
    ? state.libraryFilters.component
    : (activeComponents[0] || componentKeys()[0]);
  state.view = 'library';
  state.editingSkillId = null;
  state.skillEditorOpen = true;
  state.draftSkill = {
    artId: presetArt.id,
    routeIds: state.libraryFilters.routeId !== 'all' && getRoute(state.libraryFilters.routeId)?.artId === presetArt.id ? [state.libraryFilters.routeId] : [],
    component: defaultComponent,
    category: '',
    title: '',
    description: '',
    achievement: '',
    difficulty: state.libraryFilters.difficulty !== 'all' ? state.libraryFilters.difficulty : 'inicial',
    tagsText: '',
    prerequisites: []
  };
  render();
}

function startEditSkill(id) {
  const skill = getSkill(id);
  if (!skill) return toast('No encontré ese saber.', 'error');
  if (!canEditArt(skill.artId)) return toast('No tienes permiso para editar saberes de esta arte.', 'error');
  state.view = 'library';
  state.editingSkillId = id;
  state.skillEditorOpen = true;
  state.draftSkill = {
    artId: skill.artId,
    routeIds: [...skillRouteIds(skill)],
    component: skill.component || 'tecnica',
    category: skill.category || '',
    title: skill.title || '',
    description: skill.description || '',
    achievement: skill.achievement || '',
    difficulty: skill.difficulty || 'inicial',
    tagsText: (skill.tags || []).join(', '),
    prerequisites: [...(skill.prerequisites || [])]
  };
  render();
}

function cancelSkillEditor() {
  state.skillEditorOpen = false;
  state.editingSkillId = null;
  state.draftSkill = null;
  render();
}

function handleSkillDraftChange(event) {
  const key = event.currentTarget.dataset.skill;
  state.draftSkill[key] = event.currentTarget.value;
  if (key === 'artId') {
    // Los prerrequisitos son saberes de la misma arte; al cambiar, descarto los que ya no aplican.
    state.draftSkill.prerequisites = (state.draftSkill.prerequisites || [])
      .filter(id => getSkill(id)?.artId === event.currentTarget.value);
    state.draftSkill.routeIds = (state.draftSkill.routeIds || [])
      .filter(id => getRoute(id)?.artId === event.currentTarget.value);
    state.draftSkill.category = '';
    render();
  }
  if (key === 'component') {
    state.draftSkill.category = '';
    state.draftSkill.prerequisites = [];
    render();
  }
  if (key === 'category') {
    state.draftSkill.prerequisites = (state.draftSkill.prerequisites || [])
      .filter(id => {
        const skill = getSkill(id);
        return skill?.artId === state.draftSkill.artId &&
          skill.component === state.draftSkill.component &&
          skillCategory(skill) === cleanCategory(state.draftSkill.category);
      });
    render();
  }
}

function handleSkillRouteToggle(event) {
  const id = event.currentTarget.dataset.skillRoute;
  const set = new Set(state.draftSkill.routeIds || []);
  if (event.currentTarget.checked) set.add(id);
  else set.delete(id);
  state.draftSkill.routeIds = [...set];
  state.draftSkill.prerequisites = (state.draftSkill.prerequisites || [])
    .filter(prereqId => {
      const skill = getSkill(prereqId);
      if (!skill) return false;
      const routeIds = skillRouteIds(skill);
      return routeIds.some(routeId => set.has(routeId));
    });
  render();
}

function handleSkillPrereqToggle(event) {
  const id = event.currentTarget.dataset.skillPrereq;
  const set = new Set(state.draftSkill.prerequisites || []);
  if (event.currentTarget.checked) {
    set.add(id);
    prerequisiteClosure(id).forEach(prereqId => set.add(prereqId));
  }
  else set.delete(id);
  state.draftSkill.prerequisites = [...set];
  render();
}

async function saveSkill(event) {
  event.preventDefault();
  const d = state.draftSkill;
  if (!canEditArt(d.artId)) return toast('No tienes permiso para guardar en esta arte.', 'error');
  if (!d.title.trim()) return toast('Ponle título al saber. Hasta una escala merece nombre.', 'error');
  if (!(d.routeIds || []).length) return toast('Elige al menos una ruta o instrumento para este saber.', 'error');
  if (!cleanCategory(d.category)) return toast('Elige una categoría. Si no aparece, créala primero en Configuración.', 'error');
  if (hasDuplicateIn(state.skills, d.title, 'title', state.editingSkillId, skill => skill.artId === d.artId)) {
    return toast('Ya existe un saber con ese título en esta arte.', 'error');
  }
  const tags = (d.tagsText || '').split(',').map(t => t.trim()).filter(Boolean);
  const payload = {
    artId: d.artId,
    routeIds: [...new Set(d.routeIds || [])].filter(id => getRoute(id)?.artId === d.artId),
    component: d.component,
    category: cleanCategory(d.category),
    title: d.title.trim(),
    description: (d.description || '').trim(),
    achievement: (d.achievement || '').trim(),
    difficulty: d.difficulty,
    tags,
    prerequisites: [...new Set(d.prerequisites || [])].filter(id => id && id !== state.editingSkillId && getSkill(id)),
    updatedAt: nowISO(),
    updatedBy: state.user.uid,
    updatedByEmail: state.user.email
  };
  if (state.editingSkillId) payload.id = state.editingSkillId;
  else {
    payload.createdAt = nowISO();
    payload.createdBy = state.user.uid;
    payload.createdByEmail = state.user.email;
  }
  await services.data.saveSkill(payload);
  await loadData();
  state.skillEditorOpen = false;
  state.editingSkillId = null;
  state.draftSkill = null;
  toast('Saber guardado. El universo de piano creció un poquito.');
  render();
}

async function deleteSkill(id) {
  const skill = getSkill(id);
  if (!skill) return;
  if (!canEditArt(skill.artId)) return toast('No tienes permiso para eliminar este saber.', 'error');
  if (!confirm(`¿Eliminar el saber "${skill.title}"? Esto no se puede deshacer.`)) return;
  await services.data.deleteSkill(id, skill);
  await loadData();
  toast('Saber eliminado.');
  render();
}

function handleDraftChange(event) {
  const key = event.currentTarget.dataset.draft;
  const value = event.currentTarget.type === 'number' ? Number(event.currentTarget.value) : event.currentTarget.value;
  state.draftExperience[key] = value;
  if (key === 'artId') {
    const available = state.routes.find(r => r.artId === value && canEditRoute(r.id, r.artId));
    state.draftExperience.routeId = available?.id || '';
    state.draftExperience.prerequisiteExperienceIds = [];
    render();
  }
  if (['routeId', 'order'].includes(key)) {
    const validIds = new Set(priorExperiencesForDraft(state.draftExperience).map(exp => exp.id));
    state.draftExperience.prerequisiteExperienceIds = (state.draftExperience.prerequisiteExperienceIds || []).filter(id => validIds.has(id));
    render();
  }
}

function handleComponentDraftChange(event) {
  const component = event.currentTarget.dataset.component;
  const index = Number(event.currentTarget.dataset.index);
  const field = event.currentTarget.dataset.componentField;
  state.draftExperience.components[component][index][field] = event.currentTarget.value;
}

function handleResourceDraftChange(event) {
  const index = Number(event.currentTarget.dataset.index);
  const field = event.currentTarget.dataset.resourceField;
  state.draftExperience.resources[index][field] = event.currentTarget.value;
}

function handleExperiencePrereqToggle(event) {
  const id = event.currentTarget.dataset.experiencePrereq;
  const set = new Set(state.draftExperience.prerequisiteExperienceIds || []);
  const options = priorExperiencesForDraft(state.draftExperience);
  const toggled = options.find(exp => exp.id === id);
  const toggledOrder = Number(toggled?.order || 0);
  if (event.currentTarget.checked) {
    // Marcar una experiencia marca también todas las anteriores por orden.
    set.add(id);
    options.filter(exp => Number(exp.order || 0) < toggledOrder).forEach(exp => set.add(exp.id));
  } else {
    // Desmarcarla desmarca también las posteriores, que dependían de esta.
    set.delete(id);
    options.filter(exp => Number(exp.order || 0) > toggledOrder).forEach(exp => set.delete(exp.id));
  }
  const validIds = new Set(options.map(exp => exp.id));
  state.draftExperience.prerequisiteExperienceIds = [...set].filter(expId => validIds.has(expId));
  render();
}

function addSkillRef(skillId) {
  state.draftExperience.skillRefs ||= [];
  if (state.draftExperience.skillRefs.some(r => r.skillId === skillId)) return;
  state.draftExperience.skillRefs.push({ skillId, note: '' });
  render();
}

function removeSkillRef(skillId) {
  state.draftExperience.skillRefs = (state.draftExperience.skillRefs || []).filter(r => r.skillId !== skillId);
  render();
}

function moveSkillRef(skillId, dir) {
  const refs = state.draftExperience.skillRefs || [];
  const i = refs.findIndex(r => r.skillId === skillId);
  if (i < 0) return;
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= refs.length) return;
  [refs[i], refs[j]] = [refs[j], refs[i]];
  render();
}

function handleSkillRefNote(event) {
  const skillId = event.currentTarget.dataset.skillrefNote;
  const ref = (state.draftExperience.skillRefs || []).find(r => r.skillId === skillId);
  if (ref) ref.note = event.currentTarget.value;
}

// Construye el payload completo de una experiencia con skillRefs nuevos (para guardar desde el tablero).
function boardExpPayload(exp, refs) {
  return {
    ...exp,
    skillRefs: uniqueSkillRefs(refs),
    updatedAt: nowISO(),
    updatedBy: state.user.uid,
    updatedByEmail: state.user.email
  };
}

function uniqueSkillRefs(refs = []) {
  const seen = new Set();
  return refs.filter(ref => {
    if (!ref?.skillId || seen.has(ref.skillId)) return false;
    seen.add(ref.skillId);
    return true;
  });
}

async function handleBoardDrop(target) {
  if (!boardDrag) return;
  const { skillId, source } = boardDrag;
  boardDrag = null;
  if (!target || source === target) return;

  const route = getRoute(state.selectedRouteId);
  if (!route || !canEditRoute(route.id, route.artId)) {
    return toast('No tienes permiso para editar esta ruta.', 'error');
  }
  try {
    if (source !== 'library') {
      const src = getExperience(source);
      if (src) {
        const refs = (src.skillRefs || []).filter(r => r.skillId !== skillId);
        await services.data.saveExperience(boardExpPayload(src, refs));
      }
    }
    if (target !== 'library') {
      const tgt = getExperience(target);
      if (tgt && !(tgt.skillRefs || []).some(r => r.skillId === skillId)) {
        const refs = [...(tgt.skillRefs || []), { skillId, note: '' }];
        await services.data.saveExperience(boardExpPayload(tgt, refs));
      }
    }
    await loadData();
    toast(target === 'library' ? 'Saber devuelto a la biblioteca.' : 'Saber colocado en el nivel.');
    render();
  } catch (error) {
    console.error(error);
    toast(error.message || 'No se pudo mover el saber.', 'error');
  }
}

// Mueve un saber de una experiencia a otra conservando su nota. Usado por el comparador de ruta.
async function moveSkillBetweenExperiences(skillId, sourceId, targetId) {
  if (!skillId || !sourceId || !targetId || sourceId === targetId) return;
  const src = getExperience(sourceId);
  const tgt = getExperience(targetId);
  if (!src || !tgt) return toast('No encontré alguna de las experiencias.', 'error');
  if (!canEditExperience(src) || !canEditExperience(tgt)) {
    return toast('No tienes permiso para mover saberes en estas experiencias.', 'error');
  }
  const skill = getSkill(skillId);
  const existing = (src.skillRefs || []).find(r => r.skillId === skillId);
  if (!existing) return toast('Ese saber ya no está en la experiencia de origen.', 'error');
  if ((tgt.skillRefs || []).some(r => r.skillId === skillId)) {
    return toast(`"${skill?.title || 'El saber'}" ya existe en ${tgt.label || tgt.name}.`, 'error');
  }
  try {
    await services.data.saveExperience(boardExpPayload(src, (src.skillRefs || []).filter(r => r.skillId !== skillId)));
    await services.data.saveExperience(boardExpPayload(tgt, [...(tgt.skillRefs || []), { skillId, note: existing.note || '' }]));
    await loadData();
    toast(`"${skill?.title || 'Saber'}" movido a ${tgt.label || tgt.name}.`);
    render();
  } catch (error) {
    console.error(error);
    toast(error.message || 'No se pudo mover el saber.', 'error');
  }
}

function addResource() {
  state.draftExperience.resources ||= [];
  state.draftExperience.resources.push({ id: uid('res'), title: '', type: 'link', url: '', description: '' });
  render();
}

function removeResource(index) {
  state.draftExperience.resources.splice(index, 1);
  render();
}

async function saveExperience(event) {
  event.preventDefault();
  const d = state.draftExperience;
  if (!canEditRoute(d.routeId, d.artId)) return toast('No tienes permiso para guardar en esta ruta.', 'error');
  if (!d.name.trim()) return toast('Ponle nombre a la experiencia. Hasta las escalas merecen identidad.', 'error');
  if (hasDuplicateIn(state.experiences, d.name, 'name', state.editingExperienceId, exp => exp.routeId === d.routeId && exp.status !== 'archived')) {
    return toast('Ya existe una experiencia con ese nombre en esta ruta.', 'error');
  }
  if (hasDuplicateIn(state.experiences, d.label, 'label', state.editingExperienceId, exp => exp.routeId === d.routeId && exp.status !== 'archived')) {
    return toast('Ya existe una experiencia con esa etiqueta o nivel en esta ruta.', 'error');
  }
  const resources = (d.resources || [])
    .filter(r => r.title || r.url)
    .map(r => ({ ...r, title: (r.title || '').trim(), url: (r.url || '').trim(), description: (r.description || '').trim() }));
  const duplicateResourceMessage = firstDuplicateResource(resources);
  if (duplicateResourceMessage) return toast(duplicateResourceMessage, 'error');
  const validPrereqExperienceIds = new Set(priorExperiencesForDraft(d).map(exp => exp.id));
  const payload = {
    ...d,
    name: d.name.trim(),
    label: d.label.trim(),
    order: Number(d.order || 1),
    updatedAt: nowISO(),
    updatedBy: state.user.uid,
    updatedByEmail: state.user.email,
    prerequisiteExperienceIds: [...new Set(d.prerequisiteExperienceIds || [])].filter(id => validPrereqExperienceIds.has(id)),
    components: normalizeComponents(d.components),
    skillRefs: uniqueSkillRefs(d.skillRefs || [])
      .filter(r => getSkill(r.skillId))
      .map(r => ({ skillId: r.skillId, note: (r.note || '').trim() })),
    resources
  };
  if (!payload.id) {
    payload.createdAt = nowISO();
    payload.createdBy = state.user.uid;
    payload.createdByEmail = state.user.email;
  }
  await services.data.saveExperience(payload);
  await loadData();
  state.draftExperience = null;
  state.editingExperienceId = null;
  state.view = 'map';
  toast('Experiencia guardada. Una pieza más del mapa, el caos retrocede un milímetro.');
  render();
}

function normalizeComponents(components) {
  const out = emptyComponents();
  Object.keys(out).forEach(key => {
    out[key] = (components?.[key] || [])
      .filter(item => item.title || item.description || item.achievement)
      .map((item, index) => ({ ...item, id: item.id || uid('item'), order: index + 1 }));
  });
  return out;
}

function startEditArt(id) {
  if (!hasRole('admin')) return toast('No tienes permiso para editar artes.', 'error');
  if (!getArt(id)) return toast('No encontré esa arte.', 'error');
  state.editingArtId = id;
  state.editingRouteId = null;
  render();
}

function cancelArtEditor() {
  state.editingArtId = null;
  render();
}

async function deleteArt(id) {
  if (!hasRole('admin')) return toast('No tienes permiso para eliminar artes.', 'error');
  const art = getArt(id);
  if (!art) return;
  const routes = state.routes.filter(r => r.artId === id);
  const skills = state.skills.filter(s => s.artId === id);
  const experiences = state.experiences.filter(e => e.artId === id && e.status !== 'archived');
  if (routes.length || skills.length || experiences.length) {
    return toast(`No se puede eliminar "${art.name}" porque tiene rutas, saberes o experiencias conectadas.`, 'error');
  }
  if (!confirm(`Eliminar el arte "${art.name}"? Esto no se puede deshacer.`)) return;
  await services.data.deleteArt(id, art);
  await loadData();
  state.editingArtId = null;
  toast('Arte eliminado.');
  render();
}

function startEditRoute(id) {
  if (!hasRole('admin')) return toast('No tienes permiso para editar rutas.', 'error');
  if (!getRoute(id)) return toast('No encontré esa ruta.', 'error');
  state.editingRouteId = id;
  state.editingArtId = null;
  render();
}

function cancelRouteEditor() {
  state.editingRouteId = null;
  render();
}

async function deleteRoute(id) {
  if (!hasRole('admin')) return toast('No tienes permiso para eliminar rutas.', 'error');
  const route = getRoute(id);
  if (!route) return;
  const experiences = state.experiences.filter(e => e.routeId === id && e.status !== 'archived');
  if (experiences.length) {
    return toast(`No se puede eliminar "${route.name}" porque tiene experiencias conectadas.`, 'error');
  }
  if (!confirm(`Eliminar la ruta "${route.name}"? Esto no se puede deshacer.`)) return;
  await services.data.deleteRoute(id, route);
  await loadData();
  state.editingRouteId = null;
  toast('Ruta eliminada.');
  render();
}

async function saveArt(event) {
  event.preventDefault();
  const fd = new FormData(event.currentTarget);
  const name = fd.get('name').trim();
  if (!name) return toast('Ponle nombre al arte.', 'error');
  const wasEditing = Boolean(state.editingArtId);
  if (hasDuplicateIn(state.arts, name, 'name', state.editingArtId)) {
    return toast('Ya existe un arte con ese nombre.', 'error');
  }
  const payload = {
    name,
    slug: slugify(name),
    description: fd.get('description').trim(),
    order: Number(fd.get('order') || state.arts.length + 1),
    active: true,
    updatedAt: nowISO(),
    updatedBy: state.user.uid,
    updatedByEmail: state.user.email
  };
  if (state.editingArtId) payload.id = state.editingArtId;
  else {
    payload.createdAt = nowISO();
    payload.createdBy = state.user.uid;
    payload.createdByEmail = state.user.email;
  }
  await services.data.saveArt(payload);
  event.currentTarget.reset();
  await loadData();
  state.editingArtId = null;
  toast(wasEditing ? 'Arte actualizado.' : 'Arte guardado.');
  render();
}

async function saveRoute(event) {
  event.preventDefault();
  const fd = new FormData(event.currentTarget);
  const name = fd.get('name').trim();
  if (!name) return toast('Ponle nombre a la ruta.', 'error');
  const wasEditing = Boolean(state.editingRouteId);
  const artId = fd.get('artId');
  const currentRoute = state.editingRouteId ? getRoute(state.editingRouteId) : null;
  if (currentRoute && currentRoute.artId !== artId && state.experiences.some(e => e.routeId === currentRoute.id)) {
    return toast('No se puede cambiar el arte de una ruta que ya tiene experiencias.', 'error');
  }
  if (hasDuplicateIn(state.routes, name, 'name', state.editingRouteId, route => route.artId === artId)) {
    return toast('Ya existe una ruta con ese nombre en esta arte.', 'error');
  }
  const payload = {
    artId,
    name,
    slug: slugify(name),
    description: fd.get('description').trim(),
    order: Number(fd.get('order') || state.routes.length + 1),
    active: true,
    updatedAt: nowISO(),
    updatedBy: state.user.uid,
    updatedByEmail: state.user.email
  };
  if (state.editingRouteId) payload.id = state.editingRouteId;
  else {
    payload.createdAt = nowISO();
    payload.createdBy = state.user.uid;
    payload.createdByEmail = state.user.email;
  }
  await services.data.saveRoute(payload);
  event.currentTarget.reset();
  await loadData();
  state.editingRouteId = null;
  toast(wasEditing ? 'Ruta actualizada.' : 'Ruta guardada.');
  render();
}

async function saveInvite(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const fd = new FormData(form);
  const email = normalizeEmail(fd.get('email'));
  const allArts = fd.get('allArts') === 'on';
  const allRoutes = fd.get('allRoutes') === 'on';
  const allowedArts = allArts ? ['*'] : fd.getAll('allowedArts');
  const allowedRoutes = allRoutes ? ['*'] : fd.getAll('allowedRoutes');
  const payload = {
    id: email,
    email,
    name: fd.get('name').trim(),
    role: fd.get('role'),
    allowedArts,
    allowedRoutes,
    active: true,
    invitedBy: state.user.uid,
    invitedByEmail: state.user.email,
    createdAt: nowISO(),
    updatedAt: nowISO()
  };
  if (!allowedArts.length || !allowedRoutes.length) {
    toast('Asigna al menos un arte y una ruta, o marca “Todas”.', 'error');
    return;
  }
  await services.data.saveInvite(payload);
  form.reset();
  await loadData();
  toast('Invitación guardada. El docente ya puede crear cuenta con ese correo.');
  render();
}

async function saveComponentCatalog(event) {
  event.preventDefault();
  if (!hasRole('admin')) return toast('Solo admins pueden editar componentes.', 'error');
  const catalog = currentComponentCatalog();
  for (const key of componentKeys()) {
    const active = isComponentActive(key);
    const label = $(`[data-component-setting="label"][data-component-key="${key}"]`)?.value.trim();
    const emoji = $(`[data-component-setting="emoji"][data-component-key="${key}"]`)?.value.trim();
    if (active && !label) return toast('Todos los componentes activos necesitan nombre visible.', 'error');
    catalog[key] = {
      label: active ? label : (componentLabels[key] || defaultComponentLabels[key]),
      emoji: active ? emoji : (componentEmojis[key] || defaultComponentEmojis[key] || ''),
      active,
      deleted: false
    };
  }
  await services.data.saveSettings({ componentCatalog: catalog });
  await loadData();
  toast('Componentes actualizados. Ya aparecen así en la biblioteca y en los selectores.');
  render();
}

async function saveCategoryCatalogItem(event) {
  event.preventDefault();
  if (!hasRole('admin')) return toast('Solo admins pueden editar categorías.', 'error');
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const originalText = submit?.textContent || 'Agregar categoría';
  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Guardando...';
  }
  const fd = new FormData(form);
  const component = fd.get('component');
  const name = cleanCategory(fd.get('name'));
  try {
    if (!componentKeys().includes(component)) return toast('Elige un componente válido.', 'error');
    if (!name) return toast('Escribe el nombre de la categoría.', 'error');

    const catalog = normalizeCategoryCatalog(state.settings.categoryCatalog || []);
    const existing = catalog.find(item => item.component === component && duplicateKey(item.name) === duplicateKey(name));
    if (existing) {
      existing.name = name;
      existing.active = true;
    } else {
      catalog.push({ id: uid('cat'), component, name, active: true });
    }

    await services.data.saveSettings({ categoryCatalog: catalog });
    state.settings = { ...(state.settings || {}), categoryCatalog: catalog };
    form.reset();
    toast('Categoría guardada. Ya aparece en la lista y en el desplegable de saberes.');
    render();
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = originalText;
    }
  }
}

async function deleteCategoryCatalogItem(component, name) {
  if (!hasRole('admin')) return toast('Solo admins pueden editar categorías.', 'error');
  const normalizedName = cleanCategory(name);
  if (!componentKeys().includes(component) || !normalizedName) return;
  const used = state.skills.filter(skill => skill.component === component && duplicateKey(skillCategory(skill)) === duplicateKey(normalizedName)).length;
  if (used) {
    return toast(`No se puede eliminar "${normalizedName}" porque ${used} saber(es) todavía la usan. Cambia esos saberes primero.`, 'error');
  }
  if (!confirm(`¿Eliminar "${normalizedName}" del desplegable de categorías?`)) return;
  const catalog = normalizeCategoryCatalog(state.settings.categoryCatalog || []);
  const item = catalog.find(entry => entry.component === component && duplicateKey(entry.name) === duplicateKey(normalizedName));
  if (item) item.active = false;
  else catalog.push({ id: uid('cat'), component, name: normalizedName, active: false });
  await services.data.saveSettings({ categoryCatalog: catalog });
  state.settings = { ...(state.settings || {}), categoryCatalog: catalog };
  if (state.libraryFilters.category === normalizedName) state.libraryFilters.category = 'all';
  toast('Categoría eliminada del desplegable.');
  render();
}

async function restoreCategoryCatalogItem(component, name) {
  if (!hasRole('admin')) return toast('Solo admins pueden editar categorías.', 'error');
  const normalizedName = cleanCategory(name);
  if (!componentKeys().includes(component) || !normalizedName) return;
  const catalog = normalizeCategoryCatalog(state.settings.categoryCatalog || []);
  const item = catalog.find(entry => entry.component === component && duplicateKey(entry.name) === duplicateKey(normalizedName));
  if (item) item.active = true;
  else catalog.push({ id: uid('cat'), component, name: normalizedName, active: true });
  await services.data.saveSettings({ categoryCatalog: catalog });
  state.settings = { ...(state.settings || {}), categoryCatalog: catalog };
  toast('Categoría reactivada.');
  render();
}

async function purgeCategoryCatalogItem(component, name) {
  if (!hasRole('admin')) return toast('Solo admins pueden editar categorías.', 'error');
  const normalizedName = cleanCategory(name);
  const catalog = normalizeCategoryCatalog(state.settings.categoryCatalog || []);
  const item = catalog.find(entry => entry.component === component && duplicateKey(entry.name) === duplicateKey(normalizedName));
  if (!item || item.active) return;
  if (state.skills.some(skill => skill.component === component && duplicateKey(skillCategory(skill)) === duplicateKey(normalizedName))) {
    return toast(`No se puede borrar definitivamente "${normalizedName}" porque todavía hay saberes que la usan.`, 'error');
  }
  if (!confirm(`¿Borrar definitivamente "${normalizedName}"? Esta acción no se puede deshacer.`)) return;
  const nextCatalog = catalog.filter(entry => entry !== item);
  await services.data.saveSettings({ categoryCatalog: nextCatalog });
  state.settings = { ...(state.settings || {}), categoryCatalog: nextCatalog };
  toast('Categoría eliminada definitivamente.');
  render();
}

async function deleteComponentCatalogItem(key) {
  if (!hasRole('admin')) return toast('Solo admins pueden editar componentes.', 'error');
  if (!componentKeys().includes(key)) return;
  const used = state.skills.filter(skill => skill.component === key).length;
  if (used) {
    return toast(`No se puede eliminar "${componentLabels[key]}" porque ${used} saber(es) todavía lo usan. Cambia esos saberes primero.`, 'error');
  }
  if (activeComponentKeys().length <= 1) {
    return toast('Debe quedar al menos un componente activo.', 'error');
  }
  if (!confirm(`¿Eliminar "${componentLabels[key]}" de la lista de componentes?`)) return;
  const catalog = currentComponentCatalog();
  catalog[key] = { ...catalog[key], active: false };
  await services.data.saveSettings({ componentCatalog: catalog });
  await loadData();
  if (state.libraryFilters.component === key) state.libraryFilters.component = 'all';
  toast('Componente eliminado de la lista.');
  render();
}

async function restoreComponentCatalogItem(key) {
  if (!hasRole('admin')) return toast('Solo admins pueden editar componentes.', 'error');
  if (!componentKeys().includes(key)) return;
  const catalog = currentComponentCatalog();
  catalog[key] = { ...catalog[key], active: true };
  await services.data.saveSettings({ componentCatalog: catalog });
  await loadData();
  toast('Componente reactivado.');
  render();
}

async function purgeComponentCatalogItem(key) {
  if (!hasRole('admin')) return toast('Solo admins pueden editar componentes.', 'error');
  if (isComponentActive(key)) return;
  if (state.skills.some(skill => skill.component === key)) {
    return toast(`No se puede borrar definitivamente "${componentLabels[key]}" porque todavía hay saberes que lo usan.`, 'error');
  }
  if (!confirm(`¿Borrar definitivamente "${componentLabels[key]}"? Esta acción no se puede deshacer.`)) return;
  const catalog = currentComponentCatalog();
  catalog[key] = {
    ...(catalog[key] || {}),
    active: false,
    deleted: true
  };
  await services.data.saveSettings({ componentCatalog: catalog });
  await loadData();
  toast('Componente eliminado definitivamente.');
  render();
}

async function resetComponentCatalog() {
  if (!hasRole('admin')) return toast('Solo admins pueden editar componentes.', 'error');
  if (!confirm('¿Restaurar los nombres e iconos base de componentes?')) return;
  const catalog = {};
  allComponentKeys().forEach(key => {
    catalog[key] = { label: defaultComponentLabels[key], emoji: defaultComponentEmojis[key] || '', active: true };
  });
  await services.data.saveSettings({ componentCatalog: catalog });
  await loadData();
  toast('Componentes restaurados.');
  render();
}

// ---------- Informe consolidado (para revisar con una IA) ----------

const reportSections = [
  { key: 'guia', label: 'Guía de lectura', hint: 'Explica a la IA cómo está modelado el mapa (arte › ruta › experiencia › saberes).' },
  { key: 'resumen', label: 'Resumen general', hint: 'Conteos por arte, ruta, estado y componente.' },
  { key: 'estructura', label: 'Artes y rutas', hint: 'Nombres, descripciones y orden.' },
  { key: 'experiencias', label: 'Experiencias por ruta', hint: 'Nivel, estado, dificultad, duración y edad sugerida.' },
  { key: 'detalle', label: 'Detalle pedagógico', hint: 'Descripción, objetivo, prerrequisitos y evidencias de cada experiencia.' },
  { key: 'saberesExp', label: 'Saberes dentro de cada experiencia', hint: 'Listado por componente, con logro esperado y nota.' },
  { key: 'cobertura', label: 'Mapa de cobertura', hint: 'Tabla niveles × componentes por ruta.' },
  { key: 'biblioteca', label: 'Biblioteca de saberes', hint: 'Universo completo por arte y componente, con dificultad y etiquetas.' },
  { key: 'prerrequisitos', label: 'Prerrequisitos entre saberes', hint: 'Capas topológicas y ciclos detectados.' },
  { key: 'alertas', label: 'Alertas y vacíos', hint: 'Orden inconsistente, niveles vacíos, saberes sin usar.' },
  { key: 'recursos', label: 'Recursos', hint: 'Enlaces asociados a cada experiencia.' },
  { key: 'notas', label: 'Notas internas y para docentes', hint: 'Ojo: puede incluir información sensible.' },
  { key: 'historial', label: 'Historial de cambios', hint: 'Últimos movimientos registrados en el sistema.' }
];

function defaultReportConfig() {
  const sections = {};
  reportSections.forEach(item => { sections[item.key] = !['notas', 'historial'].includes(item.key); });
  return {
    artId: state.selectedArtId !== 'all' ? state.selectedArtId : 'all',
    routeId: 'all',
    format: 'markdown',
    includeArchived: false,
    sections
  };
}

function reportConfig() {
  if (!state.report) state.report = defaultReportConfig();
  return state.report;
}

function reportArts() {
  const cfg = reportConfig();
  return state.arts.filter(a => cfg.artId === 'all' || a.id === cfg.artId);
}

function reportRoutes(artId) {
  const cfg = reportConfig();
  return routesByArt(artId).filter(r => cfg.routeId === 'all' || r.id === cfg.routeId);
}

function reportExperiences(routeId) {
  const cfg = reportConfig();
  const list = state.experiences
    .filter(e => e.routeId === routeId)
    .filter(e => cfg.includeArchived || e.status !== 'archived')
    .filter(canSeeExperience);
  return list.sort((a, b) => (a.order || 0) - (b.order || 0));
}

function reportScopeLabel() {
  const cfg = reportConfig();
  const art = cfg.artId === 'all' ? 'todas las artes' : (getArt(cfg.artId)?.name || 'arte desconocida');
  const route = cfg.routeId === 'all' ? 'todas las rutas' : (getRoute(cfg.routeId)?.name || 'ruta desconocida');
  return `${art} · ${route}`;
}

function md(value) {
  // Los saltos de línea dentro de un campo rompen las listas de Markdown.
  return String(value ?? '').replace(/\r?\n+/g, ' ').trim();
}

function buildReportMarkdown() {
  const cfg = reportConfig();
  const on = cfg.sections;
  const arts = reportArts();
  const out = [];
  const push = (...lines) => lines.forEach(line => out.push(line));

  push(`# Informe del Mapa de Experiencias · Musicala`, '');
  push(`- **Generado:** ${formatDate(nowISO())}`);
  push(`- **Alcance:** ${reportScopeLabel()}`);
  push(`- **Experiencias archivadas:** ${cfg.includeArchived ? 'incluidas' : 'excluidas'}`);
  push(`- **Componentes activos:** ${activeComponentKeys().map(k => componentLabels[k]).join(', ') || '—'}`, '');

  if (on.guia) {
    push(`## Cómo leer este informe`, '');
    push(`Musicala organiza su currículo así:`, '');
    push(`1. **Arte**: la disciplina (violín, piano, canto…).`);
    push(`2. **Ruta**: un recorrido de aprendizaje dentro de un arte.`);
    push(`3. **Experiencia**: un nivel progresivo dentro de la ruta (Experiencia I, II, III…).`);
    push(`4. **Saberes**: unidades de conocimiento de una biblioteca reutilizable por arte. Cada saber tiene un componente (${activeComponentKeys().map(k => componentLabels[k]).join(' / ') || '—'}), una categoría, una dificultad, etiquetas y prerrequisitos con otros saberes.`);
    push(`5. Armar una experiencia = repartir saberes de la biblioteca en ese nivel. La **cobertura** muestra cuántos saberes de cada componente quedaron en cada nivel; las celdas en cero son vacíos curriculares.`, '');
    push(`Los estados de una experiencia son: borrador, en revisión, publicada o archivada.`, '');
  }

  if (on.resumen) {
    const allExps = arts.flatMap(art => reportRoutes(art.id).flatMap(route => reportExperiences(route.id)));
    const allSkills = arts.flatMap(art => skillsByArt(art.id));
    push(`## Resumen general`, '');
    push(`- Artes en el informe: ${arts.length}`);
    push(`- Rutas: ${arts.reduce((sum, art) => sum + reportRoutes(art.id).length, 0)}`);
    push(`- Experiencias: ${allExps.length} (publicadas ${allExps.filter(e => e.status === 'published').length}, en revisión ${allExps.filter(e => e.status === 'review').length}, borradores ${allExps.filter(e => e.status === 'draft').length}, archivadas ${allExps.filter(e => e.status === 'archived').length})`);
    push(`- Saberes en la biblioteca: ${allSkills.length}`);
    activeComponentKeys().forEach(key => {
      push(`  - ${componentLabels[key]}: ${allSkills.filter(s => s.component === key).length} saber(es)`);
    });
    push('');
    arts.forEach(art => {
      const routes = reportRoutes(art.id);
      const exps = routes.flatMap(r => reportExperiences(r.id));
      push(`- **${md(art.name)}**: ${routes.length} ruta(s), ${exps.length} experiencia(s), ${skillsByArt(art.id).length} saber(es).`);
    });
    push('');
  }

  arts.forEach(art => {
    const routes = reportRoutes(art.id);
    if (on.estructura || on.experiencias || on.detalle || on.saberesExp || on.cobertura || on.recursos || on.notas) {
      push(`## Arte: ${md(art.name)}`, '');
      if (on.estructura) {
        if (art.description) push(`${md(art.description)}`, '');
        push(`Rutas (${routes.length}):`, '');
        routes.forEach(route => {
          push(`- **${md(route.name)}** — ${reportExperiences(route.id).length} experiencia(s), ${skillsByRoute(route).length} saber(es) asignados.${route.description ? ` ${md(route.description)}` : ''}`);
        });
        push('');
      }
    }

    routes.forEach(route => {
      const exps = reportExperiences(route.id);
      if (!(on.experiencias || on.detalle || on.saberesExp || on.cobertura || on.recursos || on.notas)) return;
      push(`### Ruta: ${md(route.name)}`, '');
      if (on.cobertura && exps.length) {
        const comps = activeComponentKeys();
        push(`**Cobertura (saberes por nivel y componente)**`, '');
        push(`| Nivel | ${comps.map(c => componentLabels[c]).join(' | ')} | Total |`);
        push(`| --- | ${comps.map(() => '---').join(' | ')} | --- |`);
        exps.forEach(exp => {
          const counts = experienceComponentCounts(exp);
          const total = comps.reduce((sum, c) => sum + (counts[c] || 0), 0);
          push(`| ${md(experienceLabel(exp))} | ${comps.map(c => counts[c] || 0).join(' | ')} | ${total} |`);
        });
        push(`| _Disponibles en biblioteca_ | ${comps.map(c => skillsByRoute(route).filter(s => s.component === c).length).join(' | ')} | ${skillsByRoute(route).length} |`, '');
      }

      if (!exps.length) { push(`_Esta ruta todavía no tiene experiencias._`, ''); return; }

      exps.forEach(exp => {
        push(`#### ${md(experienceLabel(exp))}`, '');
        if (on.experiencias) {
          push(`- Estado: ${statusLabels[exp.status] || exp.status || '—'}`);
          push(`- Dificultad: ${difficultyLabels[exp.difficulty] || exp.difficulty || '—'}`);
          if (exp.estimatedDuration) push(`- Duración estimada: ${md(exp.estimatedDuration)}`);
          if (exp.suggestedAge) push(`- Edad sugerida: ${md(exp.suggestedAge)}`);
          push('');
        }
        if (on.detalle) {
          push(`- **Descripción:** ${md(exp.description) || '—'}`);
          push(`- **Objetivo:** ${md(exp.objective) || '—'}`);
          const prevNames = prerequisiteExperienceNames(exp.prerequisiteExperienceIds || []);
          push(`- **Prerrequisitos:** ${[prevNames.length ? `experiencias previas: ${prevNames.join(', ')}` : '', md(exp.prerequisites)].filter(Boolean).join(' · ') || '—'}`);
          push(`- **Evidencias:** ${md(exp.evidence) || '—'}`, '');
        }
        if (on.saberesExp) {
          const comps = activeComponentKeys();
          const totalItems = comps.reduce((sum, c) => sum + experienceComponentItems(exp, c).length, 0);
          push(`**Saberes de este nivel** (${totalItems})`, '');
          if (!totalItems) push(`_Sin saberes asignados._`, '');
          comps.forEach(key => {
            const items = experienceComponentItems(exp, key);
            if (!items.length) return;
            push(`- ${componentLabels[key]}:`);
            items.forEach(item => {
              const extra = [md(item.achievement) ? `logro: ${md(item.achievement)}` : '', md(item.note) ? `nota: ${md(item.note)}` : ''].filter(Boolean).join(' · ');
              push(`  - ${md(item.title)}${extra ? ` — ${extra}` : ''}`);
            });
          });
          push('');
        }
        if (on.recursos) {
          const resources = exp.resources || [];
          push(`**Recursos:** ${resources.length ? '' : '—'}`);
          resources.forEach(r => push(`- ${md(r.title || r.url)}${r.type ? ` (${md(r.type)})` : ''}: ${md(r.url)}`));
          push('');
        }
        if (on.notas) {
          push(`- **Notas para docentes:** ${md(exp.teacherNotes) || '—'}`);
          push(`- **Notas internas:** ${md(exp.internalNotes) || '—'}`, '');
        }
      });
    });
  });

  if (on.biblioteca) {
    push(`## Biblioteca de saberes`, '');
    arts.forEach(art => {
      const skills = skillsByArt(art.id);
      push(`### ${md(art.name)} (${skills.length} saberes)`, '');
      if (!skills.length) { push(`_Biblioteca vacía._`, ''); return; }
      activeComponentKeys().forEach(key => {
        const group = skills.filter(s => s.component === key);
        if (!group.length) return;
        push(`**${componentLabels[key]}** (${group.length})`, '');
        group
          .slice()
          .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
          .forEach(skill => {
            const meta = [
              `categoría: ${categoryLabel(skill)}`,
              `dificultad: ${difficultyLabels[skill.difficulty] || skill.difficulty || '—'}`,
              `rutas: ${skillRouteLabels(skill).join(', ')}`,
              (skill.tags || []).length ? `etiquetas: ${(skill.tags || []).join(', ')}` : '',
              (skill.prerequisites || []).length ? `prerrequisitos: ${(skill.prerequisites || []).map(id => getSkill(id)?.title || 'saber eliminado').join(', ')}` : ''
            ].filter(Boolean).join(' · ');
            push(`- **${md(skill.title)}** — ${meta}`);
            if (md(skill.achievement)) push(`  - Logro: ${md(skill.achievement)}`);
            if (md(skill.description)) push(`  - Descripción: ${md(skill.description)}`);
          });
        push('');
      });
    });
  }

  if (on.prerrequisitos) {
    push(`## Prerrequisitos entre saberes`, '');
    arts.forEach(art => {
      const skills = skillsByArt(art.id);
      if (!skills.length) return;
      const { layers, cyclic } = topoLayers(skills);
      push(`### ${md(art.name)}`, '');
      layers.forEach((layer, idx) => {
        push(`- Capa ${idx + 1}: ${layer.map(s => md(s.title)).join(', ')}`);
      });
      if (cyclic.length) push(`- ⚠️ Saberes en dependencia circular: ${cyclic.map(s => md(s.title)).join(', ')}`);
      push('');
    });
  }

  if (on.alertas) {
    push(`## Alertas y vacíos detectados`, '');
    const alerts = [];
    arts.forEach(art => {
      reportRoutes(art.id).forEach(route => {
        routeOrderingIssues(route).forEach(issue => {
          alerts.push(issue.type === 'missing'
            ? `[${md(route.name)}] "${md(issue.skill)}" (${md(issue.expLabel)}) requiere "${md(issue.pre)}", que no aparece en ninguna experiencia de la ruta.`
            : `[${md(route.name)}] "${md(issue.skill)}" está en ${md(issue.expLabel)} pero su prerrequisito "${md(issue.pre)}" aparece después, en ${md(issue.preExpLabel)}.`);
        });
        const exps = reportExperiences(route.id);
        if (!exps.length) alerts.push(`[${md(route.name)}] La ruta no tiene experiencias.`);
        exps.forEach(exp => {
          const counts = experienceComponentCounts(exp);
          const total = activeComponentKeys().reduce((sum, c) => sum + (counts[c] || 0), 0);
          if (!total) alerts.push(`[${md(route.name)}] ${md(experienceLabel(exp))} no tiene saberes asignados.`);
          if (!md(exp.objective)) alerts.push(`[${md(route.name)}] ${md(experienceLabel(exp))} no tiene objetivo escrito.`);
          if (!md(exp.evidence)) alerts.push(`[${md(route.name)}] ${md(experienceLabel(exp))} no tiene evidencias definidas.`);
        });
        const used = new Set(exps.flatMap(e => (e.skillRefs || []).map(r => r.skillId)));
        const unused = skillsByRoute(route).filter(s => !used.has(s.id));
        if (unused.length) alerts.push(`[${md(route.name)}] ${unused.length} saber(es) asignados a la ruta no están en ninguna experiencia: ${unused.map(s => md(s.title)).join(', ')}.`);
      });
      skillsByArt(art.id).forEach(skill => {
        const dangling = (skill.prerequisites || []).filter(id => !getSkill(id));
        if (dangling.length) alerts.push(`[${md(art.name)}] "${md(skill.title)}" tiene ${dangling.length} prerrequisito(s) apuntando a saberes eliminados.`);
      });
    });
    if (!alerts.length) push(`Sin alertas: no encontré vacíos evidentes en el alcance seleccionado.`, '');
    else alerts.forEach(a => push(`- ${a}`));
    push('');
  }

  if (on.historial) {
    push(`## Historial de cambios`, '');
    const logs = state.logs || [];
    if (!logs.length) push(`_Sin registros._`, '');
    logs.slice(0, 100).forEach(log => {
      push(`- ${formatDate(log.createdAt || log.at)} · ${md(log.actorEmail || log.actor || '')} · ${md(log.action || log.type || '')} · ${md(log.detail || log.message || '')}`);
    });
    push('');
  }

  push(`---`, '');
  push(`_Fin del informe. Si vas a analizarlo con una IA: los vacíos importantes suelen estar en la sección de cobertura y en la de alertas._`);

  return out.join('\n');
}

function buildReportJson() {
  const cfg = reportConfig();
  const on = cfg.sections;
  const arts = reportArts();
  const payload = {
    generatedAt: nowISO(),
    scope: { artId: cfg.artId, routeId: cfg.routeId, includeArchived: cfg.includeArchived, label: reportScopeLabel() },
    components: activeComponentKeys().map(key => ({ key, label: componentLabels[key], emoji: componentEmojis[key] })),
    arts: arts.map(art => ({
      id: art.id,
      name: art.name,
      description: art.description || '',
      routes: reportRoutes(art.id).map(route => ({
        id: route.id,
        name: route.name,
        description: route.description || '',
        experiences: reportExperiences(route.id).map(exp => {
          const item = {
            id: exp.id,
            label: exp.label,
            name: exp.name,
            order: exp.order,
            status: exp.status,
            difficulty: exp.difficulty
          };
          if (on.experiencias) Object.assign(item, { estimatedDuration: exp.estimatedDuration || '', suggestedAge: exp.suggestedAge || '' });
          if (on.detalle) Object.assign(item, {
            description: exp.description || '',
            objective: exp.objective || '',
            prerequisites: exp.prerequisites || '',
            prerequisiteExperiences: prerequisiteExperienceNames(exp.prerequisiteExperienceIds || []),
            evidence: exp.evidence || ''
          });
          if (on.saberesExp) item.skills = activeComponentKeys().flatMap(key =>
            experienceComponentItems(exp, key).map(entry => ({ component: key, ...entry })));
          if (on.cobertura) item.coverage = experienceComponentCounts(exp);
          if (on.recursos) item.resources = exp.resources || [];
          if (on.notas) Object.assign(item, { teacherNotes: exp.teacherNotes || '', internalNotes: exp.internalNotes || '' });
          return item;
        })
      })),
      skills: on.biblioteca ? skillsByArt(art.id).map(skill => ({
        id: skill.id,
        title: skill.title,
        component: skill.component,
        category: skillCategory(skill),
        difficulty: skill.difficulty,
        description: skill.description || '',
        achievement: skill.achievement || '',
        tags: skill.tags || [],
        routes: skillRouteLabels(skill),
        prerequisites: on.prerrequisitos ? (skill.prerequisites || []).map(id => getSkill(id)?.title || null) : undefined
      })) : undefined
    }))
  };
  if (on.historial) payload.logs = (state.logs || []).slice(0, 100);
  return JSON.stringify(payload, null, 2);
}

function buildReportText() {
  return buildReportMarkdown()
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/^_|_$/gm, '');
}

function buildReport() {
  const cfg = reportConfig();
  if (cfg.format === 'json') return { content: buildReportJson(), ext: 'json', mime: 'application/json' };
  if (cfg.format === 'texto') return { content: buildReportText(), ext: 'txt', mime: 'text/plain' };
  return { content: buildReportMarkdown(), ext: 'md', mime: 'text/markdown' };
}

function reportFileName(ext) {
  const cfg = reportConfig();
  const scope = cfg.routeId !== 'all'
    ? slugify(getRoute(cfg.routeId)?.name || 'ruta')
    : (cfg.artId !== 'all' ? slugify(getArt(cfg.artId)?.name || 'arte') : 'general');
  return `informe-mapa-crea-${scope}-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

function downloadReport() {
  const { content, ext, mime } = buildReport();
  downloadBlob(content, reportFileName(ext), mime);
  toast('Informe descargado. Ahora sí, pégaselo a la IA y que opine.');
}

async function copyReport() {
  const { content } = buildReport();
  try {
    await navigator.clipboard.writeText(content);
    toast(`Informe copiado (${content.length.toLocaleString('es-CO')} caracteres).`);
  } catch (error) {
    console.error(error);
    toast('El navegador no me dejó copiar. Usa el botón de descargar.', 'error');
  }
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function openReportModal() {
  if (!state.report) state.report = defaultReportConfig();
  state.modal = { type: 'report' };
  render();
}

function handleReportConfigChange(event) {
  const el = event.currentTarget;
  const key = el.dataset.report;
  const cfg = reportConfig();
  if (key === 'section') {
    cfg.sections[el.dataset.sectionKey] = el.checked;
  } else if (el.type === 'checkbox') {
    cfg[key] = el.checked;
  } else {
    cfg[key] = el.value;
    if (key === 'artId') cfg.routeId = 'all';
  }
  render();
}

function setReportPreset(preset) {
  const cfg = reportConfig();
  const all = value => reportSections.forEach(item => { cfg.sections[item.key] = value; });
  if (preset === 'todo') all(true);
  if (preset === 'nada') all(false);
  if (preset === 'pedagogico') {
    all(false);
    ['guia', 'resumen', 'experiencias', 'detalle', 'saberesExp', 'cobertura', 'alertas'].forEach(k => { cfg.sections[k] = true; });
  }
  if (preset === 'curricular') {
    all(false);
    ['guia', 'resumen', 'estructura', 'cobertura', 'biblioteca', 'prerrequisitos', 'alertas'].forEach(k => { cfg.sections[k] = true; });
  }
  render();
}

function renderReportModal() {
  const cfg = reportConfig();
  const artOptions = [`<option value="all">Todas las artes</option>`,
    ...state.arts.map(a => `<option value="${a.id}" ${cfg.artId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`)].join('');
  const routeOptions = [`<option value="all">Todas las rutas</option>`,
    ...routesByArt(cfg.artId).map(r => `<option value="${r.id}" ${cfg.routeId === r.id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`)].join('');
  const preview = buildReport();
  const chars = preview.content.length;

  return `
    <div class="modal-backdrop" data-action="close-modal">
      <article class="modal stack" onclick="event.stopPropagation()">
        <div class="row-between">
          <div>
            <h2>Informe para revisar con una IA</h2>
            <p class="muted small" style="margin-top:4px">Elige el alcance y qué información incluir. Descárgalo o cópialo y pégaselo a la IA con la que quieras conversar.</p>
          </div>
          <button class="btn" data-action="close-modal">Cerrar</button>
        </div>

        <div class="grid cols-2">
          <div class="form-field">
            <label>Arte</label>
            <select data-report="artId">${artOptions}</select>
          </div>
          <div class="form-field">
            <label>Ruta</label>
            <select data-report="routeId">${routeOptions}</select>
          </div>
          <div class="form-field">
            <label>Formato</label>
            <select data-report="format">
              <option value="markdown" ${cfg.format === 'markdown' ? 'selected' : ''}>Markdown (.md) · recomendado para IA</option>
              <option value="texto" ${cfg.format === 'texto' ? 'selected' : ''}>Texto plano (.txt)</option>
              <option value="json" ${cfg.format === 'json' ? 'selected' : ''}>JSON estructurado (.json)</option>
            </select>
          </div>
          <div class="form-field">
            <label>Opciones</label>
            <label class="prereq-option">
              <input type="checkbox" data-report="includeArchived" ${cfg.includeArchived ? 'checked' : ''} />
              <span>Incluir experiencias archivadas</span>
            </label>
          </div>
        </div>

        <div class="row-between">
          <strong>Qué incluir</strong>
          <div class="row">
            <button class="btn small" type="button" data-action="report-preset" data-id="pedagogico">Enfoque pedagógico</button>
            <button class="btn small" type="button" data-action="report-preset" data-id="curricular">Enfoque curricular</button>
            <button class="btn small" type="button" data-action="report-preset" data-id="todo">Todo</button>
            <button class="btn small" type="button" data-action="report-preset" data-id="nada">Nada</button>
          </div>
        </div>

        <div class="prereq-list report-sections">
          ${reportSections.map(item => `
            <label class="prereq-option">
              <input type="checkbox" data-report="section" data-section-key="${item.key}" ${cfg.sections[item.key] ? 'checked' : ''} />
              <span><strong>${escapeHtml(item.label)}</strong><br /><span class="small muted">${escapeHtml(item.hint)}</span></span>
            </label>
          `).join('')}
        </div>

        <p class="small muted">Tamaño aproximado: ${chars.toLocaleString('es-CO')} caracteres (~${Math.ceil(chars / 4).toLocaleString('es-CO')} tokens).</p>

        <div class="row">
          <button class="btn primary" type="button" data-action="download-report">Descargar informe</button>
          <button class="btn teal" type="button" data-action="copy-report">Copiar al portapapeles</button>
        </div>
      </article>
    </div>
  `;
}

function exportJson() {
  const payload = {
    exportedAt: nowISO(),
    arts: state.arts,
    routes: state.routes,
    experiences: state.experiences,
    skills: state.skills,
    users: hasRole('admin') ? state.users : [],
    invites: hasRole('admin') ? state.invites : [],
    settings: hasRole('admin') ? state.settings : {}
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mapa-crea-export-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function resetDemo() {
  if (state.mode !== 'demo') return;
  const ok = confirm('Esto borrará los datos demo locales. Firebase no se toca. ¿Continuar?');
  if (!ok) return;
  localStorage.removeItem('mapaCreaDemoDB');
  location.reload();
}

function roman(num) {
  const map = [['X',10],['IX',9],['V',5],['IV',4],['I',1]];
  let out = '';
  for (const [r, v] of map) while (num >= v) { out += r; num -= v; }
  return out || 'I';
}

async function createServices() {
  if (isFirebaseConfigured()) {
    try {
      return await createFirebaseServices();
    } catch (error) {
      console.warn('Firebase no cargó, usando demo local:', error);
      if (!USE_DEMO_WHEN_UNCONFIGURED) throw error;
      toast('No pude cargar Firebase. Abrí modo demo local para no dejarte mirando una pantalla triste.', 'error');
      return createDemoServices();
    }
  }
  return createDemoServices();
}

async function createFirebaseServices() {
  const [appMod, authMod, fsMod] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_CDN_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_CDN_VERSION}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_CDN_VERSION}/firebase-firestore.js`)
  ]);
  const firebaseApp = appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(firebaseApp);
  const db = fsMod.getFirestore(firebaseApp);

  const profileFromInviteOrAdmin = async (user) => {
    const email = normalizeEmail(user.email);
    const userRef = fsMod.doc(db, 'users', user.uid);
    const existing = await fsMod.getDoc(userRef);
    if (existing.exists()) return { id: existing.id, ...existing.data() };

    if (isAdminEmail(email)) {
      const profile = {
        uid: user.uid,
        email,
        name: email.includes('catalina') ? 'Cata' : 'Alek',
        role: 'admin',
        allowedArts: ['*'],
        allowedRoutes: ['*'],
        active: true,
        createdAt: nowISO(),
        updatedAt: nowISO()
      };
      await fsMod.setDoc(userRef, profile);
      return { id: user.uid, ...profile };
    }

    const inviteRef = fsMod.doc(db, 'teacherInvites', email);
    const invite = await fsMod.getDoc(inviteRef);
    if (!invite.exists() || invite.data().active === false) {
      await authMod.signOut(auth);
      throw new Error('Este correo no tiene invitación activa. Primero un admin debe invitarlo. Burocracia mínima, pero necesaria.');
    }
    const inv = invite.data();
    const profile = {
      uid: user.uid,
      email,
      name: inv.name || email,
      role: inv.role || 'docente_lector',
      allowedArts: inv.allowedArts || [],
      allowedRoutes: inv.allowedRoutes || [],
      active: true,
      createdAt: nowISO(),
      updatedAt: nowISO()
    };
    await fsMod.setDoc(userRef, profile);
    return { id: user.uid, ...profile };
  };

  const logChange = async ({ action, entityType, entityId, summary, before = null, after = null }) => {
    try {
      await fsMod.addDoc(fsMod.collection(db, 'changeLogs'), {
        action, entityType, entityId, summary, before, after,
        userId: auth.currentUser?.uid || 'system',
        userEmail: auth.currentUser?.email || 'system',
        createdAt: nowISO()
      });
    } catch (error) {
      console.warn('No se pudo guardar log', error);
    }
  };

  const readCol = async (path) => {
    const snap = await fsMod.getDocs(fsMod.collection(db, path));
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  };

  const readExperiencesForProfile = async (profile, routes) => {
    if (profile?.role === 'admin') return readCol('experiences');

    const collectionRef = fsMod.collection(db, 'experiences');
    const byId = new Map();

    const addSnap = (snap) => {
      snap.docs.forEach(doc => byId.set(doc.id, { id: doc.id, ...doc.data() }));
    };

    // Experiencias publicadas: todos los usuarios activos pueden verlas.
    const publishedSnap = await fsMod.getDocs(
      fsMod.query(collectionRef, fsMod.where('status', '==', 'published'))
    );
    addSnap(publishedSnap);

    const allowedArts = profile?.allowedArts || [];
    const allowedRoutes = profile?.allowedRoutes || [];
    const routeIds = allowedRoutes.includes('*')
      ? routes
          .filter(route => allowedArts.includes('*') || allowedArts.includes(route.artId))
          .map(route => route.id)
      : allowedRoutes;

    const uniqueRouteIds = [...new Set(routeIds)].filter(Boolean);
    for (let i = 0; i < uniqueRouteIds.length; i += 10) {
      const chunk = uniqueRouteIds.slice(i, i + 10);
      if (!chunk.length) continue;
      const snap = await fsMod.getDocs(
        fsMod.query(collectionRef, fsMod.where('routeId', 'in', chunk))
      );
      addSnap(snap);
    }

    return [...byId.values()];
  };

  return {
    mode: 'firebase',
    auth: {
      init(callback) {
        return new Promise(resolve => {
          authMod.onAuthStateChanged(auth, async user => {
            if (!user) { await callback(null, null); resolve(); return; }
            try {
              const profile = await profileFromInviteOrAdmin(user);
              await callback({ uid: user.uid, email: normalizeEmail(user.email) }, profile);
            } catch (error) {
              console.error(error);
              toast(error.message, 'error');
              await callback(null, null);
            }
            resolve();
          });
        });
      },
      async loginWithGoogle() {
        const provider = new authMod.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        const cred = await authMod.signInWithPopup(auth, provider);
        await profileFromInviteOrAdmin(cred.user);
      },
      async logout() { await authMod.signOut(auth); }
    },
    data: {
      async loadAll() {
        const [arts, routes, skills, logs, settingsSnap] = await Promise.all([
          readCol('arts'),
          readCol('routes'),
          readCol('skills'),
          readCol('changeLogs'),
          fsMod.getDoc(fsMod.doc(db, 'settings', 'componentCatalog'))
        ]);
        const settingsData = settingsSnap.exists() ? settingsSnap.data() : {};
        const componentCatalog = settingsData.components || {};
        const categoryCatalog = settingsData.categories || [];
        const sortedRoutes = routes.sort((a,b)=>(a.order||0)-(b.order||0));
        const experiences = await readExperiencesForProfile(state.profile, sortedRoutes);
        let users = [], invites = [];
        if (state.profile?.role === 'admin') {
          [users, invites] = await Promise.all([readCol('users'), readCol('teacherInvites')]);
        }
        return {
          arts: arts.sort((a,b)=>(a.order||0)-(b.order||0)),
          routes: sortedRoutes,
          experiences: experiences.sort((a,b)=>(a.order||0)-(b.order||0)),
          skills: skills.sort((a,b)=> (a.title||'').localeCompare(b.title||'')),
          users,
          invites,
          logs: logs.sort((a,b)=> new Date(b.createdAt || 0) - new Date(a.createdAt || 0)),
          settings: { componentCatalog, categoryCatalog }
        };
      },
      async saveSettings(payload) {
        if (!state.profile || state.profile.role !== 'admin') throw new Error('Solo admins pueden editar configuración.');
        const data = {
          updatedAt: nowISO(),
          updatedBy: state.user.uid,
          updatedByEmail: state.user.email
        };
        if (payload.componentCatalog) data.components = payload.componentCatalog;
        if (payload.categoryCatalog) data.categories = normalizeCategoryCatalog(payload.categoryCatalog);
        await fsMod.setDoc(fsMod.doc(db, 'settings', 'componentCatalog'), data, { merge: true });
        await logChange({ action: 'update', entityType: 'settings', entityId: 'componentCatalog', summary: 'Configuración de biblioteca actualizada', after: payload });
      },
      async saveSkill(payload) {
        const { id, ...data } = payload;
        if (id) {
          const ref = fsMod.doc(db, 'skills', id);
          const beforeSnap = await fsMod.getDoc(ref);
          await fsMod.setDoc(ref, data, { merge: true });
          await logChange({ action: 'update', entityType: 'skill', entityId: id, summary: `Saber actualizado: ${data.title}`, before: beforeSnap.exists() ? beforeSnap.data() : null, after: data });
        } else {
          const ref = await fsMod.addDoc(fsMod.collection(db, 'skills'), data);
          await logChange({ action: 'create', entityType: 'skill', entityId: ref.id, summary: `Saber creado: ${data.title}`, after: data });
        }
      },
      async deleteSkill(id, skill) {
        await fsMod.deleteDoc(fsMod.doc(db, 'skills', id));
        await logChange({ action: 'delete', entityType: 'skill', entityId: id, summary: `Saber eliminado: ${skill?.title || id}`, before: skill || null });
      },
      async saveArt(payload) {
        const { id, ...data } = payload;
        if (id) {
          const ref = fsMod.doc(db, 'arts', id);
          const beforeSnap = await fsMod.getDoc(ref);
          await fsMod.setDoc(ref, data, { merge: true });
          await logChange({ action: 'update', entityType: 'art', entityId: id, summary: `Arte actualizado: ${data.name}`, before: beforeSnap.exists() ? beforeSnap.data() : null, after: data });
        } else {
          const ref = await fsMod.addDoc(fsMod.collection(db, 'arts'), data);
          await logChange({ action: 'create', entityType: 'art', entityId: ref.id, summary: `Arte creado: ${data.name}`, after: data });
        }
      },
      async deleteArt(id, art) {
        await fsMod.deleteDoc(fsMod.doc(db, 'arts', id));
        await logChange({ action: 'delete', entityType: 'art', entityId: id, summary: `Arte eliminado: ${art?.name || id}`, before: art || null });
      },
      async saveRoute(payload) {
        const { id, ...data } = payload;
        if (id) {
          const ref = fsMod.doc(db, 'routes', id);
          const beforeSnap = await fsMod.getDoc(ref);
          await fsMod.setDoc(ref, data, { merge: true });
          await logChange({ action: 'update', entityType: 'route', entityId: id, summary: `Ruta actualizada: ${data.name}`, before: beforeSnap.exists() ? beforeSnap.data() : null, after: data });
        } else {
          const ref = await fsMod.addDoc(fsMod.collection(db, 'routes'), data);
          await logChange({ action: 'create', entityType: 'route', entityId: ref.id, summary: `Ruta creada: ${data.name}`, after: data });
        }
      },
      async deleteRoute(id, route) {
        await fsMod.deleteDoc(fsMod.doc(db, 'routes', id));
        await logChange({ action: 'delete', entityType: 'route', entityId: id, summary: `Ruta eliminada: ${route?.name || id}`, before: route || null });
      },
      async saveInvite(payload) {
        await fsMod.setDoc(fsMod.doc(db, 'teacherInvites', payload.email), payload, { merge: true });
        await logChange({ action: 'invite', entityType: 'teacherInvite', entityId: payload.email, summary: `Invitación guardada para ${payload.email}`, after: payload });
      },
      async saveExperience(payload) {
        const { id, ...data } = payload;
        if (id) {
          const ref = fsMod.doc(db, 'experiences', id);
          const beforeSnap = await fsMod.getDoc(ref);
          await fsMod.setDoc(ref, data, { merge: true });
          await logChange({ action: 'update', entityType: 'experience', entityId: id, summary: `Experiencia actualizada: ${data.label} ${data.name}`, before: beforeSnap.exists() ? beforeSnap.data() : null, after: data });
        } else {
          const ref = await fsMod.addDoc(fsMod.collection(db, 'experiences'), data);
          await logChange({ action: 'create', entityType: 'experience', entityId: ref.id, summary: `Experiencia creada: ${data.label} ${data.name}`, after: data });
        }
      },
      async deleteExperience(id, exp) {
        await fsMod.deleteDoc(fsMod.doc(db, 'experiences', id));
        await logChange({ action: 'delete', entityType: 'experience', entityId: id, summary: `Experiencia eliminada: ${exp?.label || ''} ${exp?.name || id}`.trim(), before: exp || null });
      },
    }
  };
}

function createDemoServices() {
  const storageKey = 'mapaCreaDemoDB';
  const sessionKey = 'mapaCreaDemoSession';
  const db = loadDemoDB();

  function saveDB() { localStorage.setItem(storageKey, JSON.stringify(db)); }
  function loadDemoDB() {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      parsed.skills ||= []; // Compatibilidad con DBs demo previas a la biblioteca.
      parsed.settings ||= { componentCatalog: {}, categoryCatalog: [] };
      parsed.settings.categoryCatalog ||= [];
      return parsed;
    }
    const initial = { users: [], invites: [], arts: [], routes: [], experiences: [], skills: [], changeLogs: [], settings: { componentCatalog: {}, categoryCatalog: [] } };
    localStorage.setItem(storageKey, JSON.stringify(initial));
    return initial;
  }
  function currentSession() {
    const raw = localStorage.getItem(sessionKey);
    return raw ? JSON.parse(raw) : null;
  }
  function setSession(user) { localStorage.setItem(sessionKey, JSON.stringify(user)); }
  function clearSession() { localStorage.removeItem(sessionKey); }
  function ensureProfile(email) {
    let profile = db.users.find(u => u.email === email);
    if (profile) return profile;
    if (isAdminEmail(email)) {
      profile = { id: uid('user'), uid: uid('uid'), email, name: email.includes('catalina') ? 'Cata' : 'Alek', role: 'admin', allowedArts: ['*'], allowedRoutes: ['*'], active: true, createdAt: nowISO(), updatedAt: nowISO() };
      db.users.push(profile); saveDB(); return profile;
    }
    const inv = db.invites.find(i => i.email === email && i.active !== false);
    if (!inv) throw new Error('Este correo no tiene invitación activa.');
    profile = { id: uid('user'), uid: uid('uid'), email, name: inv.name, role: inv.role, allowedArts: inv.allowedArts, allowedRoutes: inv.allowedRoutes, active: true, createdAt: nowISO(), updatedAt: nowISO() };
    db.users.push(profile); saveDB(); return profile;
  }
  function logChange(log) {
    db.changeLogs.push({ id: uid('log'), ...log, userId: currentSession()?.uid || 'demo', userEmail: currentSession()?.email || 'demo', createdAt: nowISO() });
    saveDB();
  }

  return {
    mode: 'demo',
    auth: {
      async init(callback) {
        const session = currentSession();
        if (!session) { await callback(null, null); return; }
        const profile = ensureProfile(session.email);
        await callback(session, profile);
      },
      async loginWithGoogle() {
        const raw = window.prompt('Modo demo: escribe el correo con el que quieres entrar');
        const email = normalizeEmail(raw || '');
        if (!email) throw new Error('Necesito un correo para entrar en modo demo.');
        const profile = ensureProfile(email);
        setSession({ uid: profile.uid || profile.id, email });
        state.user = { uid: profile.uid || profile.id, email };
        state.profile = profile;
        await loadData();
        render();
      },
      async logout() { clearSession(); state.user = null; state.profile = null; render(); }
    },
    data: {
      async loadAll() {
        return {
          arts: db.arts,
          routes: db.routes,
          experiences: db.experiences,
          skills: db.skills,
          users: db.users,
          invites: db.invites,
          logs: db.changeLogs.sort((a,b)=> new Date(b.createdAt || 0) - new Date(a.createdAt || 0)),
          settings: db.settings || { componentCatalog: {}, categoryCatalog: [] }
        };
      },
      async saveSettings(payload) {
        if (!hasRole('admin')) throw new Error('Solo admins pueden editar configuración.');
        db.settings = { ...(db.settings || {}) };
        if (payload.componentCatalog) db.settings.componentCatalog = payload.componentCatalog;
        if (payload.categoryCatalog) db.settings.categoryCatalog = normalizeCategoryCatalog(payload.categoryCatalog);
        logChange({ action: 'update', entityType: 'settings', entityId: 'componentCatalog', summary: 'Configuración de biblioteca actualizada', after: payload });
        saveDB();
      },
      async saveSkill(payload) {
        if (payload.id) {
          const idx = db.skills.findIndex(s => s.id === payload.id);
          const before = idx >= 0 ? db.skills[idx] : null;
          if (idx >= 0) db.skills[idx] = { ...db.skills[idx], ...payload };
          logChange({ action: 'update', entityType: 'skill', entityId: payload.id, summary: `Saber actualizado: ${payload.title}`, before, after: payload });
        } else {
          const skill = { id: uid('skill'), ...payload };
          db.skills.push(skill);
          logChange({ action: 'create', entityType: 'skill', entityId: skill.id, summary: `Saber creado: ${skill.title}`, after: skill });
        }
        saveDB();
      },
      async deleteSkill(id, skill) {
        db.skills = db.skills.filter(s => s.id !== id);
        logChange({ action: 'delete', entityType: 'skill', entityId: id, summary: `Saber eliminado: ${skill?.title || id}`, before: skill || null });
        saveDB();
      },
      async saveArt(payload) {
        if (payload.id) {
          const idx = db.arts.findIndex(a => a.id === payload.id);
          const before = idx >= 0 ? db.arts[idx] : null;
          if (idx >= 0) db.arts[idx] = { ...db.arts[idx], ...payload };
          logChange({ action: 'update', entityType: 'art', entityId: payload.id, summary: `Arte actualizado: ${payload.name}`, before, after: payload });
        } else {
          const art = { id: uid('art'), ...payload };
          db.arts.push(art); logChange({ action: 'create', entityType: 'art', entityId: art.id, summary: `Arte creado: ${art.name}`, after: art });
        }
        saveDB();
      },
      async deleteArt(id, art) {
        db.arts = db.arts.filter(a => a.id !== id);
        logChange({ action: 'delete', entityType: 'art', entityId: id, summary: `Arte eliminado: ${art?.name || id}`, before: art || null });
        saveDB();
      },
      async saveRoute(payload) {
        if (payload.id) {
          const idx = db.routes.findIndex(r => r.id === payload.id);
          const before = idx >= 0 ? db.routes[idx] : null;
          if (idx >= 0) db.routes[idx] = { ...db.routes[idx], ...payload };
          logChange({ action: 'update', entityType: 'route', entityId: payload.id, summary: `Ruta actualizada: ${payload.name}`, before, after: payload });
        } else {
          const route = { id: uid('route'), ...payload };
          db.routes.push(route); logChange({ action: 'create', entityType: 'route', entityId: route.id, summary: `Ruta creada: ${route.name}`, after: route });
        }
        saveDB();
      },
      async deleteRoute(id, route) {
        db.routes = db.routes.filter(r => r.id !== id);
        logChange({ action: 'delete', entityType: 'route', entityId: id, summary: `Ruta eliminada: ${route?.name || id}`, before: route || null });
        saveDB();
      },
      async saveInvite(payload) {
        const idx = db.invites.findIndex(i => i.email === payload.email);
        if (idx >= 0) db.invites[idx] = { ...db.invites[idx], ...payload };
        else db.invites.push(payload);
        logChange({ action: 'invite', entityType: 'teacherInvite', entityId: payload.email, summary: `Invitación guardada para ${payload.email}`, after: payload });
        saveDB();
      },
      async saveExperience(payload) {
        if (payload.id) {
          const idx = db.experiences.findIndex(e => e.id === payload.id);
          const before = idx >= 0 ? db.experiences[idx] : null;
          db.experiences[idx] = { ...db.experiences[idx], ...payload };
          logChange({ action: 'update', entityType: 'experience', entityId: payload.id, summary: `Experiencia actualizada: ${payload.label} ${payload.name}`, before, after: payload });
        } else {
          const exp = { id: uid('exp'), ...payload };
          db.experiences.push(exp);
          logChange({ action: 'create', entityType: 'experience', entityId: exp.id, summary: `Experiencia creada: ${exp.label} ${exp.name}`, after: exp });
        }
        saveDB();
      },
      async deleteExperience(id, exp) {
        db.experiences = db.experiences.filter(e => e.id !== id);
        logChange({ action: 'delete', entityType: 'experience', entityId: id, summary: `Experiencia eliminada: ${exp?.label || ''} ${exp?.name || id}`.trim(), before: exp || null });
        saveDB();
      },
    }
  };
}


init();
