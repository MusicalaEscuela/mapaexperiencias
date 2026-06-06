# Mapa CREA · Musicala

Aplicativo web para construir y administrar el mapa de experiencias de aprendizaje de Musicala.

En esta app, una **experiencia** es un nivel progresivo dentro de una ruta artística. Por ejemplo:

- Violín · Experiencia I: escalas en primera posición.
- Violín · Experiencia II: escalas con sostenidos.
- Piano · Experiencia I: cinco notas y postura.

Cada experiencia puede organizarse en componentes:

- Técnica
- Teórico
- Repertorio
- Creativo / expresivo

## Qué incluye

- Login con Google (Firebase Authentication).
- Modo demo local con `localStorage` si todavía no hay Firebase configurado.
- Firebase Auth + Cloud Firestore cuando se pega la configuración real.
- Roles:
  - Admin
  - Docente editor
  - Docente lector
  - Coordinador
- Admins iniciales:
  - `alekcaballeromusic@gmail.com`
  - `catalina.medina.leal@gmail.com`
- Gestión de artes.
- Gestión de rutas por arte.
- **Biblioteca de saberes**: universo reutilizable de conocimientos por arte (técnica, teórico, repertorio, creativo), con dificultad, etiquetas y prerrequisitos. Es el mapa completo de "todo lo que se puede hacer" antes de repartirlo por niveles.
- Gestión de experiencias.
- Componentes internos por experiencia.
- Recursos por experiencia.
- Vista de mapa tipo timeline.
- **Tablero de armado (kanban)**: arrastra saberes de la biblioteca a cada nivel y entre niveles, con un mapa de cobertura (niveles × componentes) que resalta los vacíos curriculares.
- **Grafo de prerrequisitos**: mapa de dependencias entre saberes por capas topológicas, más una validación que avisa cuando un saber aparece en una ruta antes que sus prerrequisitos (o sin ellos).
- Vista comparativa de experiencias por ruta.
- Gestión de invitaciones a docentes.
- Historial de cambios.
- Exportación JSON.
- Reglas base de seguridad para Firestore.

## Estructura

```txt
mapa-crea-musicala/
├── index.html
├── css/
│   └── styles.css
├── js/
│   ├── app.js
│   └── firebaseConfig.js
├── docs/
│   └── firebase-setup.md
├── firestore.rules
├── firestore.indexes.json
├── firebase.json
└── README.md
```

## Cómo probar rápido en modo demo

Abre el proyecto con un servidor local. No abras el archivo directamente con doble clic, porque los módulos JavaScript del navegador se ponen delicados, como si uno les estuviera pidiendo terapia de pareja.

Opción con Python:

```bash
cd mapa-crea-musicala
python -m http.server 8080
```

Luego abre:

```txt
http://localhost:8080
```

En modo demo pulsa **Ingresar con Google** y escribe en el aviso uno de los correos admin:

```txt
alekcaballeromusic@gmail.com
catalina.medina.leal@gmail.com
```

En demo no hay validación real contra servidor; solo simula la sesión con ese correo.

## Cómo conectar Firebase

1. Crea un proyecto en Firebase.
2. Registra una app web.
3. Copia el objeto `firebaseConfig`.
4. Pégalo en:

```txt
js/firebaseConfig.js
```

5. Activa Authentication con el proveedor Google y agrega tus dominios autorizados.
6. Crea Cloud Firestore.
7. Publica las reglas de seguridad desde:

```txt
firestore.rules
```

8. Ejecuta la app desde servidor local o súbela a Firebase Hosting / GitHub Pages.

## Primer ingreso real con Firebase

Con Firebase ya conectado:

1. Entra a la app.
2. Pulsa **Ingresar con Google**.
3. Usa una cuenta de Google con uno de los correos admin iniciales.
4. La app creará automáticamente el perfil admin en Firestore.

Luego desde **Docentes y permisos** puedes invitar docentes. El docente debe ingresar con Google usando exactamente el mismo correo invitado.

## Recomendación de uso

Primero construyan:

1. Artes.
2. Rutas.
3. **Biblioteca de saberes** del arte (técnica, teórico, repertorio, creativo), con su dificultad y prerrequisitos. Este es el universo completo de lo que se puede enseñar.
4. Experiencias (niveles), **armándolas con saberes elegidos de la biblioteca** y ordenándolos en la secuencia de enseñanza.

Un mismo saber puede usarse en varias experiencias sin duplicarlo: la experiencia guarda referencias (`skillRefs`) a los saberes, más una nota opcional por nivel.

Después sí conecten estudiantes y progreso individual. Si intentan meter estudiantes, evaluaciones, informes, asistencias y facturación desde la primera versión, felicitaciones: acaban de inventar un monstruo administrativo con interfaz bonita.

## Seguridad

La seguridad importante no está solo en esconder botones del frontend. Este proyecto incluye `firestore.rules` para que Firestore valide roles, permisos y accesos desde servidor.

Puntos importantes:

- Los admins iniciales están definidos en la app y en las reglas.
- Los docentes deben estar invitados en `teacherInvites`.
- Los usuarios autenticados crean su perfil desde la invitación.
- Las experiencias no se eliminan definitivamente; se archivan.
- Los permisos por arte y ruta se guardan en el perfil del usuario.

## Colecciones usadas en Firestore

```txt
users
teacherInvites
arts
routes
experiences
skills
changeLogs
```

## Nota técnica sobre correos

Usa siempre correos en minúscula para invitaciones y cuentas. La app los normaliza, pero para evitar berrinches innecesarios con reglas de seguridad, no mezcles mayúsculas.
