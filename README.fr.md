# Coach de lecture française

**[English](README.md)** · **Français**

**Coach de lecture française open source, 100 % local**, pour apprenants **B2+**.

Enregistrez-vous en train de lire le français (ou faites de l’**ombre** sur une phrase), recevez un retour mot à mot adapté au français, des conseils phonétiques optionnels, un voyant Whisper Base/Small, la traduction au clic, et un **paquet de révision** Leitner. La reconnaissance vocale et le score de prononciation tournent dans **Docker sur votre ordinateur** — aucun compte requis.

| | |
|---|---|
| **Auteur** | [Saket Suman](https://saketsuman.com) |
| **Besoin d’aide ?** | [Contact](https://saketsuman.com/contact/) |
| **App (local)** | http://127.0.0.1:4378 |
| **Licence** | [MIT](LICENSE) |
| **Installation (Mac / Windows / Linux)** | [docs/INSTALL.fr.md](docs/INSTALL.fr.md) · [English](docs/INSTALL.md) |
| **Contribuer** | [CONTRIBUTING.md](CONTRIBUTING.md) |
| **Sécurité / confidentialité** | [SECURITY.md](SECURITY.md) |

---

## Fonctionnalités

- **Voyant Whisper** — vert quand le modèle ASR sélectionné répond
- **Base / Small** — Base sur le port `9000` ; Small optionnel sur `9001`
- **Ombre** — une phrase : écouter → enregistrer → retour
- **Écouter tout / guidé** — voix système française avec surlignage ; les longs textes **défilent automatiquement** pour suivre le mot courant
- **Voix française** — choisir une voix TTS native (Amélie / Thomas Enhanced recommandés)
- **Panneau de lecture large** — le passage utilise presque toute la largeur à côté du dock **Outils**
- **Enregistrement libre** — parlez à votre rythme (deux phrases si Ombre est désactivée)
- **Score adapté au français** — exact / presque / erreur (moins de fausses alertes)
- **Clic mot / phrase** — toucher un mot ou une ligne pour entendre + traduire ; sélection souris possible
- **Révision** — paquet Leitner à partir du vocabulaire sauvé
- **Mes travaux** — base locale (IndexedDB) : enregistrer des textes, renommer, rouvrir ; **Exporter / Importer** JSON pour passer d’un navigateur à un autre (Opera ≠ Safari)
- **Texte perso** — collez votre propre passage (les retours à la ligne sont conservés)
- **OpenPronounce** — conseils phonétiques optionnels (expérimental pour le français)

---

## Configuration requise

### Toutes plateformes

| Élément | Détails |
|---------|---------|
| **RAM** | **8 Go minimum**, **16 Go recommandés** (Whisper + OpenPronounce) |
| **Disque** | **10 Go libres** minimum ; **20 Go+** si vous activez Whisper Small |
| **CPU** | Multi-cœurs moderne (modèles en **CPU** par défaut ; pas de GPU requis) |
| **Navigateur** | **Chrome**, **Edge** ou **Opera** pour l’enregistrement (micro WebM). **Safari** convient bien pour **Écouter** (TTS) ; l’enregistrement est plus fiable sur Chromium |
| **Microphone** | Intégré ou USB ; autoriser l’accès dans le navigateur |
| **Réseau** | Nécessaire pour le premier téléchargement des images/modèles Docker ; le glossaire vocab peut appeler des API en ligne |
| **Docker** | Docker Desktop (Mac/Windows) ou Docker Engine + Compose (Linux) |
| **Git** | Pour cloner et mettre à jour le dépôt |

### Ports utilisés (localhost)

| Port | Service |
|------|---------|
| `4378` | Interface web (Vite) |
| `9000` | Whisper **Base** ASR |
| `9001` | Whisper **Small** ASR (optionnel) |
| `8000` | OpenPronounce |

Ne **pas** exposer ces ports sur Internet public sans durcissement. L’app est conçue pour une **pratique locale**.

### Par système d’exploitation

| OS | Minimum | Notes |
|----|---------|--------|
| **macOS** | 12+ | Intel ou Apple Silicon ; Docker Desktop |
| **Windows** | 10 64 bits (22H2+) ou 11 | **WSL 2** requis pour Docker Desktop |
| **Linux** | Ubuntu 22.04+ / Debian 12+ / Fedora 39+ (ou équivalent) | Docker Engine + plugin Compose ; utilisateur dans le groupe `docker` |

Installation détaillée : **[docs/INSTALL.fr.md](docs/INSTALL.fr.md)**.

---

## Démarrage rapide

```bash
git clone https://github.com/saket96/french-reading-coach.git
cd french-reading-coach
docker compose up -d --build
```

1. Attendez Whisper (souvent 30–90 secondes après le premier démarrage) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9000/docs
   ```

   Vous voulez `200`.

2. Ouvrez **http://127.0.0.1:4378** dans Chrome, Edge ou Opera (Safari OK pour Écouter).
3. Autorisez le microphone si demandé.
4. ASR plus précis (optionnel) :

   ```bash
   docker compose --profile small up -d
   ```

   Puis choisissez **Small** dans l’app et attendez le voyant vert.

Tout arrêter :

```bash
docker compose down
```

---

## Installation par appareil

### macOS

1. Installez [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/) et lancez-le.
2. Installez Git (`xcode-select --install` ou Homebrew).
3. Clonez et lancez :

```bash
git clone https://github.com/saket96/french-reading-coach.git
cd french-reading-coach
docker compose up -d --build
open http://127.0.0.1:4378
```

4. Pour l’écoute guidée : **Réglages système → Accessibilité → Contenu lu à voix haute** → téléchargez une voix **française**.

Plus de détail : [docs/INSTALL.fr.md § macOS](docs/INSTALL.fr.md#macos).

### Windows

1. Activez **WSL 2** (PowerShell en administrateur : `wsl --install`, puis redémarrage si demandé).
2. Installez [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/) avec le backend **WSL 2** ; attendez **Engine running**.
3. Installez [Git for Windows](https://git-scm.com/download/win).
4. Dans PowerShell ou Git Bash :

```powershell
git clone https://github.com/saket96/french-reading-coach.git
cd french-reading-coach
docker compose up -d --build
```

5. Ouvrez **http://127.0.0.1:4378** dans Chrome ou Edge et autorisez le micro.

Plus de détail : [docs/INSTALL.fr.md § Windows](docs/INSTALL.fr.md#windows).

### Linux

1. Installez [Docker Engine](https://docs.docker.com/engine/install/) et le **plugin Compose** ; ajoutez votre utilisateur au groupe `docker` puis reconnectez-vous.
2. Installez Git et Chrome/Chromium/Edge.
3. Lancez :

```bash
git clone https://github.com/saket96/french-reading-coach.git
cd french-reading-coach
docker compose up -d --build
xdg-open http://127.0.0.1:4378
```

Plus de détail : [docs/INSTALL.fr.md § Linux](docs/INSTALL.fr.md#linux).

---

## Utilisation (résumé)

1. Choisissez un passage **Bibliothèque** ou collez **Mon texte** (les retours à la ligne sont conservés).
2. Dans le dock flottant **Outils** : choisissez une **Voix française**, cliquez **Tester la voix**, réglez la vitesse (**Lent / Moyen / Rapide**).
3. **Écouter tout** lit le passage entier avec surlignage + défilement auto ; **Écouter (guidé)** lit seulement l’étape en cours. **Stop écoute** pour arrêter.
4. Optionnel : activez **Ombre** pour une phrase — écoutez, puis **Enregistrer**.
5. Surveillez le voyant **Whisper** — préférez **Base** jusqu’au vert ; **Small** seulement après `docker compose --profile small up -d`.
6. Après Stop, lisez la revue (mots, points de focus, conseils de prononciation).
7. Activez **Clic** (**Mot** ou **Phrase**) pour toucher → entendre + traduire → **Sauver** ; ouvrez **Révision** pour le paquet. **Mes travaux** enregistre vos textes localement.

---

## Dépannage

| Problème | Que faire |
|----------|-----------|
| Page qui ne charge pas | `docker compose ps` — vérifiez que `web` tourne ; ouvrez http://127.0.0.1:4378 |
| Whisper rouge / 502 | Attendez 1–2 min ; `docker compose restart whisper` ; vérifiez `curl http://127.0.0.1:9000/docs` |
| Erreurs modèle Small | `docker compose --profile small up -d` puis `docker compose restart web` ; port `9001` |
| Micro bloqué | Paramètres du site Chrome/Edge/Opera → autoriser le micro ; utilisez http://127.0.0.1 |
| Pas de voix / Écouter silencieux | Installez une voix système **française** (Mac : Accessibilité → Contenu lu à voix haute → Amélie ou Thomas Enhanced). Dans le dock, choisissez-la et **Tester la voix**. Opera/Chrome exigent un clic avant la parole ; Safari fonctionne en général. Préférez une voix **locale / Enhanced** aux voix Google distantes. |
| Surlignage sans son | Idem ; essayez un autre navigateur (Safari pour écouter, Chrome/Opera pour enregistrer). |
| Pas de conseil de prononciation / intermittent | Reconstruisez pronounce (TTS **Piper hors-ligne**, plus Google) : `docker compose up -d --build pronounce`. Attendez le voyant **Prononciation** vert (1er lancement ~1,2 Go + voix Piper). Cliquez **Reset** puis réenregistrez. Voir `docker compose logs -f pronounce`. |

```bash
docker compose logs -f web
docker compose logs --tail=80 whisper
docker compose restart web
```

---

## Confidentialité

- **Enregistrement & ASR** restent sur votre machine (Docker).
- **Vocabulaire / révision** restent dans le `localStorage` du navigateur.
- La traduction de mots peut utiliser un glossaire en ligne / liens Reverso Context.
- Voir [SECURITY.md](SECURITY.md).

---

## Mise à jour

```bash
cd french-reading-coach
git checkout main
git pull origin main
docker compose down
docker compose up -d --build
```

---

## Développement

```bash
cd web
npm ci
npm test
npm run lint
npm run build
npm run dev
```

Voir [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Auteur

Créé par **[Saket Suman](https://saketsuman.com)**.

## Besoin d’aide ?

Questions sur l’installation, l’écoute/l’enregistrement, ou l’usage du coach :  
**[https://saketsuman.com/contact/](https://saketsuman.com/contact/)**

## Licence

[MIT](LICENSE) — libre d’utilisation, de partage et de modification avec attribution.

Les composants tiers (images Whisper ASR, OpenPronounce, polices, API de glossaire) conservent leurs propres licences et conditions.
