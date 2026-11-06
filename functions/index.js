import { initializeApp } from 'firebase-admin/app'
import { FieldPath, FieldValue, getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'

initializeApp()

const db = getFirestore()

function requireUser(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Connectez-vous pour continuer.')
  }
  return request.auth
}

function normalizeUsername(value) {
  const username = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    throw new HttpsError('invalid-argument', 'Le pseudo doit contenir 3 à 20 lettres minuscules, chiffres ou tirets bas.')
  }
  return username
}

function normalizePhotoURL(value) {
  const photoURL = typeof value === 'string' ? value : ''
  if (photoURL.length > 320000 ||
    (photoURL.startsWith('data:') &&
     !/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(photoURL))) {
    throw new HttpsError('invalid-argument', 'La photo de profil est trop volumineuse ou invalide.')
  }
  return photoURL
}

export const createUserProfile = onCall(async request => {
  const auth = requireUser(request)
  const username = normalizeUsername(request.data?.username)
  const fullName = typeof request.data?.fullName === 'string' ? request.data.fullName.trim() : ''
  const photoURL = normalizePhotoURL(request.data?.photoURL)
  const coverPhotoURL = normalizePhotoURL(request.data?.coverPhotoURL)
  if (!fullName || fullName.length > 100 || !auth.token.email) {
    throw new HttpsError('invalid-argument', 'Le nom et une adresse e-mail valide sont obligatoires.')
  }

  const usernameRef = db.doc(`usernames/${username}`)
  const userRef = db.doc(`users/${auth.uid}`)
  await db.runTransaction(async transaction => {
    const [usernameSnapshot, userSnapshot] = await Promise.all([
      transaction.get(usernameRef),
      transaction.get(userRef)
    ])
    if (usernameSnapshot.exists && usernameSnapshot.data().uid !== auth.uid) {
      throw new HttpsError('already-exists', 'Ce pseudo est déjà utilisé. Choisissez-en un autre.')
    }
    if (userSnapshot.exists && userSnapshot.data().username !== username) {
      throw new HttpsError('failed-precondition', 'Le pseudo d’un compte existant ne peut pas être remplacé.')
    }

    const profile = {
      username,
      fullName,
      email: auth.token.email,
      birthDate: typeof request.data?.birthDate === 'string' ? request.data.birthDate.slice(0, 10) : '',
      gender: typeof request.data?.gender === 'string' ? request.data.gender.slice(0, 30) : 'Non précisé',
      photoURL,
      coverPhotoURL,
      updatedAt: FieldValue.serverTimestamp()
    }
    transaction.set(usernameRef, {
      uid: auth.uid,
      username,
      fullName,
      photoURL: profile.photoURL,
      coverPhotoURL
    })
    transaction.set(userRef, profile, { merge: true })
    if (userSnapshot.exists) {
      transaction.update(userRef, { phoneNumber: FieldValue.delete() })
    }
  })

  return {
    username,
    fullName,
    email: auth.token.email,
    birthDate: typeof request.data?.birthDate === 'string' ? request.data.birthDate.slice(0, 10) : '',
    gender: typeof request.data?.gender === 'string' ? request.data.gender.slice(0, 30) : 'Non précisé',
    photoURL,
    coverPhotoURL
  }
})

export const addFriendByUsername = onCall(async request => {
  const auth = requireUser(request)
  const username = normalizeUsername(request.data?.username)
  const usernameSnapshot = await db.doc(`usernames/${username}`).get()
  if (!usernameSnapshot.exists) {
    throw new HttpsError('not-found', 'Aucun compte ne correspond à ce pseudo.')
  }
  const friendUid = usernameSnapshot.data().uid
  if (friendUid === auth.uid) {
    throw new HttpsError('failed-precondition', 'Vous ne pouvez pas vous ajouter vous-même.')
  }
  const [outgoingBlock, incomingBlock] = await Promise.all([
    db.doc(`users/${auth.uid}/blocked/${friendUid}`).get(),
    db.doc(`users/${friendUid}/blocked/${auth.uid}`).get()
  ])
  if (outgoingBlock.exists || incomingBlock.exists) {
    throw new HttpsError('permission-denied', 'Cette invitation n’est pas possible.')
  }

  const [friendSnapshot, currentSnapshot] = await Promise.all([
    db.doc(`users/${friendUid}`).get(),
    db.doc(`users/${auth.uid}`).get()
  ])
  if (!friendSnapshot.exists || !currentSnapshot.exists) {
    throw new HttpsError('failed-precondition', 'Le profil de ce compte est incomplet.')
  }
  const friendProfile = friendSnapshot.data()
  const currentProfile = currentSnapshot.data()
  const requestId = `${auth.uid}_${friendUid}`
  const requestRef = db.doc(`friendRequests/${requestId}`)
  const currentUser = {
    uid: auth.uid,
    username: currentProfile.username,
    fullName: currentProfile.fullName,
    photoURL: currentProfile.photoURL || ''
  }
  const friend = {
    uid: friendUid,
    username: friendProfile.username,
    fullName: friendProfile.fullName,
    photoURL: friendProfile.photoURL || ''
  }
  const existing = await requestRef.get()
  if (existing.exists) {
    const data = existing.data()
    if (data.status === 'declined' && data.fromUid === auth.uid) {
      await requestRef.update({ status: 'pending' })
      return { requestId, status: 'pending' }
    }
    throw new HttpsError('already-exists', 'Une invitation existe déjà pour ce compte.')
  }

  await requestRef.create({
    fromUid: auth.uid,
    toUid: friendUid,
    fromUsername: currentUser.username,
    toUsername: friend.username,
    fromUser: currentUser,
    toUser: friend,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp()
  })
  return { requestId, status: 'pending' }
})

export const updateUserProfile = onCall(async request => {
  const auth = requireUser(request)
  const fullName = typeof request.data?.fullName === 'string' ? request.data.fullName.trim() : ''
  const photoURL = normalizePhotoURL(request.data?.photoURL)
  const coverPhotoURL = normalizePhotoURL(request.data?.coverPhotoURL)
  const username = normalizeUsername(request.data?.username)
  if (!fullName || fullName.length > 100 || !auth.token.email) {
    throw new HttpsError('invalid-argument', 'Le nom complet est obligatoire.')
  }

  const userRef = db.doc(`users/${auth.uid}`)
  const userSnapshot = await userRef.get()
  if (!userSnapshot.exists) {
    throw new HttpsError('failed-precondition', 'Le profil doit d’abord être créé.')
  }
  const existing = userSnapshot.data()
  const previousUsernameRef = db.doc(`usernames/${existing.username}`)
  const nextUsernameRef = db.doc(`usernames/${username}`)
  const now = FieldValue.serverTimestamp()
  await db.runTransaction(async transaction => {
    const [currentUserSnapshot, nextUsernameSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(nextUsernameRef)
    ])
    if (!currentUserSnapshot.exists) {
      throw new HttpsError('failed-precondition', 'Le profil doit d’abord être créé.')
    }
    if (nextUsernameSnapshot.exists && nextUsernameSnapshot.data().uid !== auth.uid) {
      throw new HttpsError('already-exists', 'Ce pseudo est déjà utilisé. Choisissez-en un autre.')
    }
    if (username !== existing.username) transaction.delete(previousUsernameRef)
    transaction.set(nextUsernameRef, {
      uid: auth.uid,
      username,
      fullName,
      photoURL,
      coverPhotoURL
    })
    transaction.update(userRef, {
      username,
      fullName,
      birthDate: typeof request.data?.birthDate === 'string' ? request.data.birthDate.slice(0, 10) : '',
      gender: typeof request.data?.gender === 'string' ? request.data.gender.slice(0, 30) : 'Non précisé',
      photoURL,
      coverPhotoURL,
      updatedAt: now
    })
  })

  const profile = {
    uid: auth.uid,
    username,
    fullName,
    photoURL,
    coverPhotoURL
  }

  const [friendsSnapshot, conversationsSnapshot] = await Promise.all([
    db.collection(`users/${auth.uid}/friends`).get(),
    db.collection('conversations').where('participantIds', 'array-contains', auth.uid).get()
  ])
  const friendRefs = friendsSnapshot.docs.map(friend =>
    db.doc(`users/${friend.id}/friends/${auth.uid}`)
  )
  for (let offset = 0; offset < friendRefs.length; offset += 400) {
    const batch = db.batch()
    friendRefs.slice(offset, offset + 400).forEach(friendRef => {
      batch.set(friendRef, {
        ...profile,
        createdAt: now
      }, { merge: true })
    })
    await batch.commit()
  }

  const conversationDocs = conversationsSnapshot.docs
  for (let offset = 0; offset < conversationDocs.length; offset += 400) {
    const batch = db.batch()
    conversationDocs.slice(offset, offset + 400).forEach(conversation => {
      batch.update(conversation.ref, new FieldPath('participants', auth.uid), profile)
    })
    await batch.commit()
  }

  return {
    fullName,
    username,
    email: auth.token.email,
    birthDate: typeof request.data?.birthDate === 'string' ? request.data.birthDate.slice(0, 10) : '',
    gender: typeof request.data?.gender === 'string' ? request.data.gender.slice(0, 30) : 'Non précisé',
    photoURL: profile.photoURL,
    coverPhotoURL
  }
})

export const blockUser = onCall(async request => {
  const auth = requireUser(request)
  const targetUid = typeof request.data?.targetUid === 'string' ? request.data.targetUid.trim() : ''
  if (!targetUid || targetUid === auth.uid) {
    throw new HttpsError('invalid-argument', 'Choisissez un compte valide à bloquer.')
  }

  const [blockerSnapshot, targetSnapshot] = await Promise.all([
    db.doc(`users/${auth.uid}`).get(),
    db.doc(`users/${targetUid}`).get()
  ])
  if (!blockerSnapshot.exists || !targetSnapshot.exists) {
    throw new HttpsError('not-found', 'Ce compte est introuvable.')
  }
  const target = targetSnapshot.data()
  const batch = db.batch()
  batch.set(db.doc(`users/${auth.uid}/blocked/${targetUid}`), {
    uid: targetUid,
    username: target.username || '',
    fullName: target.fullName || '',
    photoURL: target.photoURL || '',
    createdAt: FieldValue.serverTimestamp()
  })
  batch.set(db.doc(`users/${targetUid}/blockedBy/${auth.uid}`), {
    uid: auth.uid,
    username: blockerSnapshot.data().username || '',
    fullName: blockerSnapshot.data().fullName || '',
    photoURL: blockerSnapshot.data().photoURL || '',
    createdAt: FieldValue.serverTimestamp()
  })
  batch.delete(db.doc(`users/${auth.uid}/friends/${targetUid}`))
  batch.delete(db.doc(`users/${targetUid}/friends/${auth.uid}`))
  await batch.commit()

  const requests = await db.collection('friendRequests')
    .where('fromUid', 'in', [auth.uid, targetUid])
    .get()
  const pendingRequestRefs = requests.docs
    .filter(item => item.data().toUid === auth.uid || item.data().toUid === targetUid)
    .map(item => item.ref)
  for (let offset = 0; offset < pendingRequestRefs.length; offset += 400) {
    const requestBatch = db.batch()
    pendingRequestRefs.slice(offset, offset + 400).forEach(reference => requestBatch.delete(reference))
    await requestBatch.commit()
  }
  return { blockedUid: targetUid }
})

export const unblockUser = onCall(async request => {
  const auth = requireUser(request)
  const targetUid = typeof request.data?.targetUid === 'string' ? request.data.targetUid.trim() : ''
  if (!targetUid || targetUid === auth.uid) {
    throw new HttpsError('invalid-argument', 'Choisissez un compte valide à débloquer.')
  }
  const batch = db.batch()
  batch.delete(db.doc(`users/${auth.uid}/blocked/${targetUid}`))
  batch.delete(db.doc(`users/${targetUid}/blockedBy/${auth.uid}`))
  await batch.commit()
  return { unblockedUid: targetUid }
})
