export const PUBLISHED_CURRICULUM_IDS = Object.freeze(['piano', 'guitarra', 'violin', 'bateria']);
export const PUBLISHED_CURRICULUM_ID = 'piano';
export const PUBLISHED_CURRICULUM_SCHEMA_VERSION = 1;
export const FIRESTORE_DOCUMENT_MAX_BYTES = 1_048_576;
// Firestore cuenta nombres de campos y metadatos además del JSON. Dejamos margen
// suficiente para que el documento nunca se acerque al límite real de 1 MiB.
export const PUBLISHED_CURRICULUM_MAX_BYTES = 900_000;

const PUBLIC_COMPONENTS = new Set(['tecnica', 'teorico', 'repertorio']);
const DEFAULT_PERSONAL_REPERTOIRE = Object.freeze({
  title: 'Canciones personales',
  focus: 'Avanzar de forma gradual en una canción elegida por el estudiante, conectando sus gustos con los saberes de esta experiencia.',
  evidence: 'Se reconoce un avance concreto: una sección, fragmento, recurso técnico o interpretación de la canción personal.'
});

function text(value) {
  return String(value ?? '').trim();
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonicalValue(value[key])])
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function estimateDocumentBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

async function sha256Hex(value, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) throw new Error('No hay soporte criptográfico para calcular la revisión del currículo.');
  const bytes = new TextEncoder().encode(value);
  const digest = await cryptoImpl.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function sourceUpdatedAtFor(items) {
  const timestamps = items
    .flatMap(item => [item?.updatedAt, item?.createdAt])
    .map(value => ({ value, time: new Date(value || '').getTime() }))
    .filter(item => Number.isFinite(item.time))
    .sort((a, b) => b.time - a.time);
  return timestamps.length ? new Date(timestamps[0].time).toISOString() : '';
}

function publicPersonalRepertoire(experience) {
  const stored = experience?.personalRepertoire || {};
  return {
    title: text(stored.title) || DEFAULT_PERSONAL_REPERTOIRE.title,
    focus: text(stored.focus) || DEFAULT_PERSONAL_REPERTOIRE.focus,
    evidence: text(stored.evidence) || DEFAULT_PERSONAL_REPERTOIRE.evidence
  };
}

function routeLabel(curriculumId) {
  return ({ piano: 'Piano', guitarra: 'Guitarra', violin: 'Violín', bateria: 'Batería' })[curriculumId] || curriculumId;
}

function assertPublishedExperienceOrder(experiences, curriculumId) {
  const orders = new Set();
  experiences.forEach((experience, index) => {
    const order = Number(experience.order);
    const previous = index ? Number(experiences[index - 1].order) : 0;
    if (!Number.isInteger(order) || order <= 0 || orders.has(order) || order <= previous) {
      throw new Error(`La ruta ${routeLabel(curriculumId)} tiene un orden de experiencias inválido o repetido.`);
    }
    orders.add(order);
    if (order !== index + 1) {
      const expected = index + 1;
      throw new Error(`La ruta ${routeLabel(curriculumId)} no se puede publicar: esperaba el orden ${expected} y encontré ${experience.order || '—'}.`);
    }
  });
}

function assertUniqueIds(items, label, curriculumId) {
  const ids = items.map(item => text(item?.id));
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) {
    throw new Error(`La ruta ${routeLabel(curriculumId)} no se puede publicar: hay ${label} sin ID o con ID repetido.`);
  }
}

function buildWhitelistedContent({ projectId, arts = [], routes = [], experiences = [], skills = [] }, curriculumId) {
  if (!PUBLISHED_CURRICULUM_IDS.includes(curriculumId)) {
    throw new Error(`El currículo "${curriculumId}" no está autorizado para publicación.`);
  }
  const matchingRoutes = routes.filter(route => text(route.slug).toLowerCase() === curriculumId && route.active !== false);
  if (matchingRoutes.length !== 1) {
    throw new Error(`La publicación necesita exactamente una ruta activa con slug "${curriculumId}"; encontré ${matchingRoutes.length}.`);
  }

  const route = matchingRoutes[0];
  const art = arts.find(item => item.id === route.artId);
  if (!art || art.active === false) throw new Error(`La ruta ${routeLabel(curriculumId)} no tiene un arte activo válido.`);

  const publishedExperiences = experiences
    .filter(experience => experience.routeId === route.id && experience.status === 'published')
    .slice()
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

  if (!publishedExperiences.length) throw new Error(`La ruta ${routeLabel(curriculumId)} no tiene experiencias publicadas.`);
  assertUniqueIds(publishedExperiences, 'experiencias', curriculumId);
  assertPublishedExperienceOrder(publishedExperiences, curriculumId);

  const experienceById = new Map(publishedExperiences.map(experience => [experience.id, experience]));
  const experienceOrder = new Map(publishedExperiences.map(experience => [experience.id, Number(experience.order)]));
  const skillById = new Map(skills.map(skill => [skill.id, skill]));
  const referencedSkills = new Map();
  let goalCount = 0;

  const publicExperiences = publishedExperiences.map((experience, publicIndex) => {
    const prerequisiteExperienceIds = uniqueStrings(experience.prerequisiteExperienceIds)
      .map(id => {
        const prerequisite = experienceById.get(id);
        if (!prerequisite) {
          throw new Error(`${experience.label || experience.name} apunta a una experiencia previa que no está publicada: ${id}.`);
        }
        if (experienceOrder.get(id) >= Number(experience.order)) {
          throw new Error(`${experience.label || experience.name} tiene un prerrequisito ubicado después en la ruta.`);
        }
        return id;
      })
      .sort((a, b) => experienceOrder.get(a) - experienceOrder.get(b));

    const seenGoalIds = new Set();
    const publicSkills = (Array.isArray(experience.skillRefs) ? experience.skillRefs : []).map(reference => {
      const skillId = text(reference?.skillId);
      const skill = skillById.get(skillId);
      if (!skill) {
        throw new Error(`${experience.label || experience.name} apunta a un saber eliminado o inexistente: ${skillId || '—'}.`);
      }
      if (skill.artId !== route.artId || !uniqueStrings(skill.routeIds).includes(route.id)) {
        throw new Error(`El saber "${skill.title || skillId}" no pertenece a la ruta ${routeLabel(curriculumId)}.`);
      }
      if (!PUBLIC_COMPONENTS.has(skill.component)) {
        throw new Error(`El saber "${skill.title || skillId}" usa un componente no publicable: ${skill.component || '—'}.`);
      }

      const goalId = `${experience.id}:${skill.id}`;
      if (seenGoalIds.has(goalId)) throw new Error(`${experience.label || experience.name} repite el saber "${skill.title || skill.id}".`);
      seenGoalIds.add(goalId);
      referencedSkills.set(skill.id, skill);
      goalCount += 1;

      // Lista blanca deliberada: nunca copiar tags, prerrequisitos de biblioteca,
      // autores, correos ni ninguna otra metadata editorial.
      return {
        goalId,
        id: skill.id,
        component: skill.component,
        category: text(skill.category),
        title: text(skill.title),
        description: text(skill.description),
        achievement: text(skill.achievement),
        difficulty: text(skill.difficulty),
        note: text(reference.note)
      };
    });

    if (!publicSkills.length) throw new Error(`${experience.label || experience.name} no tiene saberes publicables.`);

    // Lista blanca deliberada: teacherNotes e internalNotes no tienen camino hacia
    // este objeto y por lo tanto nunca llegan al documento de lectura pública.
    return {
      id: experience.id,
      order: Number(experience.order),
      label: text(experience.label),
      name: text(experience.name),
      difficulty: text(experience.difficulty),
      estimatedDuration: text(experience.estimatedDuration),
      suggestedAge: text(experience.suggestedAge),
      description: text(experience.description),
      objective: text(experience.objective),
      prerequisites: text(experience.prerequisites),
      prerequisiteExperienceIds,
      evidence: text(experience.evidence),
      personalRepertoire: publicPersonalRepertoire(experience),
      skills: publicSkills
    };
  });

  const sourceItems = [art, route, ...publishedExperiences, ...referencedSkills.values()];
  const sourceUpdatedAt = sourceUpdatedAtFor(sourceItems);

  const revisionContent = {
    schemaVersion: PUBLISHED_CURRICULUM_SCHEMA_VERSION,
    routeKey: curriculumId,
    source: {
      projectId: text(projectId),
      artId: art.id,
      routeId: route.id,
      slug: curriculumId
    },
    route: {
      name: text(route.name),
      description: text(route.description),
      artName: text(art.name)
    },
    experienceCount: publicExperiences.length,
    goalCount,
    experiences: publicExperiences
  };

  return { revisionContent, sourceUpdatedAt };
}

export async function buildPublishedCurriculumSnapshot(input, options = {}) {
  const curriculumId = text(options.curriculumId || PUBLISHED_CURRICULUM_ID).toLowerCase();
  const { revisionContent, sourceUpdatedAt } = buildWhitelistedContent(input, curriculumId);
  const revision = `sha256:${await sha256Hex(canonicalJson(revisionContent), options.cryptoImpl)}`;
  const snapshot = {
    ...revisionContent,
    revision,
    sourceUpdatedAt
  };

  // publishedAt se agrega con serverTimestamp al escribir. Un ISO de referencia
  // reserva más que suficiente espacio para ese campo durante la verificación.
  const byteLength = estimateDocumentBytes({ ...snapshot, publishedAt: new Date().toISOString() });
  const maxBytes = Number(options.maxBytes || PUBLISHED_CURRICULUM_MAX_BYTES);
  if (byteLength > maxBytes || byteLength >= FIRESTORE_DOCUMENT_MAX_BYTES) {
    throw new Error(`El currículo pesa ${byteLength.toLocaleString('es-CO')} bytes y supera el límite seguro de ${maxBytes.toLocaleString('es-CO')} bytes.`);
  }

  return { snapshot, byteLength };
}
