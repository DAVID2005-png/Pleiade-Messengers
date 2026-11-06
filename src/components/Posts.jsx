import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Download, Heart, ImagePlus, MessageCircle, MessageSquare, Send, Share2, Trash2, UserRound, X
} from 'lucide-react'
import {
  addPostComment, createPost, deletePost, deletePostComment, getPostCommentCount,
  listenPostComments, listenPostLikes, listenPosts, togglePostLike
} from '../services/posts'
import { compressImage } from '../services/images'
import ConfirmDialog from './ConfirmDialog'
import Toast from './Toast'

const maxPhotos = 4
const maxCaptionLength = 2000

function formatPostDate(timestamp) {
  const date = timestamp?.toDate?.()
  if (!date) return 'À l’instant'
  return date.toLocaleString('fr-FR', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

function Avatar({ photoURL, name }) {
  return <span className="post-avatar">
    {photoURL ? <img src={photoURL} alt="" /> : <UserRound size={20} />}
    <span className="sr-only">{name}</span>
  </span>
}

function PostCard({ post, user, profile, onError, onShare, onDeleted }) {
  const [likeCount, setLikeCount] = useState(0)
  const [liked, setLiked] = useState(false)
  const [comments, setComments] = useState([])
  const [commentCount, setCommentCount] = useState(0)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [replyTarget, setReplyTarget] = useState(null)
  const [expanded, setExpanded] = useState(false)
  const [selectedImage, setSelectedImage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(null)

  useEffect(() => {
    let active = true
    const stop = listenPostLikes(post.id, user.uid, result => {
      if (!active) return
      if (result.count !== undefined) setLikeCount(result.count)
      if (result.liked !== undefined) setLiked(result.liked)
    }, onError)
    return () => {
      active = false
      stop()
    }
  }, [post.id, user.uid, onError])

  useEffect(() => {
    let active = true
    getPostCommentCount(post.id)
      .then(count => {
        if (active) setCommentCount(count)
      })
      .catch(onError)
    return () => {
      active = false
    }
  }, [post.id, onError])

  useEffect(() => {
    if (!commentsOpen) return undefined
    return listenPostComments(post.id, setComments, onError)
  }, [commentsOpen, post.id, onError])

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('post') !== post.id) return
    document.getElementById(`post-${post.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [post.id])

  const topLevelComments = useMemo(() => comments.filter(comment => !comment.parentCommentId), [comments])
  const repliesFor = commentId => comments.filter(comment => comment.parentCommentId === commentId)

  async function handleLike() {
    setBusy(true)
    try {
      await togglePostLike(post.id, user.uid, liked)
      setLikeCount(count => count + (liked ? -1 : 1))
      setLiked(!liked)
    } catch (error) {
      onError(error)
    } finally {
      setBusy(false)
    }
  }

  async function handleComment(event) {
    event.preventDefault()
    setBusy(true)
    try {
      await addPostComment({
        postId: post.id,
        user,
        profile,
        text: commentText,
        parentCommentId: replyTarget?.id || ''
      })
      setCommentText('')
      setReplyTarget(null)
      setCommentCount(count => count + 1)
      setCommentsOpen(true)
    } catch (error) {
      onError(error)
    } finally {
      setBusy(false)
    }
  }

  async function handleDeletePost() {
    setBusy(true)
    try {
      await deletePost(post.id)
      onDeleted()
    } catch (error) {
      onError(error)
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteComment(comment) {
    try {
      await deletePostComment(post.id, comment.id)
      setCommentCount(count => Math.max(0, count - 1))
    } catch (error) {
      onError(error)
    }
  }

  async function confirmDelete() {
    const target = confirming
    setConfirming(null)
    if (!target) return
    if (target.kind === 'post') await handleDeletePost()
    else await handleDeleteComment(target.comment)
  }

  const postURL = `${window.location.origin}/?post=${encodeURIComponent(post.id)}`

  return <article className="post-card" id={`post-${post.id}`}>
    <header className="post-header">
      <Avatar photoURL={post.authorPhotoURL} name={post.authorName} />
      <div className="post-author"><b>{post.authorName}</b><small>@{post.authorUsername} · {formatPostDate(post.createdAt)}</small></div>
      {post.authorUid === user.uid && <button className="social-delete-button" disabled={busy} onClick={() => setConfirming({ kind: 'post' })} aria-label="Supprimer la publication"><Trash2 size={17} /></button>}
    </header>
    {post.caption && <p className="post-caption">{post.caption}</p>}
    <div className={`post-images count-${post.images.length}`}>
      {post.images.map((image, index) => <button className="post-image-button" key={`${image.name}-${index}`} onClick={() => setSelectedImage(image)} aria-label={`Agrandir la photo ${index + 1}`}>
        <img src={image.dataUrl} alt={`Publication de ${post.authorName}, photo ${index + 1}`} loading="lazy" />
      </button>)}
    </div>
    <div className="post-stats"><span>{likeCount} J’aime</span><button onClick={() => setCommentsOpen(value => !value)}>{commentCount} commentaire{commentCount === 1 ? '' : 's'}</button></div>
    <div className="post-actions">
      <button className={liked ? 'liked' : ''} disabled={busy} onClick={handleLike}><Heart size={17} fill={liked ? 'currentColor' : 'none'} />{liked ? 'Aimé' : 'J’aime'}</button>
      <button onClick={() => setCommentsOpen(value => !value)}><MessageCircle size={17} />Commenter</button>
      <button onClick={() => onShare(postURL, post.authorName)}><Share2 size={17} />Partager</button>
    </div>
    {commentsOpen && <section className="post-comments">
      {topLevelComments.slice(expanded ? 0 : -5).map(comment => <div className="comment-thread" key={comment.id}>
        <div className="comment-row">
          <Avatar photoURL={comment.authorPhotoURL} name={comment.authorName} />
          <div className="comment-bubble"><b>{comment.authorName}</b><p>{comment.text}</p></div>
          {(comment.authorUid === user.uid || post.authorUid === user.uid) && <button className="social-delete-button comment-delete-button" onClick={() => setConfirming({ kind: 'comment', comment })} aria-label="Supprimer le commentaire"><Trash2 size={14} /></button>}
        </div>
        <button className="reply-link" onClick={() => setReplyTarget(comment)}>Répondre</button>
        {repliesFor(comment.id).map(reply => <div className="comment-reply" key={reply.id}>
          <Avatar photoURL={reply.authorPhotoURL} name={reply.authorName} />
          <div className="comment-bubble"><b>{reply.authorName}</b><p>{reply.text}</p></div>
          {(reply.authorUid === user.uid || post.authorUid === user.uid) && <button className="social-delete-button comment-delete-button" onClick={() => setConfirming({ kind: 'comment', comment: reply })} aria-label="Supprimer la réponse"><Trash2 size={14} /></button>}
        </div>)}
      </div>)}
      {topLevelComments.length > 5 && <button className="reply-link" onClick={() => setExpanded(value => !value)}>
        {expanded ? 'Réduire' : 'Afficher tous les commentaires'}
      </button>}
      {replyTarget && <div className="replying-to">Réponse à {replyTarget.authorName}<button onClick={() => setReplyTarget(null)} aria-label="Annuler la réponse"><X size={14} /></button></div>}
      <form className="post-comment-form" onSubmit={handleComment}>
        <Avatar photoURL={profile.photoURL} name={profile.fullName} />
        <input aria-label="Commenter la publication" maxLength={1000} value={commentText} onChange={event => setCommentText(event.target.value)} placeholder={replyTarget ? 'Écrire une réponse…' : 'Écrire un commentaire…'} />
        <button disabled={busy || !commentText.trim()} aria-label="Envoyer le commentaire"><Send size={17} /></button>
      </form>
    </section>}
    {selectedImage && <div className="image-viewer" onClick={() => setSelectedImage(null)}>
      <button className="image-viewer-close" onClick={() => setSelectedImage(null)} aria-label="Fermer"><X /></button>
      <a className="image-download" href={selectedImage.dataUrl} download={selectedImage.name || 'pleiade-photo.webp'} onClick={event => event.stopPropagation()} aria-label="Télécharger la photo"><Download /></a>
      <img src={selectedImage.dataUrl} alt={selectedImage.name || 'Photo de la publication'} onClick={event => event.stopPropagation()} />
    </div>}
    {confirming && <ConfirmDialog
      title={confirming.kind === 'post' ? 'Supprimer la publication ?' : 'Supprimer le commentaire ?'}
      message={confirming.kind === 'post'
        ? 'Cette action supprimera aussi les commentaires et ne peut pas être annulée.'
        : 'Ce commentaire sera supprimé définitivement.'}
      onCancel={() => setConfirming(null)}
      onConfirm={confirmDelete}
    />}
  </article>
}

export default function Posts({ user, profile, blockedUserIds = [] }) {
  const [posts, setPosts] = useState([])
  const [caption, setCaption] = useState('')
  const [photos, setPhotos] = useState([])
  const [previewImages, setPreviewImages] = useState([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const dismissError = useCallback(() => setError(''), [])
  const dismissNotice = useCallback(() => setNotice(''), [])
  const blockedUsers = useMemo(() => new Set(blockedUserIds), [blockedUserIds])
  const visiblePosts = useMemo(() => posts.filter(post => !blockedUsers.has(post.authorUid)), [posts, blockedUsers])

  useEffect(() => listenPosts(items => {
    setPosts(items)
    setLoading(false)
  }, err => {
    console.error('Unable to load public posts:', err)
    setError('Impossible de charger les publications.')
    setLoading(false)
  }), [])

  const reportError = useCallback(err => {
    console.error('Publication action failed:', err)
    setError(err.message || 'Impossible de terminer cette action.')
  }, [])

  async function selectPhotos(event) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    if (photos.length + files.length > maxPhotos) {
      setError('Une publication peut contenir au maximum 4 photos.')
      return
    }

    setError('')
    setBusy(true)
    try {
      const compressed = await Promise.all(files.map(file =>
        compressImage(file, { maxBytes: 150 * 1024, maxDimension: 1600 })
      ))
      const nextPhotos = [...photos, ...compressed]
      setPhotos(nextPhotos)
      setPreviewImages(nextPhotos.map(image => image.dataUrl))
    } catch (err) {
      reportError(err)
    } finally {
      setBusy(false)
    }
  }

  function removePhoto(index) {
    const nextPhotos = photos.filter((_, photoIndex) => photoIndex !== index)
    setPhotos(nextPhotos)
    setPreviewImages(nextPhotos.map(image => image.dataUrl))
  }

  async function publish(event) {
    event.preventDefault()
    if (!photos.length) {
      setError('Ajoutez au moins une photo à votre publication.')
      return
    }
    if (caption.length > maxCaptionLength) {
      setError(`La description ne peut pas dépasser ${maxCaptionLength} caractères.`)
      return
    }

    setBusy(true)
    setError('')
    setNotice('')
    try {
      await createPost({ user, profile, caption, images: photos })
      setCaption('')
      setPhotos([])
      setPreviewImages([])
      setNotice('Votre publication a été partagée.')
    } catch (err) {
      reportError(err)
    } finally {
      setBusy(false)
    }
  }

  async function sharePost(url, authorName) {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Pleiade Messengers', text: `Publication de ${authorName}`, url })
      } else {
        await navigator.clipboard.writeText(url)
        setNotice('Lien de la publication copié. Vous pouvez le partager sur vos réseaux.')
      }

      function removePost(postId) {
        setPosts(current => current.filter(post => post.id !== postId))
        setNotice('La publication et ses commentaires ont été supprimés.')
      }
    } catch (err) {
      if (err.name !== 'AbortError') reportError(err)
    }
  }

  return <div className="posts-feed">
    <div className="posts-heading"><div><h1>Publications</h1><p>Les publications sont visibles par les membres connectés de Pleiade Messengers.</p></div></div>
    <Toast message={error} onClose={dismissError} />
    <Toast message={notice} type="success" onClose={dismissNotice} />
    <form className="post-composer" onSubmit={publish}>
      <div className="post-composer-heading"><Avatar photoURL={profile.photoURL} name={profile.fullName} /><b>{profile.fullName}</b></div>
      <textarea maxLength={maxCaptionLength} value={caption} onChange={event => setCaption(event.target.value)} placeholder="Quoi de neuf ?" aria-label="Description de la publication" />
      {!!previewImages.length && <div className="post-composer-photos">{previewImages.map((url, index) => <div key={`${url.slice(0, 40)}-${index}`}>
        <img src={url} alt={`Aperçu ${index + 1}`} />
        <button type="button" onClick={() => removePhoto(index)} aria-label={`Retirer la photo ${index + 1}`}><X size={16} /></button>
      </div>)}</div>}
      <div className="post-composer-footer">
        <label className="post-photo-pick"><ImagePlus size={18} />Photos ({photos.length}/{maxPhotos})<input type="file" accept="image/*" multiple disabled={busy || photos.length >= maxPhotos} onChange={selectPhotos} /></label>
        <span>{caption.length}/{maxCaptionLength}</span>
        <button className="post-publish" disabled={busy || photos.length === 0}>{busy ? 'Préparation…' : 'Publier'}</button>
      </div>
    </form>
    {loading ? <div className="posts-empty">Chargement des publications…</div>
      : visiblePosts.length ? visiblePosts.map(post => <PostCard key={post.id} post={post} user={user} profile={profile} onError={reportError} onShare={sharePost} onDeleted={() => removePost(post.id)} />)
        : <div className="posts-empty"><MessageSquare /><b>Pas encore de publication</b><span>Partagez la première photo avec la communauté.</span></div>}
  </div>
}
