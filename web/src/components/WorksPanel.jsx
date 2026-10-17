import { useEffect, useState } from 'react'
import { FolderOpen, Pencil, Save, Trash2 } from 'lucide-react'
import { Button } from './ui/button.jsx'
import {
  defaultWorkTitle,
  deleteWork,
  listWorks,
  renameWork,
  saveWork,
} from '../lib/worksDb.js'

function formatWhen(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export function WorksPanel({
  currentText,
  currentVocab,
  activeWorkId,
  onLoadWork,
  onSaved,
  onClose,
}) {
  const [works, setWorks] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [titleDraft, setTitleDraft] = useState(() => defaultWorkTitle(currentText || ''))
  const [renamingId, setRenamingId] = useState('')
  const [renameValue, setRenameValue] = useState('')

  const refresh = async () => {
    const rows = await listWorks()
    setWorks(rows)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rows = await listWorks()
        if (!cancelled) setWorks(rows)
      } catch (err) {
        if (!cancelled) setError(err.message || 'Base de données indisponible')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleSave = async () => {
    setBusy(true)
    setError('')
    try {
      const record = await saveWork({
        id: activeWorkId || undefined,
        title: titleDraft || defaultWorkTitle(currentText),
        text: currentText,
        vocab: currentVocab,
      })
      await refresh()
      onSaved?.(record)
    } catch (err) {
      setError(err.message || 'Sauvegarde impossible')
    } finally {
      setBusy(false)
    }
  }

  const handleSaveAsNew = async () => {
    setBusy(true)
    setError('')
    try {
      const record = await saveWork({
        title: titleDraft || defaultWorkTitle(currentText),
        text: currentText,
        vocab: currentVocab,
      })
      await refresh()
      onSaved?.(record)
    } catch (err) {
      setError(err.message || 'Sauvegarde impossible')
    } finally {
      setBusy(false)
    }
  }

  const startRename = (work) => {
    setRenamingId(work.id)
    setRenameValue(work.title)
  }

  const commitRename = async (id) => {
    setBusy(true)
    setError('')
    try {
      await renameWork(id, renameValue)
      setRenamingId('')
      await refresh()
    } catch (err) {
      setError(err.message || 'Renommage impossible')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Supprimer ce travail de la base ?')) return
    setBusy(true)
    setError('')
    try {
      await deleteWork(id)
      await refresh()
      if (activeWorkId === id) onSaved?.(null)
    } catch (err) {
      setError(err.message || 'Suppression impossible')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-serif text-xl">Mes travaux</h2>
          <p className="text-xs text-muted-foreground">
            Base locale (IndexedDB) — titres renommables, texte sauvé sur cet appareil.
          </p>
        </div>
        <Button variant="outline" onClick={onClose}>
          Fermer
        </Button>
      </div>

      <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3 space-y-2">
        <label className="block text-sm font-medium" htmlFor="work-title">
          Titre pour le texte actuel
        </label>
        <input
          id="work-title"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={titleDraft}
          onChange={(event) => setTitleDraft(event.target.value)}
          placeholder="Ex. Éducation — révision lundi"
        />
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSave} disabled={busy || !currentText?.trim()}>
            <Save className="h-4 w-4" />
            {activeWorkId ? 'Mettre à jour' : 'Sauver'}
          </Button>
          {activeWorkId ? (
            <Button
              variant="outline"
              onClick={handleSaveAsNew}
              disabled={busy || !currentText?.trim()}
            >
              Sauver comme nouveau
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <p className="text-sm text-wrong">{error}</p> : null}

      {works.length ? (
        <ul className="divide-y divide-border rounded-md border border-border">
          {works.map((work) => (
            <li key={work.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                {renamingId === work.id ? (
                  <div className="flex flex-wrap gap-2">
                    <input
                      className="min-w-[12rem] flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitRename(work.id)
                        if (event.key === 'Escape') setRenamingId('')
                      }}
                      autoFocus
                    />
                    <Button size="sm" onClick={() => commitRename(work.id)} disabled={busy}>
                      OK
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRenamingId('')}>
                      Annuler
                    </Button>
                  </div>
                ) : (
                  <>
                    <p className="font-medium truncate">
                      {work.title}
                      {activeWorkId === work.id ? (
                        <span className="ml-2 text-xs font-normal text-ring">ouvert</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatWhen(work.updatedAt)} · {String(work.text || '').length} car.
                    </p>
                  </>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onLoadWork?.(work)}
                  title="Ouvrir ce texte"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  Ouvrir
                </Button>
                <Button size="sm" variant="ghost" onClick={() => startRename(work)}>
                  <Pencil className="h-3.5 w-3.5" />
                  Renommer
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleDelete(work.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Aucun travail sauvé. Collez un texte, choisissez un titre, puis Sauver.
        </p>
      )}
    </section>
  )
}
