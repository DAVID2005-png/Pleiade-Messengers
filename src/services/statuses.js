import {
  addDoc, collection, deleteDoc, doc, getCountFromServer, getDocs, getDoc, limit,
  onSnapshot, orderBy, query, serverTimestamp, setDoc, Timestamp, where, writeBatch
} from 'firebase/firestore'
import { db } from './firebase'

const statusLifetimeMs = 24 * 60 * 60 * 1000

export async function createStatus({ user, profile, caption, image }) {
  const statusRef = await addDoc(collection(db, 'statuses'), {
    authorUid: user.uid,
    authorName: profile.fullName,
    authorUsername: profile.username,
    authorPhotoURL: profile.photoURL || '',
    caption: caption.trim(),
    image: {
      name: image.name,
      contentType: image.contentType,
      size: image.size,
      dataUrl: image.dataUrl
    },
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + statusLifetimeMs)
  })
  return statusRef.id
}

export function listenStatuses(onChange, onError) {
  return onSnapshot(query(
    collection(db, 'statuses'),
    where('expiresAt', '>', Timestamp.now()),
    orderBy('expiresAt', 'asc'),
    limit(100)
  ), snapshot => {
    onChange(snapshot.docs.map(item => ({ id: item.id, ...item.data() })))
  }, onError)
}

export function listenStatusLikes(statusId, userId, onChange, onError) {
  getCountFromServer(collection(db, 'statuses', statusId, 'likes'))
    .then(snapshot => onChange({ count: snapshot.data().count }))
    .catch(onError)
  return onSnapshot(doc(db, 'statuses', statusId, 'likes', userId), snapshot => {
    onChange({ liked: snapshot.exists() })
  }, onError)
}

export async function toggleStatusLike(statusId, userId, currentlyLiked) {
  const likeRef = doc(db, 'statuses', statusId, 'likes', userId)
  if (currentlyLiked) await deleteDoc(likeRef)
  else await setDoc(likeRef, { createdAt: serverTimestamp() })
}

export async function recordStatusView(statusId, user, profile) {
  await setDoc(doc(db, 'statuses', statusId, 'views', user.uid), {
    viewerUid: user.uid,
    viewerName: profile.fullName,
    viewerUsername: profile.username,
    viewedAt: serverTimestamp()
  })
}

export function listenStatusViews(statusId, onChange, onError) {
  return onSnapshot(query(
    collection(db, 'statuses', statusId, 'views'),
    orderBy('viewedAt', 'desc')
  ), snapshot => {
    onChange(snapshot.docs.map(item => ({ id: item.id, ...item.data() })))
  }, onError)
}

export async function getStatusShareCount(statusId) {
  const snapshot = await getCountFromServer(collection(db, 'statuses', statusId, 'shares'))
  return snapshot.data().count
}

export async function recordStatusShare(statusId, user, profile) {
  const shareRef = doc(db, 'statuses', statusId, 'shares', user.uid)
  const existing = await getDoc(shareRef)
  if (existing.exists()) return false
  await setDoc(shareRef, {
    userUid: user.uid,
    userName: profile.fullName,
    createdAt: serverTimestamp()
  })
  return true
}

export function listenStatusResponses(statusId, ownerUid, onChange, onError) {
  return onSnapshot(query(
    collection(db, 'statuses', statusId, 'responses'),
    where('ownerUid', '==', ownerUid),
    orderBy('createdAt', 'asc'),
    limit(100)
  ), snapshot => {
    onChange(snapshot.docs.map(item => ({ id: item.id, ...item.data() })))
  }, onError)
}

export async function respondToStatus({ status, user, profile, text }) {
  const cleanText = text.trim()
  if (!cleanText || cleanText.length > 500) {
    throw new Error('Une réponse doit contenir entre 1 et 500 caractères.')
  }
  await addDoc(collection(db, 'statuses', status.id, 'responses'), {
    authorUid: user.uid,
    authorName: profile.fullName,
    authorUsername: profile.username,
    ownerUid: status.authorUid,
    text: cleanText,
    createdAt: serverTimestamp()
  })
}

export async function deleteStatus(statusId, ownerUid) {
  const childCollections = ['likes', 'views', 'shares', 'responses']
  const snapshots = await Promise.all(childCollections.map(name => {
    const childCollection = collection(db, 'statuses', statusId, name)
    return name === 'responses'
      ? getDocs(query(childCollection, where('ownerUid', '==', ownerUid)))
      : getDocs(childCollection)
  }))
  const references = snapshots.flatMap(snapshot => snapshot.docs.map(item => item.ref))
  references.push(doc(db, 'statuses', statusId))

  for (let offset = 0; offset < references.length; offset += 450) {
    const batch = writeBatch(db)
    references.slice(offset, offset + 450).forEach(reference => batch.delete(reference))
    await batch.commit()
  }
}
