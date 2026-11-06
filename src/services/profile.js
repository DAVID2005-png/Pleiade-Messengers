import {
  collection, doc, FieldPath, getDoc, getDocs, onSnapshot, query, serverTimestamp,
  where, writeBatch
} from 'firebase/firestore'
import { db } from './firebase'

export async function saveProfile(profile) {
  const username = profile.username.trim().toLowerCase()
  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    throw new Error('Le pseudo doit contenir 3 à 20 lettres minuscules, chiffres ou tirets bas.')
  }
  const profileData = {
    uid: profile.uid,
    username,
    fullName: profile.fullName.trim(),
    photoURL: profile.photoURL || '',
    coverPhotoURL: profile.coverPhotoURL || ''
  }
  const userRef = doc(db, 'users', profile.uid)
  const previousUsername = profile.username.toLowerCase()
  const usernameBatch = writeBatch(db)
  usernameBatch.set(userRef, {
    username,
    fullName: profileData.fullName,
    birthDate: profile.birthDate || '',
    gender: profile.gender || 'Non précisé',
    photoURL: profileData.photoURL,
    coverPhotoURL: profileData.coverPhotoURL,
    updatedAt: serverTimestamp()
  }, { merge: true })
  usernameBatch.set(doc(db, 'usernames', username), profileData)
  if (previousUsername !== username) {
    usernameBatch.delete(doc(db, 'usernames', previousUsername))
  }
  await usernameBatch.commit()

  const [friendsSnapshot, conversationsSnapshot, blockedSnapshot, blockedBySnapshot] = await Promise.all([
    getDocs(collection(db, 'users', profile.uid, 'friends')),
    getDocs(query(collection(db, 'conversations'), where('participantIds', 'array-contains', profile.uid))),
    getDocs(collection(db, 'users', profile.uid, 'blocked')),
    getDocs(collection(db, 'users', profile.uid, 'blockedBy'))
  ])
  const unavailableUsers = new Set([
    ...blockedSnapshot.docs.map(item => item.id),
    ...blockedBySnapshot.docs.map(item => item.id)
  ])
  for (let offset = 0; offset < friendsSnapshot.docs.length; offset += 400) {
    const batch = writeBatch(db)
    friendsSnapshot.docs.slice(offset, offset + 400).forEach(friend => {
      batch.set(doc(db, 'users', friend.id, 'friends', profile.uid), {
        ...profileData,
        createdAt: serverTimestamp()
      }, { merge: true })
    })
    await batch.commit()
  }
  for (let offset = 0; offset < conversationsSnapshot.docs.length; offset += 400) {
    const batch = writeBatch(db)
    conversationsSnapshot.docs.slice(offset, offset + 400).forEach(conversation => {
      const otherUid = conversation.data().participantIds?.find(uid => uid !== profile.uid)
      if (otherUid && !unavailableUsers.has(otherUid)) {
        batch.update(conversation.ref, new FieldPath('participants', profile.uid), profileData)
      }
    })
    await batch.commit()
  }

  return {
    ...profile,
    ...profileData
  }
}

export async function getProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid))
  return snap.exists() ? snap.data() : null
}

export function listenBlockedUsers(uid, onChange, onError) {
  return onSnapshot(collection(db, 'users', uid, 'blocked'), snapshot => {
    onChange(snapshot.docs.map(item => ({ uid: item.id, ...item.data() })))
  }, onError)
}

export function listenAccountsBlockingUser(uid, onChange, onError) {
  return onSnapshot(collection(db, 'users', uid, 'blockedBy'), snapshot => {
    onChange(snapshot.docs.map(item => ({ uid: item.id, ...item.data() })))
  }, onError)
}

export async function blockAccount({ userUid, currentProfile, target }) {
  if (!target?.uid || target.uid === userUid) {
    throw new Error('Choisissez un compte valide à bloquer.')
  }
  const blockRef = doc(db, 'users', userUid, 'blocked', target.uid)
  const [existingBlock, friend, outgoingRequest, incomingRequest] = await Promise.all([
    getDoc(blockRef),
    getDoc(doc(db, 'users', userUid, 'friends', target.uid)),
    getDoc(doc(db, 'friendRequests', `${userUid}_${target.uid}`)),
    getDoc(doc(db, 'friendRequests', `${target.uid}_${userUid}`))
  ])
  if (existingBlock.exists()) return

  const batch = writeBatch(db)
  batch.set(blockRef, {
    uid: target.uid,
    username: target.username,
    fullName: target.fullName || '',
    photoURL: target.photoURL || '',
    createdAt: serverTimestamp()
  })
  batch.set(doc(db, 'users', target.uid, 'blockedBy', userUid), {
    uid: userUid,
    username: currentProfile.username,
    fullName: currentProfile.fullName,
    photoURL: currentProfile.photoURL || '',
    createdAt: serverTimestamp()
  })
  if (friend.exists()) {
    batch.delete(friend.ref)
    batch.delete(doc(db, 'users', target.uid, 'friends', userUid))
  }
  if (outgoingRequest.exists()) batch.delete(outgoingRequest.ref)
  if (incomingRequest.exists()) batch.delete(incomingRequest.ref)
  await batch.commit()
}

export async function unblockAccount({ userUid, targetUid }) {
  const batch = writeBatch(db)
  batch.delete(doc(db, 'users', userUid, 'blocked', targetUid))
  batch.delete(doc(db, 'users', targetUid, 'blockedBy', userUid))
  await batch.commit()
}
