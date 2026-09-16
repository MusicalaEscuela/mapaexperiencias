# Configuración de Firebase para Mapa CREA

## 1. Crear proyecto

Entra a Firebase Console y crea un proyecto nuevo para Musicala, por ejemplo:

```txt
mapa-crea-musicala
```

## 2. Crear app web

Dentro del proyecto:

1. Ve a descripción general del proyecto.
2. Agrega una app web.
3. Copia el objeto de configuración.
4. Pégalo en `js/firebaseConfig.js`.

Ejemplo de cómo debe quedar:

```js
export const firebaseConfig = {
  apiKey: "...",
  authDomain: "mapa-crea-musicala.firebaseapp.com",
  projectId: "mapa-crea-musicala",
  storageBucket: "mapa-crea-musicala.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
```

## 3. Activar Authentication

Activa el proveedor:

```txt
Authentication > Sign-in method > Email/Password
```

Los admins iniciales son:

```txt
alekcaballeromusic@gmail.com
catalina.medina.leal@gmail.com
```

Primero deben crear cuenta desde la pantalla de la app.

## 4. Crear Cloud Firestore

Crea una base de datos Firestore en modo producción.

Después publica el archivo:

```txt
firestore.rules
```

Puedes copiar y pegar su contenido en:

```txt
Firestore Database > Rules
```

O usar Firebase CLI:

```bash
firebase login
firebase init
firebase deploy --only firestore:rules
```

## 5. Hosting opcional

Para desplegar en Firebase Hosting:

```bash
firebase login
firebase init hosting
firebase deploy --only hosting
```

Este proyecto ya trae `firebase.json` con carpeta pública en la raíz.

## 6. Flujo de docentes

1. Admin entra a la app.
2. Admin va a **Docentes y permisos**.
3. Crea invitación con correo, rol, artes y rutas.
4. Docente abre la app.
5. Docente pulsa **Crear cuenta** con ese mismo correo.
6. La app crea el perfil del docente a partir de la invitación.

## 7. Empezar de cero

La app arranca vacía. Construye el mapa en este orden: artes → rutas → biblioteca de saberes → experiencias (armadas con saberes desde el Tablero).
