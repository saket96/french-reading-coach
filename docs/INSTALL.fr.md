# Guide d’installation

**[English](INSTALL.md)** · **Français**

Installation pas à pas pour **macOS**, **Windows** et **Linux**.  
Pour un aperçu plus court : [README français](../README.fr.md) · [README English](../README.md).

---

## Avant de commencer (toutes plateformes)

1. Installez un navigateur :
   - **Enregistrement** : [Google Chrome](https://www.google.com/chrome/), [Microsoft Edge](https://www.microsoft.com/edge) ou [Opera](https://www.opera.com/) (microphone WebM).
   - **Écouter (TTS)** : Safari sur Mac fonctionne aussi bien ; les navigateurs Chromium ont besoin d’une voix française **locale** et d’un clic (**Tester la voix**).
2. Installez **Git**.
3. Installez **Docker** (Desktop sur Mac/Windows, Engine + Compose sur Linux).
4. Libérez environ **10–20 Go** de disque pour les images et modèles (plus si Whisper **Small**).
5. Ayez un **microphone** qui fonctionne et autorisez-le dans le navigateur.

Clonez le dépôt une fois Git installé :

```bash
git clone https://github.com/saket96/french-reading-coach.git
cd french-reading-coach
```

Sous Windows, utilisez les mêmes commandes dans **PowerShell** ou **Git Bash** après Git et Docker Desktop.

---

## macOS

### 1. Configuration requise

| Élément | Minimum | Recommandé |
|---------|---------|------------|
| OS | macOS 12+ | macOS 13+ |
| Puce | Intel ou Apple Silicon | Apple Silicon OK (Docker Desktop) |
| RAM | 8 Go | 16 Go |
| Disque libre | 10 Go | 20 Go+ |
| Docker | [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/) | Dernière version stable |
| Navigateur | Chrome, Edge ou Opera | Dernière version |
| Git | Xcode CLT ou [git-scm](https://git-scm.com/) | Dernière version |

### 2. Installer Docker Desktop

1. Téléchargez Docker Desktop for Mac (build Apple Silicon ou Intel selon votre Mac).
2. Ouvrez l’installateur et glissez Docker dans Applications.
3. Lancez **Docker** et attendez que l’icône baleine indique que Docker tourne.
4. (Optionnel) Allouez au moins **4 Go de RAM** et **2 CPU** dans Settings → Resources.

### 3. Installer Git (si besoin)

```bash
xcode-select --install
# ou : brew install git
git --version
```

### 4. Démarrer l’application

```bash
cd ~/french-reading-coach   # ou le chemin où vous avez cloné
git checkout main
git pull origin main

docker compose down
docker compose up -d --build
```

Le premier build peut prendre plusieurs minutes (Whisper + OpenPronounce + web).

### 5. Ouvrir le coach

1. Attendez que Whisper soit prêt (souvent 30–90 secondes après le démarrage des conteneurs) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9000/docs
   ```

   Attendez `200`.

2. Ouvrez **http://127.0.0.1:4378** dans Chrome, Edge, Opera ou Safari.
3. Autorisez le microphone quand le navigateur le demande (nécessaire pour **Enregistrer**).
4. Pour le TTS français (**Écouter tout / guidé**) : **Réglages système → Accessibilité → Contenu lu à voix haute** → téléchargez **Amélie** ou **Thomas** (Enhanced / Premium). Dans le dock de l’app (**Voix française**), sélectionnez cette voix et cliquez **Tester la voix**.

### 6. Optionnel : Whisper Small

```bash
docker compose --profile small up -d
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9001/docs
```

Dans l’app, choisissez **Small** et attendez le voyant vert.

### 7. Arrêter

```bash
docker compose down
```

---

## Windows

### 1. Configuration requise

| Élément | Minimum | Recommandé |
|---------|---------|------------|
| OS | Windows 10 64 bits (22H2+) ou Windows 11 | Windows 11 |
| Virtualisation | WSL 2 activé | WSL 2 + virtualisation BIOS/UEFI |
| RAM | 8 Go | 16 Go |
| Disque libre | 10 Go | 20 Go+ |
| Docker | [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/) | Dernière version, backend **WSL 2** |
| Navigateur | Chrome ou Edge | Dernière version |
| Git | [Git for Windows](https://git-scm.com/download/win) | Dernière version |

> **Note :** Firefox n’est pas recommandé pour l’enregistrement (micro WebM). Safari peut servir pour **Écouter** ; préférez Chrome/Edge/Opera pour **Enregistrer**.

### 2. Activer WSL 2 (requis par Docker Desktop)

Dans **PowerShell en tant qu’administrateur** :

```powershell
wsl --install
```

Redémarrez Windows si demandé. Vérifiez :

```powershell
wsl --status
```

### 3. Installer Docker Desktop

1. Installez Docker Desktop for Windows.
2. Pendant l’installation, gardez **Use WSL 2 instead of Hyper-V** activé.
3. Lancez Docker Desktop et attendez **Engine running**.
4. Settings → Resources : au moins **4 Go de RAM** recommandé.

### 4. Installer Git for Windows

1. Installez depuis https://git-scm.com/download/win  
2. Options par défaut (Git dans la ligne de commande) conviennent.
3. Ouvrez **PowerShell** ou **Git Bash**.

### 5. Cloner et démarrer

```powershell
cd $HOME
git clone https://github.com/saket96/french-reading-coach.git
cd french-reading-coach
git checkout main

docker compose down
docker compose up -d --build
```

### 6. Ouvrir le coach

1. Vérifiez Whisper :

   ```powershell
   curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:9000/docs
   ```

2. Ouvrez **http://127.0.0.1:4378** dans Chrome ou Edge.
3. Autorisez le microphone pour ce site.
4. Pour le TTS d’écoute guidée, installez une voix française sous **Paramètres → Heure et langue → Parole** (ou *Accessibilité → Narrateur*, selon la version de Windows).

### 7. Optionnel : Whisper Small

```powershell
docker compose --profile small up -d
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:9001/docs
```

Choisissez **Small** dans l’app quand le voyant est vert.

### 8. Arrêter

```powershell
docker compose down
```

### Pare-feu / ports Windows

Si la page ne charge pas, autorisez Docker / les ports locaux **4378**, **9000**, **8000** (et **9001** pour Small) sur les réseaux privés, ou désactivez temporairement le pare-feu uniquement pour tester.

---

## Linux

### 1. Configuration requise

| Élément | Minimum | Recommandé |
|---------|---------|------------|
| OS | Ubuntu 22.04+, Fedora 39+, Debian 12+, ou équivalent | Ubuntu 24.04 LTS |
| RAM | 8 Go | 16 Go |
| Disque libre | 10 Go | 20 Go+ |
| Docker | Docker Engine + plugin Compose | Dernière version (docs Docker) |
| Navigateur | Chrome, Chromium ou Edge | Dernière version |
| Audio | PulseAudio/PipeWire + micro fonctionnel | — |
| Git | Paquet de la distribution | Dernière version |

### 2. Installer Docker Engine + Compose

Suivez le guide officiel pour votre distribution :  
https://docs.docker.com/engine/install/

Exemple sur **Ubuntu** :

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
# puis suivez les étapes Docker Ubuntu pour les paquets docker-ce
sudo usermod -aG docker "$USER"
```

Déconnectez-vous puis reconnectez-vous (ou redémarrez) pour utiliser Docker sans `sudo`.

Vérifiez :

```bash
docker --version
docker compose version
```

### 3. Installer Git et un navigateur

```bash
# Debian/Ubuntu
sudo apt-get install -y git
# Installez Google Chrome ou utilisez Chromium de votre distribution
```

### 4. Cloner et démarrer

```bash
git clone https://github.com/saket96/french-reading-coach.git
cd french-reading-coach
git checkout main
git pull origin main

docker compose down
docker compose up -d --build
```

### 5. Ouvrir le coach

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9000/docs
xdg-open http://127.0.0.1:4378   # ou ouvrez manuellement dans Chrome/Chromium/Edge
```

Autorisez le microphone dans le navigateur. Pour le TTS, assurez-vous qu’une voix française est disponible (ex. `espeak-ng` / parole système, ou voix distantes Chrome avec réseau).

### 6. Optionnel : Whisper Small

```bash
docker compose --profile small up -d
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9001/docs
```

### 7. Arrêter

```bash
docker compose down
```

### Astuces Linux

- Ports occupés : `sudo ss -tlnp | grep -E '4378|9000|8000|9001'`
- Permission refusée sur le socket Docker : vérifiez que votre utilisateur est dans le groupe `docker` et que vous vous êtes reconnecté.
- Serveurs sans interface : l’app a besoin d’un navigateur + micro sur la machine (ou d’un bureau distant) où vous pratiquez.

---

## Utiliser le coach (après installation)

1. Ouvrez **http://127.0.0.1:4378** — le passage de lecture est large à côté du dock flottant **Outils**.
2. Cliquez sur **?** à **gauche** pour l’aide intégrée (mode d’emploi complet).
3. Choisissez un texte **Bibliothèque**, ou **Mon texte** pour :
   - coller / écrire du français (retours à la ligne conservés), ou
   - **PDF / Word** → importer un `.pdf` ou `.docx` → vérifier le texte extrait → **Utiliser ce texte**  
     (les PDF scannés image seule n’ont souvent pas de texte extractible ; le `.doc` ancien n’est pas pris en charge — utilisez `.docx`)
4. Dans **Outils** :
   - **Voix française** → Amélie/Thomas → **Tester la voix**
   - Vitesse : **Lent / Moyen / Rapide**
   - **Écouter tout** — passage entier, surlignage, **défilement auto** ; **Pause** / **Reprendre** / **Stop écoute**
   - **Écouter (guidé)** — **une phrase à la fois** ; **Suivant** pour la phrase suivante de l’étape
   - **Clic ON** Mot/Phrase — toucher ou sélectionner pour entendre + traduire → **Réécouter** / **Sauver**
   - **Enregistrer** — nécessite le voyant Whisper vert
5. **Mes travaux** enregistre les textes perso dans le navigateur ; **Révision** entraîne le vocabulaire sauvé.

Si **Écouter** est silencieux dans Opera/Chrome : installez une voix française **locale**, sélectionnez-la dans le dock, cliquez **Tester la voix**, puis réessayez. Safari sur Mac est souvent le plus fiable pour l’écoute seule.

Si la page affiche `Failed to resolve import "pdfjs-dist"` après un `git pull` : reconstruisez pour rafraîchir les deps web —

```bash
docker compose down
docker compose up -d --build
```

Si ça continue : `docker volume rm french-reading-coach_web_node_modules` puis `docker compose up -d --build`.

Si **Prononciation** reste jaune ou échoue après un enregistrement : reconstruisez avec Piper (hors ligne) —

```bash
docker compose up -d --build pronounce
docker compose logs -f pronounce
```

Attendez le voyant vert (**Prononciation prête**), cliquez **Reset** si besoin, puis réenregistrez. Le premier démarrage télécharge le modèle FR (~1,2 Go) et la voix Piper.

---

## Vérifier que tout va bien

```bash
docker compose ps
curl -s -o /dev/null -w "whisper base: %{http_code}\n" http://127.0.0.1:9000/docs
curl -s -o /dev/null -w "web: %{http_code}\n" http://127.0.0.1:4378/
curl -s -o /dev/null -w "pronounce: %{http_code}\n" http://127.0.0.1:8000/docs
```

Small optionnel :

```bash
curl -s -o /dev/null -w "whisper small: %{http_code}\n" http://127.0.0.1:9001/docs
```

Journaux utiles :

```bash
docker compose logs -f web
docker compose logs --tail=80 whisper
docker compose logs --tail=80 pronounce
```

---

## Mettre à jour vers la dernière version

```bash
cd ~/french-reading-coach   # ou le chemin de votre clone
git checkout main
git pull origin main
docker compose down
docker compose up -d --build
```

Sur Mac/Windows, démarrez d’abord **Docker Desktop** (attendez que le moteur tourne). Le conteneur web réinstalle les paquets npm quand `package-lock.json` change (nécessaire après des fonctions comme l’import PDF).

Si vous utilisez Small :

```bash
docker compose --profile small up -d --build
```

---

## Désinstaller / libérer de l’espace

```bash
cd french-reading-coach
docker compose --profile small down -v
```

`-v` supprime les volumes Docker (caches des modèles Whisper / OpenPronounce).  
Puis supprimez le dossier du projet si vous n’en avez plus besoin.

---

## Besoin d’aide ?

Si vous êtes bloqué à l’installation ou pendant l’usage du coach, contactez **Saket Suman** :  
**[https://saketsuman.com/contact/](https://saketsuman.com/contact/)**
