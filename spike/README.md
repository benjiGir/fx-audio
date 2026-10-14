# Prototype jetable (phase 1)

Ce dossier n'est **pas** la bibliothèque. C'est un prototype jetable qui répond à trois questions avant d'écrire le vrai cœur de `fx-audio` :

1. Que pèse un cœur écrit avec Effect 4, construit avec rolldown ?
2. Que coûte Effect sur le chemin de `play()` ?
3. Quels formats `node-web-audio-api` sait-il décoder sous Node ?

Il contient un mini-cœur (service `AudioContext`, `Layer` navigateur et Node, `load`, `decode`, `play` avec `Scope`, erreurs typées, façade promesse) et trois bancs de mesure. Les versions sont figées : `effect` 4.0.4, `node-web-audio-api` 2.2.0, `rolldown` 1.2.14.

```sh
cd spike
npm install
npm run typecheck
npm run size      # poids des bundles (rolldown)
npm run decode    # décodage Node + rendu hors ligne d'un fondu (nécessite ffmpeg)
npm run latency   # coût de play(), contexte simulé puis moteur réel
```

## Résultats (14 octobre 2026, Linux x64, Node 22.22)

### Poids (rolldown, minifié, imports Effect par sous-chemins)

| Entrée | min | gzip | brotli |
| --- | ---: | ---: | ---: |
| Référence : `Effect.runPromise(succeed)` | 21,2 kB | 7,4 kB | 6,8 kB |
| Cœur (API Effect + Layer navigateur) | 36,0 kB | 12,1 kB | 11,2 kB |
| Façade promesse (+ Layer navigateur) | 39,7 kB | 13,4 kB | 12,3 kB |

Le cœur complet du prototype pèse 12,1 kB gzip, soit 4,7 kB de plus que le programme Effect minimal. L'estimation de l'étude (environ 19 kB) était pessimiste : elle comptait `PubSub`, `Queue` et `Ref`, que ce cœur n'utilise pas.

### Décodage sous Node (`node-web-audio-api`, extrait de 1 s généré avec ffmpeg)

| Format | Résultat |
| --- | --- |
| WAV PCM 16 bits, MP3, OGG Vorbis, FLAC | décodés |
| M4A AAC, moov en tête (`+faststart`) ou fragmenté | décodés |
| M4A AAC avec moov en fin de fichier (sortie ffmpeg par défaut) | échec : `missing moov atom` |
| Opus (OGG et WebM) | échec : codec non supporté |

Le décodeur reste à 48 kHz : les contextes sans sortie ont cette fréquence et `decodeAudioData` rééchantillonne. Les échecs sont remontés en `LoadError` avec `reason: "unsupported-format"` pour les codecs inconnus.

### Signal réel (rendu hors ligne, rapport à une référence non atténuée)

`play({ volume: 0.5 })` suivi de `fadeTo(0, 1 s)` donne 0,50 sur 0–50 ms, 0,26 sur 475–525 ms et 0,03 sur 950–1000 ms. Le fondu s'exécute donc bien sur le fil audio, et les nœuds restent connectés tant que le `Scope` de la voix est ouvert.

### Coût de `play()`

Contexte simulé (isole Effect), médiane de moyennes par lot :

| Variante | Médiane |
| --- | ---: |
| Appels Web Audio directs | 1,2 µs |
| `Effect.runSync(play(...))`, effet construit à chaque appel | 11,3 µs |
| `Effect.runSync` d'un effet préconstruit | 5,8 µs |

Effect ajoute 5 à 11 µs sur le JavaScript, contre 2,7 ms pour un quantum de rendu audio (128 échantillons à 48 kHz). Sur le moteur réel de Node, créer les nœuds natifs et poser `onended` coûte des centaines de microsecondes et la mesure est bruitée : elle ne permet pas de conclure plus finement. Le coût dans un vrai navigateur reste à mesurer.

## Ce que le prototype ne couvre pas

- Aucune mesure dans un vrai navigateur (Chromium, Firefox, WebKit) : à faire avec Playwright en phase 2.
- Pas de cache, de bus de mixage, de sprites ni de streaming.
- Les tests sont des bancs, pas une suite de tests : la suite et les seuils de qualité arrivent avec le cœur v0.1.
