import { useMemo, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { Button } from './ui/button.jsx'
import { buildReviewDeck, gradeReviewEntry } from '../lib/vocabulary.js'

export function VocabDeck({ vocab, onUpdateVocab, onSpeak, onClose }) {
  const deck = useMemo(() => buildReviewDeck(vocab), [vocab])
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [done, setDone] = useState(false)
  const [sessionCorrect, setSessionCorrect] = useState(0)
  const [sessionTotal, setSessionTotal] = useState(0)

  const card = deck[index]

  if (!deck.length) {
    return (
      <section className="mb-6 rounded-xl border border-border bg-card p-4 space-y-3">
        <h2 className="font-serif text-xl">Révision vocabulaire</h2>
        <p className="text-sm text-muted-foreground">
          Aucun mot sauvé. Activez « Clic mot », cliquez des mots, puis Sauver.
        </p>
        <Button variant="outline" onClick={onClose}>
          Fermer
        </Button>
      </section>
    )
  }

  if (done) {
    return (
      <section className="mb-6 rounded-xl border border-border bg-card p-4 space-y-3">
        <h2 className="font-serif text-xl">Session terminée</h2>
        <p className="text-sm">
          {sessionCorrect}/{sessionTotal} connus tout de suite.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              setIndex(0)
              setRevealed(false)
              setDone(false)
              setSessionCorrect(0)
              setSessionTotal(0)
            }}
          >
            Recommencer
          </Button>
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </section>
    )
  }

  const grade = (knewIt) => {
    onUpdateVocab((prev) => gradeReviewEntry(prev, card.word, knewIt))
    setSessionTotal((n) => n + 1)
    if (knewIt) setSessionCorrect((n) => n + 1)
    setRevealed(false)
    if (index >= deck.length - 1) setDone(true)
    else setIndex((i) => i + 1)
  }

  return (
    <section className="mb-6 rounded-xl border border-ring/30 bg-card p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-xl">Révision vocabulaire</h2>
        <p className="text-xs text-muted-foreground">
          Carte {index + 1}/{deck.length} · boîte {card.box ?? 1}/5
        </p>
      </div>

      <div className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-8 text-center">
        <p className="font-serif text-3xl">{card.word}</p>
        {revealed ? (
          <p className="mt-4 text-xl text-ring">{card.translation}</p>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">Traduction cachée</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => onSpeak?.(card.word)}>
          <Volume2 className="h-4 w-4" />
          Écouter
        </Button>
        {!revealed ? (
          <Button onClick={() => setRevealed(true)}>Afficher</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => grade(false)}>
              Encore
            </Button>
            <Button onClick={() => grade(true)}>Je savais</Button>
          </>
        )}
        <Button variant="ghost" onClick={onClose}>
          Fermer
        </Button>
      </div>
    </section>
  )
}
