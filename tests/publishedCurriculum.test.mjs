import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PUBLISHED_CURRICULUM_MAX_BYTES,
  buildPublishedCurriculumSnapshot,
  estimateDocumentBytes
} from '../js/publishedCurriculum.js';

function fixture() {
  const art = {
    id: 'art_music',
    name: 'Música',
    active: true,
    updatedAt: '2026-08-01T00:00:00.000Z'
  };
  const piano = {
    id: 'route_piano',
    artId: art.id,
    slug: 'piano',
    name: 'Piano',
    description: 'Ruta canónica',
    active: true,
    updatedAt: '2026-08-02T00:00:00.000Z'
  };
  const guitar = {
    id: 'route_guitar',
    artId: art.id,
    slug: 'guitarra',
    name: 'Guitarra',
    active: true
  };

  return {
    projectId: 'mapa-de-experiencias',
    arts: [art],
    routes: [piano, guitar],
    experiences: [
      {
        id: 'exp_1',
        artId: art.id,
        routeId: piano.id,
        order: 1,
        label: 'Experiencia I',
        name: 'Inicio',
        status: 'published',
        difficulty: 'inicial',
        description: 'Descripción uno',
        objective: 'Objetivo uno',
        prerequisites: '',
        prerequisiteExperienceIds: [],
        evidence: 'Evidencia uno',
        teacherNotes: 'SECRETO_DOCENTE',
        internalNotes: 'SECRETO_INTERNO',
        tags: ['NO_PUBLICAR'],
        skillRefs: [
          { skillId: 'skill_1', note: 'Nota de esta experiencia' },
          { skillId: 'skill_2', note: '' }
        ],
        updatedAt: '2026-08-03T00:00:00.000Z'
      },
      {
        id: 'exp_2',
        artId: art.id,
        routeId: piano.id,
        order: 2,
        label: 'Experiencia II',
        name: 'Continuación',
        status: 'published',
        difficulty: 'basico',
        estimatedDuration: '4 clases',
        suggestedAge: 'Todas',
        description: 'Descripción dos',
        objective: 'Objetivo dos',
        prerequisites: 'Dominar el inicio',
        prerequisiteExperienceIds: ['exp_1'],
        evidence: 'Evidencia dos',
        personalRepertoire: {
          title: 'Mi canción',
          focus: 'Aplicar el ritmo',
          evidence: 'Tocar una sección'
        },
        skillRefs: [{ skillId: 'skill_3', note: '' }],
        updatedAt: '2026-08-04T00:00:00.000Z'
      },
      {
        id: 'draft_ignored',
        artId: art.id,
        routeId: piano.id,
        order: 3,
        status: 'draft',
        skillRefs: [{ skillId: 'missing_draft_skill' }]
      },
      {
        id: 'other_route_ignored',
        artId: art.id,
        routeId: guitar.id,
        order: 1,
        status: 'published',
        skillRefs: [{ skillId: 'unused_skill' }]
      }
    ],
    skills: [
      {
        id: 'skill_1',
        artId: art.id,
        routeIds: [piano.id],
        component: 'tecnica',
        category: 'Postura',
        title: 'Postura inicial',
        description: 'Ubicación cómoda',
        achievement: 'Mantiene postura funcional',
        difficulty: 'inicial',
        tags: ['PRIVADO_TAG'],
        prerequisites: ['DELETED_PREREQUISITE'],
        updatedByEmail: 'privado@example.com',
        updatedAt: '2026-08-05T00:00:00.000Z'
      },
      {
        id: 'skill_2',
        artId: art.id,
        routeIds: [piano.id],
        component: 'teorico',
        category: 'Ritmo',
        title: 'Pulso',
        description: 'Pulso estable',
        achievement: 'Sostiene el pulso',
        difficulty: 'inicial',
        updatedAt: '2026-08-06T00:00:00.000Z'
      },
      {
        id: 'skill_3',
        artId: art.id,
        routeIds: [piano.id],
        component: 'repertorio',
        category: 'Canciones',
        title: 'Primera canción',
        description: 'Melodía breve',
        achievement: 'La interpreta completa',
        difficulty: 'basico',
        updatedAt: '2026-08-07T00:00:00.000Z'
      },
      {
        id: 'unused_skill',
        artId: art.id,
        routeIds: [piano.id, guitar.id],
        component: 'tecnica',
        category: 'Escalas',
        title: 'No asignado',
        description: 'NO_PUBLICAR_SIN_REFERENCIA',
        achievement: '',
        difficulty: 'avanzado',
        updatedAt: '2026-08-30T00:00:00.000Z'
      }
    ]
  };
}

test('publica solo Piano publicado y resuelve metas con IDs estables', async () => {
  const { snapshot, byteLength } = await buildPublishedCurriculumSnapshot(fixture());

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.routeKey, 'piano');
  assert.equal(snapshot.experienceCount, 2);
  assert.equal(snapshot.goalCount, 3);
  assert.deepEqual(snapshot.experiences.map(item => item.id), ['exp_1', 'exp_2']);
  assert.equal(snapshot.experiences[0].skills[0].goalId, 'exp_1:skill_1');
  assert.equal(snapshot.experiences[1].skills[0].id, 'skill_3');
  assert.match(snapshot.revision, /^sha256:[0-9a-f]{64}$/);
  assert.equal(snapshot.sourceUpdatedAt, '2026-08-07T00:00:00.000Z');
  assert.ok(byteLength > 0 && byteLength < PUBLISHED_CURRICULUM_MAX_BYTES);
  assert.equal(byteLength, estimateDocumentBytes({ ...snapshot, publishedAt: new Date().toISOString() }));
});

test('la lista blanca excluye notas privadas, tags, prerequisitos de saberes y no asignados', async () => {
  const { snapshot } = await buildPublishedCurriculumSnapshot(fixture());
  const json = JSON.stringify(snapshot);

  assert.doesNotMatch(json, /SECRETO_DOCENTE|SECRETO_INTERNO|PRIVADO_TAG|DELETED_PREREQUISITE|privado@example\.com|NO_PUBLICAR_SIN_REFERENCIA/);
  assert.deepEqual(Object.keys(snapshot.experiences[0].skills[0]), [
    'goalId', 'id', 'component', 'category', 'title', 'description', 'achievement', 'difficulty', 'note'
  ]);
  assert.equal('teacherNotes' in snapshot.experiences[0], false);
  assert.equal('internalNotes' in snapshot.experiences[0], false);
  assert.equal('tags' in snapshot.experiences[0].skills[0], false);
  assert.equal('prerequisites' in snapshot.experiences[0].skills[0], false);
});

test('aplica Canciones personales por defecto sin alterar una personalización existente', async () => {
  const { snapshot } = await buildPublishedCurriculumSnapshot(fixture());

  assert.equal(snapshot.experiences[0].personalRepertoire.title, 'Canciones personales');
  assert.match(snapshot.experiences[0].personalRepertoire.focus, /canción elegida/);
  assert.deepEqual(snapshot.experiences[1].personalRepertoire, {
    title: 'Mi canción',
    focus: 'Aplicar el ritmo',
    evidence: 'Tocar una sección'
  });
});

test('Guitarra puede crecer sin un número fijo de experiencias publicadas', async () => {
  const data = fixture();
  const { snapshot } = await buildPublishedCurriculumSnapshot(data, { curriculumId: 'guitarra' });

  assert.equal(snapshot.routeKey, 'guitarra');
  assert.equal(snapshot.experienceCount, 1);
  assert.deepEqual(snapshot.experiences.map(item => item.id), ['other_route_ignored']);
});

test('la revisión ignora campos privados y cambia con contenido canónico', async () => {
  const original = fixture();
  const privateEdit = structuredClone(original);
  privateEdit.experiences[0].teacherNotes = 'Otra nota privada';
  privateEdit.experiences[0].internalNotes = 'Otra observación';
  privateEdit.experiences[0].updatedAt = '2026-09-01T00:00:00.000Z';
  privateEdit.skills[0].tags = ['otro tag'];
  privateEdit.skills[0].prerequisites = ['otro eliminado'];
  const canonicalEdit = structuredClone(original);
  canonicalEdit.experiences[0].objective = 'Objetivo canónico nuevo';

  const a = await buildPublishedCurriculumSnapshot(original);
  const b = await buildPublishedCurriculumSnapshot(privateEdit);
  const c = await buildPublishedCurriculumSnapshot(canonicalEdit);

  assert.equal(a.snapshot.revision, b.snapshot.revision);
  assert.notEqual(a.snapshot.sourceUpdatedAt, b.snapshot.sourceUpdatedAt);
  assert.notEqual(a.snapshot.revision, c.snapshot.revision);
});

test('bloquea referencias rotas, secuencias incompletas y documentos demasiado grandes', async () => {
  const missingSkill = fixture();
  missingSkill.experiences[0].skillRefs[0].skillId = 'missing';
  await assert.rejects(buildPublishedCurriculumSnapshot(missingSkill), /saber eliminado o inexistente/);

  const orderGap = fixture();
  orderGap.experiences[1].order = 3;
  await assert.rejects(buildPublishedCurriculumSnapshot(orderGap), /esperaba el orden 2/);

  await assert.rejects(
    buildPublishedCurriculumSnapshot(fixture(), { maxBytes: 500 }),
    /supera el límite seguro/
  );
});
