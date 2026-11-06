import {
  addDoc, collection, deleteDoc, doc, getCountFromServer, getDocs, limit, onSnapshot,
  orderBy, query, serverTimestamp, setDoc, writeBatch
} from 'firebase/firestore'
import { db } from './firebase'

const postLimit = 20
const commentLimit = 60

export async function createPost({ user, profile, caption, images }) {
  const postRef = await addDoc(collection(db, 'posts'), {
    authorUid: user.uid,
    authorName: profile.fullName,
    authorUsername: profile.username,
    authorPhotoURL: profile.photoURL || '',
    caption: caption.trim(),
    images: images.map(image => ({
      name: image.name,
      contentType: image.contentType,
      size: image.size,
      dataUrl: image.dataUrl
    })),
    createdAt: serverTimestamp()
  })
  return postRef.id
}

export function listenPosts(onChange, onError) {
  return onSnapshot(query(
    collection(db, 'posts'),
    orderBy('createdAt', 'desc'),
    limit(postLimit)
  ), snapshot => {
    onChange(snapshot.docs.map(item => ({ id: item.id, ...item.data() })))
  }, onError)
}

export function listenPostLikes(postId, userId, onChange, onError) {
  getCountFromServer(collection(db, 'posts', postId, 'likes'))
    .then(snapshot => onChange({ count: snapshot.data().count }))
    .catch(onError)
  return onSnapshot(doc(db, 'posts', postId, 'likes', userId), snapshot => {
    onChange({ liked: snapshot.exists() })
  }, onError)
}

export async function getPostCommentCount(postId) {
  const snapshot = await getCountFromServer(collection(db, 'posts', postId, 'comments'))
  return snapshot.data().count
}

export async function togglePostLike(postId, userId, currentlyLiked) {
  const likeRef = doc(db, 'posts', postId, 'likes', userId)
  if (currentlyLiked) await deleteDoc(likeRef)
  else await setDoc(likeRef, { createdAt: serverTimestamp() })
}

export function listenPostComments(postId, onChange, onError) {
  return onSnapshot(query(
    collection(db, 'posts', postId, 'comments'),
    orderBy('createdAt', 'asc'),
    limit(commentLimit)
  ), snapshot => {
    onChange(snapshot.docs.map(item => ({ id: item.id, ...item.data() })))
  }, onError)
}

export async function addPostComment({ postId, user, profile, text, parentCommentId = '' }) {
  const cleanText = text.trim()
  if (!cleanText || cleanText.length > 1000) {
    throw new Error('Un commentaire doit contenir entre 1 et 1 000 caractères.')
  }
  await addDoc(collection(db, 'posts', postId, 'comments'), {
    authorUid: user.uid,
    authorName: profile.fullName,
    authorUsername: profile.username,
    authorPhotoURL: profile.photoURL || '',
    text: cleanText,
    parentCommentId,
    createdAt: serverTimestamp()
  })
}

export async function deletePostComment(postId, commentId) {
  await deleteDoc(doc(db, 'posts', postId, 'comments', commentId))
}

export async function deletePost(postId) {
  const childCollections = ['likes', 'comments']
  const snapshots = await Promise.all(childCollections.map(name =>
    getDocs(collection(db, 'posts', postId, name))
  ))
  const references = snapshots.flatMap(snapshot => snapshot.docs.map(item => item.ref))
  references.push(doc(db, 'posts', postId))

  for (let offset = 0; offset < references.length; offset += 450) {
    const batch = writeBatch(db)
    references.slice(offset, offset + 450).forEach(reference => batch.delete(reference))
    await batch.commit()
  }
}
