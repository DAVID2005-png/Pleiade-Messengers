import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronLeft, ChevronRight, Download, Eye, Heart, ImagePlus, Plus, Send, Trash2,
  Share2, UserRound, X
} from 'lucide-react'
import { compressImage } from '../services/images'
import ConfirmDialog from './ConfirmDialog'
import Toast from './Toast'
import {
  createStatus, deleteStatus, getStatusShareCount, listenStatuses, listenStatusLikes,
  listenStatusResponses, listenStatusViews, recordStatusShare, recordStatusView,
  respondToStatus, toggleStatusLike
} from '../services/statuses'

const maxCaptionLength = 500
const maxImageSize = 150 * 1024

function Avatar({ person, className = '' }) {
  return <span className={`status-avatar ${className}`}>
    {person?.photoURL
      ? <img src={person.photoURL} alt="" />
      : <UserRound size={20} />}
  </span>
}

function formatStatusTime(timestamp) {
  const date = timestamp?.toDate?.()
  return date?.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) || 'Maintenant'
}

export default function Statuses({ user, profile, blockedUserIds = [] }) {
  const [statuses, setStatuses] = useState([])
  const [loading, setLoading] = useState(true)
  const [showComposer, setShowComposer] = useState(false)
  const [caption, setCaption] = useState('')
  const [image, setImage] = useState(null)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [activeStatusId, setActiveStatusId] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [clock, setClock] = useState(Date.now())
  const [likeCount, setLikeCount] = useState(0)
  const [liked, setLiked] = useState(false)
  const [viewers, setViewers] = useState([])
  const [shareCount, setShareCount] = useState(0)
  const [responses, setResponses] = useState([])
  const [responseText, setResponseText] = useState('')
  const [zoomed, setZoomed] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const dismissError = useCallback(() => setError(''), [])
  const dismissNotice = useCallback(() => setNotice(''), [])

  const reportError = useCallback(err => {
    console.error('Status action failed:', err)
    setError(err.message || 'Impossible de terminer cette action.')
  }, [])

  useEffect(() => listenStatuses(items => {
    setStatuses(items)
    setLoading(false)
  }, err => {
    reportError(err)
    setLoading(false)
  }), [reportError])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const blockedUsers = useMemo(() => new Set(blockedUserIds), [blockedUserIds])
  const activeStatuses = useMemo(() => statuses.filter(status =>
    status.expiresAt?.toMillis?.() > clock && !blockedUsers.has(status.authorUid)
  ), [statuses, clock, blockedUsers])

  const statusGroups = useMemo(() => {
    const groups = new Map()
    activeStatuses.forEach(status => {
      if (!groups.has(status.authorUid)) groups.set(status.authorUid, [])
      groups.get(status.authorUid).push(status)
    })
    return Array.from(groups.entries()).map(([uid, items]) => ({
      uid,
      statuses: items.sort((a, b) =>
        (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0)
      )
    })).sort((a, b) => {
      if (a.uid === user.uid) return -1
      if (b.uid === user.uid) return 1
      return (b.statuses.at(-1)?.createdAt?.toMillis?.() || 0) -
        (a.statuses.at(-1)?.createdAt?.toMillis?.() || 0)
    })
  }, [activeStatuses, user.uid])

  const activeStatus = activeStatuses.find(status => status.id === activeStatusId) || null
  const activeGroup = statusGroups.find(group => group.uid === activeStatus?.authorUid)
  const ownGroup = statusGroups.find(group => group.uid === user.uid)

  useEffect(() => {
    const statusId = new URLSearchParams(window.location.search).get('status')
    if (!statusId || activeStatusId) return
    const matching = activeStatuses.find(status => status.id === statusId)
    if (matching) setActiveStatusId(matching.id)
  }, [activeStatuses, activeStatusId])

  useEffect(() => {
    if (!activeStatus) return undefined
    setLikeCount(0)
    setLiked(false)
    setShareCount(0)
    setViewers([])
    setResponses([])
    setResponseText('')
    setZoomed(false)
    const stops = [
      listenStatusLikes(activeStatus.id, user.uid, result => {
        if (result.count !== undefined) setLikeCount(result.count)
        if (result.liked !== undefined) setLiked(result.liked)
      }, reportError)
    ]
    getStatusShareCount(activeStatus.id)
      .then(setShareCount)
      .catch(reportError)

    if (activeStatus.authorUid === user.uid) {
      stops.push(listenStatusViews(activeStatus.id, setViewers, reportError))
      stops.push(listenStatusResponses(activeStatus.id, user.uid, setResponses, reportError))
    } else {
      recordStatusView(activeStatus.id, user, profile).catch(reportError)
    }

    return () => stops.forEach(stop => stop())
  }, [activeStatus?.id, activeStatus?.authorUid, profile, reportError, user])

  function openStatus(statusId) {
    const status = activeStatuses.find(item => item.id === statusId)
    if (!status) return
    setActiveStatusId(statusId)
    const group = statusGroups.find(item => item.uid === status.authorUid)
    setActiveIndex(group?.statuses.findIndex(item => item.id === statusId) || 0)
    window.history.replaceState(null, '', `${window.location.pathname}?status=${encodeURIComponent(statusId)}`)
  }

  function closeStatus() {
    setActiveStatusId('')
    window.history.replaceState(null, '', window.location.pathname)
  }

  function moveStatus(direction) {
    if (!activeGroup) return
    const nextIndex = activeIndex + direction
    if (nextIndex < 0 || nextIndex >= activeGroup.statuses.length) {
      closeStatus()
      return
    }
    setActiveIndex(nextIndex)
    const nextStatusId = activeGroup.statuses[nextIndex].id
    setActiveStatusId(nextStatusId)
    window.history.replaceState(null, '', `${window.location.pathname}?status=${encodeURIComponent(nextStatusId)}`)
  }

  async function selectImage(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const compressed = await compressImage(file, { maxBytes: maxImageSize, maxDimension: 1400 })
      setImage(compressed)
      setPreview(compressed.dataUrl)
    } catch (err) {
      reportError(err)
    } finally {
      setBusy(false)
      setConfirmDelete(false)
    }
  }

  async function publishStatus(event) {
    event.preventDefault()
    if (!image) {
      setError('Choisissez une photo pour votre statut.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const statusId = await createStatus({ user, profile, caption, image })
      setShowComposer(false)
      setCaption('')
      setImage(null)
      setPreview('')
      setNotice('Votre statut est publié pour 24 heures.')
      setActiveStatusId(statusId)
      window.history.replaceState(null, '', `${window.location.pathname}?status=${encodeURIComponent(statusId)}`)
    } catch (err) {
      reportError(err)
    } finally {
      setBusy(false)
    }
  }

  async function toggleLike() {
    if (!activeStatus) return
    setBusy(true)
    try {
      await toggleStatusLike(activeStatus.id, user.uid, liked)
      setLikeCount(count => count + (liked ? -1 : 1))
      setLiked(!liked)
    } catch (err) {
      reportError(err)
    } finally {
      setBusy(false)
    }
  }

  async function shareStatus() {
    if (!activeStatus) return
    const url = `${window.location.origin}/?status=${encodeURIComponent(activeStatus.id)}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Statut Pleiade Messengers', text: `Statut de ${activeStatus.authorName}`, url })
      } else {
        await navigator.clipboard.writeText(url)
        setNotice('Lien du statut copié. Vous pouvez le partager sur vos réseaux.')
      }
      const added = await recordStatusShare(activeStatus.id, user, profile)
      if (added) setShareCount(count => count + 1)
    } catch (err) {
      if (err.name !== 'AbortError') reportError(err)
    }
  }

  async function submitResponse(event) {
    event.preventDefault()
    if (!activeStatus) return
    setBusy(true)
    setError('')
    try {
      await respondToStatus({ status: activeStatus, user, profile, text: responseText })
      setResponseText('')
      setNotice('Votre réponse privée a été envoyée à l’auteur du statut.')
    } catch (err) {
      reportError(err)
    } finally {
      setBusy(false)
    }
  }

  async function removeActiveStatus() {
    if (!activeStatus) return
    setBusy(true)
    setError('')
    try {
      await deleteStatus(activeStatus.id, activeStatus.authorUid)
      closeStatus()
      setNotice('Votre statut a été supprimé.')
    } catch (err) {
      reportError(err)
    } finally {
      setBusy(false)
    }
  }

  return <div className="statuses-page">
    <header className="statuses-heading">
      <div><h1>Statuts</h1><p>Photos visibles par les membres connectés pendant 24 heures.</p></div>
      <button className="status-create-button" onClick={() => setShowComposer(true)}>
        <Plus size={18} /><span className="status-create-desktop-label">Nouveau</span><span className="status-create-mobile-label">Ajouter</span>
      </button>
    </header>
    <Toast message={error} onClose={dismissError} />
    <Toast message={notice} type="success" onClose={dismissNotice} />
    <section className="status-carousel" aria-label="Statuts récents">
      <button className="status-group-card add-status-card" onClick={() => ownGroup
        ? openStatus(ownGroup.statuses[0].id)
        : setShowComposer(true)}>
        <span className={`status-own-avatar${ownGroup ? ' has-status' : ''}`}><Avatar person={profile} />{!ownGroup && <i><Plus size={15} /></i>}</span>
        <b>Mon statut</b><small>{ownGroup ? `${ownGroup.statuses.length} statut${ownGroup.statuses.length === 1 ? '' : 's'}` : 'Ajouter une photo'}</small>
      </button>
      {statusGroups.filter(group => group.uid !== user.uid).map(group => {
        const latest = group.statuses[group.statuses.length - 1]
        const person = {
          photoURL: latest.authorPhotoURL,
          fullName: latest.authorName
        }
        return <button className="status-group-card" key={group.uid} onClick={() => openStatus(group.statuses[0].id)}>
          <span className="status-ring"><Avatar person={person} /></span>
          <b>{latest.authorName}</b><small>{group.statuses.length} statut{group.statuses.length === 1 ? '' : 's'}</small>
        </button>
      })}
    </section>
    {loading && <div className="statuses-empty">Chargement des statuts…</div>}
    {!loading && statusGroups.length === 0 && <div className="statuses-empty"><ImagePlus /><b>Aucun statut récent</b><span>Partagez une photo pour commencer.</span></div>}

    {showComposer && <div className="modal-backdrop" onClick={() => setShowComposer(false)}>
      <form className="modal status-composer" onClick={event => event.stopPropagation()} onSubmit={publishStatus}>
        <button type="button" className="modal-close" onClick={() => setShowComposer(false)} aria-label="Fermer">×</button>
        <div className="modal-icon"><ImagePlus /></div><h2>Mon statut</h2>
        <p>Votre photo sera visible par les membres connectés pendant 24 heures.</p>
        {preview && <img className="status-preview" src={preview} alt="Aperçu du statut" />}
        <label className="status-photo-pick"><ImagePlus size={18} />{preview ? 'Changer la photo' : 'Choisir une photo'}
          <input type="file" accept="image/*" disabled={busy} onChange={selectImage} />
        </label>
        <label htmlFor="status-caption">Description facultative</label>
        <textarea id="status-caption" maxLength={maxCaptionLength} value={caption} onChange={event => setCaption(event.target.value)} placeholder="Ajouter un texte…" />
        <small className="status-character-count">{caption.length}/{maxCaptionLength}</small>
        <button className="primary" disabled={busy || !image}>{busy ? 'Préparation…' : 'Publier le statut'}</button>
      </form>
    </div>}

    {activeStatus && <div className="status-viewer" onClick={closeStatus}>
      <div className="status-viewer-card" onClick={event => event.stopPropagation()}>
        <div className="status-progress">{activeGroup?.statuses.map((item, index) => <span key={item.id} className={index <= activeIndex ? 'done' : ''} />)}</div>
        <header className="status-viewer-header">
          <Avatar person={{ photoURL: activeStatus.authorPhotoURL }} />
          <div><b>{activeStatus.authorName}</b><small>@{activeStatus.authorUsername} · {formatStatusTime(activeStatus.createdAt)}</small></div>
          <button onClick={closeStatus} aria-label="Fermer le statut"><X /></button>
          {activeStatus.authorUid === user.uid && <button onClick={() => setConfirmDelete(true)} disabled={busy} aria-label="Supprimer le statut"><Trash2 /></button>}
        </header>
        <button className="status-step previous" onClick={() => moveStatus(-1)} aria-label="Statut précédent"><ChevronLeft /></button>
        <img className={`status-viewer-image${zoomed ? ' zoomed' : ''}`} src={activeStatus.image.dataUrl} alt={activeStatus.image.name} onClick={() => setZoomed(value => !value)} />
        <button className="status-step next" onClick={() => moveStatus(1)} aria-label="Statut suivant"><ChevronRight /></button>
        {activeStatus.caption && <p className="status-caption">{activeStatus.caption}</p>}
        <footer className="status-viewer-footer">
          <button className={liked ? 'liked' : ''} disabled={busy} onClick={toggleLike}><Heart size={18} fill={liked ? 'currentColor' : 'none'} />{likeCount}</button>
          <button onClick={shareStatus}><Share2 size={18} />{shareCount}</button>
          <a href={activeStatus.image.dataUrl} download={activeStatus.image.name || 'pleiade-statut.webp'} aria-label="Télécharger la photo"><Download size={18} /></a>
          {activeStatus.authorUid === user.uid && <span className="status-view-count"><Eye size={18} />{viewers.length}</span>}
        </footer>
        {activeStatus.authorUid === user.uid
          ? <section className="status-owner-details">
            <h3>Vues · {viewers.length}</h3>
            <div className="status-viewers">{viewers.map(viewer => <div key={viewer.id}><Avatar person={{ photoURL: '' }} /><span><b>{viewer.viewerName}</b><small>@{viewer.viewerUsername}</small></span></div>)}</div>
            {!!responses.length && <><h3>Réponses privées · {responses.length}</h3><div className="status-responses">{responses.map(response => <p key={response.id}><b>{response.authorName}</b><span>{response.text}</span></p>)}</div></>}
          </section>
          : <form className="status-reply-form" onSubmit={submitResponse}>
            <input maxLength={500} value={responseText} onChange={event => setResponseText(event.target.value)} placeholder="Répondre en privé…" aria-label="Répondre en privé au statut" />
            <button disabled={busy || !responseText.trim()} aria-label="Envoyer une réponse"><Send size={17} /></button>
          </form>}
      </div>
    </div>}
    {confirmDelete && <ConfirmDialog
      title="Supprimer ce statut ?"
      message="Le statut et ses interactions seront supprimés définitivement."
      onCancel={() => setConfirmDelete(false)}
      onConfirm={removeActiveStatus}
    />}
  </div>
}
