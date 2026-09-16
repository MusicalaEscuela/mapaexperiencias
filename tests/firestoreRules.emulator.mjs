import assert from 'node:assert/strict';

const projectId = 'mapa-de-experiencias';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (!emulatorHost) throw new Error('Esta prueba debe ejecutarse dentro de firebase emulators:exec.');

const base = `http://${emulatorHost}/v1/projects/${projectId}/databases/(default)/documents`;

function mockFirebaseToken({ uid, email }) {
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    iss: `https://securetoken.google.com/${projectId}`,
    aud: projectId,
    auth_time: now,
    user_id: uid,
    sub: uid,
    iat: now,
    exp: now + 3600,
    email,
    email_verified: true,
    firebase: {
      identities: { email: [email] },
      sign_in_provider: 'google.com'
    }
  })}.`;
}

async function request(method, path, { token, body } = {}) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

const revision = `sha256:${'a'.repeat(64)}`;
const validDocument = {
  fields: {
    schemaVersion: { integerValue: '1' },
    routeKey: { stringValue: 'piano' },
    source: {
      mapValue: {
        fields: {
          projectId: { stringValue: projectId },
          artId: { stringValue: 'art_music' },
          routeId: { stringValue: 'route_piano' },
          slug: { stringValue: 'piano' }
        }
      }
    },
    route: {
      mapValue: {
        fields: {
          name: { stringValue: 'Piano' },
          description: { stringValue: 'Ruta canónica' },
          artName: { stringValue: 'Música' }
        }
      }
    },
    experienceCount: { integerValue: '1' },
    goalCount: { integerValue: '1' },
    experiences: {
      arrayValue: {
        values: [{ mapValue: { fields: { id: { stringValue: 'exp_1' } } } }]
      }
    },
    revision: { stringValue: revision },
    sourceUpdatedAt: { stringValue: '2026-08-15T00:00:00.000Z' },
    publishedAt: { timestampValue: '2026-08-15T00:00:00.000Z' }
  }
};

const adminToken = mockFirebaseToken({ uid: 'admin-test', email: 'alekcaballeromusic@gmail.com' });
const outsiderToken = mockFirebaseToken({ uid: 'outsider-test', email: 'outsider@example.com' });
const documentPath = '/published_curricula/piano';

let response = await request('PATCH', documentPath, { token: adminToken, body: validDocument });
assert.equal(response.status, 200, `admin create: ${response.status} ${await response.text()}`);

response = await request('GET', documentPath);
assert.equal(response.status, 200, 'el documento piano debe permitir get público');

response = await request('GET', '/published_curricula?pageSize=10');
assert.equal(response.status, 403, 'la colección no debe permitir list público');

response = await request('GET', '/published_curricula/otro');
assert.equal(response.status, 403, 'ningún otro documento debe tener lectura pública');

response = await request('PATCH', documentPath, { token: outsiderToken, body: validDocument });
assert.equal(response.status, 403, 'un usuario no admin no puede actualizar el snapshot');

const invalidDocument = structuredClone(validDocument);
invalidDocument.fields.teacherNotes = { stringValue: 'No debe pasar la lista blanca' };
response = await request('PATCH', documentPath, { token: adminToken, body: invalidDocument });
assert.equal(response.status, 403, 'ni un admin puede publicar campos superiores fuera del contrato');

response = await request('DELETE', documentPath, { token: adminToken });
assert.equal(response.status, 403, 'el snapshot no se puede eliminar desde clientes');

// El token owner del emulador omite reglas y solo limpia el dato efímero de prueba.
await request('DELETE', documentPath, { token: 'owner' });
console.log('Reglas verificadas: get público exacto; sin list; solo admin escribe; sin delete.');
