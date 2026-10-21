import { useEffect } from 'react'
import { X } from 'lucide-react'
import { Button } from './ui/button.jsx'

const SECTIONS = [
  {
    title: 'Démarrage',
    body: [
      'Ouvrez l’app dans Safari (écoute) ou Chrome / Opera (enregistrement).',
      'Choisissez une voix française dans le panneau de droite, puis Tester la voix.',
      'Sur Mac : Réglages → Accessibilité → Contenu lu à voix haute → téléchargez Amélie ou Thomas (Enhanced).',
    ],
  },
  {
    title: 'Clic — mot, sélection, traduction',
    body: [
      'Activez Clic ON dans le dock à droite (sinon les clics ne font rien).',
      'Mot : un clic sur un mot → lecture à voix haute + traduction anglaise en haut.',
      'Phrase : un clic lit et traduit toute la phrase.',
      'Sélection : survolez du texte à la souris → même résultat (écoute + traduction).',
      'Réécouter rejoue le français ; Sauver l’ajoute au vocabulaire ; Reverso ouvre le contexte.',
    ],
  },
  {
    title: 'Écouter',
    body: [
      'Écouter tout : lit le passage entier avec surlignage des mots.',
      'Écouter (guidé) : une phrase à la fois dans l’étape en cours.',
      'Pause / Reprendre : met en pause ou continue la lecture.',
      'Suivant : phrase suivante (guidé, quand l’étape a plusieurs phrases).',
      'Stop écoute : arrête complètement.',
      'Pendant l’écoute, un clic (Clic ON) explique le mot puis reprend la lecture.',
    ],
  },
  {
    title: 'Ombre & enregistrement',
    body: [
      'Ombre ON : une phrase par étape — écoutez le modèle, puis Enregistrer pour répéter.',
      'Ombre OFF : deux phrases par étape de pratique.',
      'Enregistrer → Stop → analyse Whisper + conseils de prononciation.',
      'Continuer passe à l’étape suivante après un bon score.',
    ],
  },
  {
    title: 'Texte & vocabulaire',
    body: [
      'Bibliothèque : passages prêts. Mon texte : collez du français, ou importez un PDF / Word (.docx).',
      'Après import, vérifiez le texte dans la zone, puis Utiliser ce texte.',
      'Les PDF scannés (image seule) n’ont souvent pas de texte extractible — collez alors le contenu.',
      'Mes travaux : sauver / rouvrir localement ; Exporter / Importer pour passer d’Opera à Safari.',
      'Révision : carte des mots sauvés pour réviser.',
    ],
  },
  {
    title: 'Vitesse & services',
    body: [
      'Lent / Moyen / Rapide règle seulement la vitesse d’écoute.',
      'Voyants Whisper et Prononciation : verts = Docker prêt.',
      'Si Écouter est silencieux : changez de voix française et retestez.',
    ],
  },
]

export function HelpPanel({ open, onClose }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="help-overlay" role="presentation" onClick={onClose}>
      <aside
        className="help-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-panel-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="help-panel__header">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ring">Aide</p>
            <h2 id="help-panel-title" className="mt-1 font-serif text-2xl text-foreground">
              Comment utiliser
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Fermer l’aide"
            title="Fermer"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="help-panel__body">
          {SECTIONS.map((section) => (
            <section key={section.title} className="help-panel__section">
              <h3>{section.title}</h3>
              <ul>
                {section.body.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </aside>
    </div>
  )
}
