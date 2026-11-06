import {
  collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp,
  setDoc, startAt, endAt, updateDoc, where, writeBatch
} from 'firebase/firestore'
import { db } from './firebase'

export async function searchUsers(searchText, currentUid) {
  const search = searchText.trim().toLowerCase().replace(/^@/, '')
  if (search.length < 2) return []

  const usersQuery = query(
    collection(db, 'usernames'),
    orderBy('username'),
    startAt(search),
    endAt(`${search}\uf8ff`),
    limit(12)
  )
  const snapshot = await getDocs(usersQuery)
  return snapshot.docs
    .map(user => ({ uid: user.data().uid, ...user.data() }))
    .filter(user => user.uid !== currentUid)
}

export function listenFriendRequests(uid, onChange, onError) {
  const incomingQuery = query(collection(db, 'friendRequests'), where('toUid', '==', uid))
  const outgoingQuery = query(collection(db, 'friendRequests'), where('fromUid', '==', uid))
  let incoming = []
  let outgoing = []
  let incomingReady = false
  let outgoingReady = false

  const publish = () => {
    if (!incomingReady || !outgoingReady) return
    const requests = new Map([...incoming, ...outgoing].map(request => [request.id, request]))
    onChange(Array.from(requests.values()))
  }
  const stopIncoming = onSnapshot(incomingQuery, snapshot => {
    incoming = snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
    incomingReady = true
    publish()
  }, onError)
  const stopOutgoing = onSnapshot(outgoingQuery, snapshot => {
    outgoing = snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
    outgoingReady = true
    publish()
  }, onError)
  return () => {
    stopIncoming()
    stopOutgoing()
  }
}

export async function sendFriendRequest({ sender, senderUid, recipient }) {
  if (senderUid === recipient.uid) throw new Error('Vous ne pouvez pas vous ajouter vous-même.')
  const requestId = `${senderUid}_${recipient.uid}`
  const requestRef = doc(db, 'friendRequests', requestId)
  const existing = await getDoc(requestRef)
  if (existing.exists()) {
    if (existing.data().status === 'declined' && existing.data().fromUid === senderUid) {
      await updateDoc(requestRef, { status: 'pending' })
      return
    }
    throw new Error('Une invitation existe déjà pour ce compte.')
  }
  const request = {
    fromUid: senderUid,
    toUid: recipient.uid,
    fromUsername: sender.username,
    toUsername: recipient.username,
    fromUser: {
      uid: senderUid,
      username: sender.username,
      fullName: sender.fullName,
      photoURL: sender.photoURL || ''
    },
    toUser: {
      uid: recipient.uid,
      username: recipient.username,
      fullName: recipient.fullName,
      photoURL: recipient.photoURL || ''
    },
    status: 'pending',
    createdAt: serverTimestamp()
  }
  await setDoc(requestRef, request)
}

export async function cancelFriendRequest(requestId) {
  await deleteDoc(doc(db, 'friendRequests', requestId))
}

export async function respondToFriendRequest({ request, accept }) {
  const requestRef = doc(db, 'friendRequests', request.id)
  if (!accept) {
    await updateDoc(requestRef, { status: 'declined' })
    return
  }

  if (request.status === 'pending') {
    await updateDoc(requestRef, { status: 'accepted' })
  } else if (request.status !== 'accepted') {
    throw new Error('Cette invitation ne peut plus être acceptée.')
  }

  const conversationId = [request.fromUid, request.toUid].sort().join('_')
  const batch = writeBatch(db)
  batch.set(doc(db, 'users', request.fromUid, 'friends', request.toUid), {
    ...request.toUser,
    requestId: request.id,
    createdAt: serverTimestamp()
  }, { merge: true })
  batch.set(doc(db, 'users', request.toUid, 'friends', request.fromUid), {
    ...request.fromUser,
    requestId: request.id,
    createdAt: serverTimestamp()
  }, { merge: true })
  const conversationRef = doc(db, 'conversations', conversationId)
  if (!(await getDoc(conversationRef)).exists()) {
    batch.set(conversationRef, {
      participantIds: [request.fromUid, request.toUid].sort(),
      participants: {
        [request.fromUid]: request.fromUser,
        [request.toUid]: request.toUser
      },
      friendRequestId: request.id,
      lastMessage: '',
      updatedAt: serverTimestamp()
    })
  }
  await batch.commit()
}

export function listenFriends(uid, onChange, onError) {
  return onSnapshot(collection(db, 'users', uid, 'friends'), snapshot => {
    const friends = snapshot.docs.map(friend => ({ uid: friend.id, ...friend.data() }))
    friends.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))
    onChange(friends)
  }, onError)
}
