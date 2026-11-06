import {
  arrayUnion, collection, doc, getDoc, limit, onSnapshot, orderBy, query, serverTimestamp,
  setDoc, updateDoc, where, writeBatch
} from 'firebase/firestore'
import {
  deleteObject, getDownloadURL, ref, uploadBytesResumable
} from 'firebase/storage'
import { db, storage } from './firebase'
import { compressImage } from './images'

const maxAttachmentSize = 15 * 1024 * 1024
const maxImageSourceSize = 50 * 1024 * 1024
const maxInlineImageSize = 150 * 1024
const maxInlineImages = 4
const allowedAttachmentTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav'
])

export function listenConversations(uid, callback, onError) {
  const conversationsQuery = query(
    collection(db, 'conversations'),
    where('participantIds', 'array-contains', uid)
  )
  return onSnapshot(conversationsQuery, snapshot => {
    const conversations = snapshot.docs.map(conversation => ({
      id: conversation.id,
      ...conversation.data()
    }))
    conversations.sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0))
    callback(conversations)
  }, onError)
}

function uploadAttachment(conversationId, messageId, file, onProgress) {
  const isImage = file.type.startsWith('image/')
  const contentType = file.type.split(';')[0].toLowerCase()
  if (!file.size || file.size > (isImage ? maxImageSourceSize : maxAttachmentSize)) {
    if (isImage && file.size > maxImageSourceSize) {
      throw new Error('Choisissez une image de moins de 50 Mo pour la compresser.')
    }
    throw new Error('Chaque photo, document ou note vocale est limité à 15 Mo.')
  }
  if (!isImage && !allowedAttachmentTypes.has(contentType)) {
    throw new Error('Format non accepté. Utilisez une image, un document PDF/Office/TXT ou un fichier audio.')
  }

  if (isImage) {
    return compressImage(file, { maxBytes: maxInlineImageSize, maxDimension: 1400 }).then(image => {
      onProgress?.(1)
      return {
        name: image.name,
        contentType: image.contentType,
        size: image.size,
        dataUrl: image.dataUrl
      }
    })
  }

  const safeName = file.name.replace(/[^\w.-]/g, '_').slice(0, 100) || 'fichier'
  const storageRef = ref(storage, `conversations/${conversationId}/${messageId}/${safeName}`)
  const task = uploadBytesResumable(storageRef, file, { contentType })

  return new Promise((resolve, reject) => {
    task.on('state_changed', snapshot => {
      onProgress?.(snapshot.bytesTransferred / snapshot.totalBytes)
    }, reject, async () => {
      try {
        resolve({
          name: file.name,
          contentType,
          size: file.size,
          storagePath: storageRef.fullPath,
          downloadURL: await getDownloadURL(task.snapshot.ref)
        })
      } catch (error) {
        reject(error)
      }
    })
  })
}

export async function sendMessage({ conversationId, senderId, text = '', attachmentFiles = [], attachmentFile = null, onProgress }) {
  const cleanText = text.trim()
  const files = attachmentFiles.length ? attachmentFiles : attachmentFile ? [attachmentFile] : []
  if ((!cleanText && !files.length) || cleanText.length > 5000) return
  if (files.length > maxInlineImages ||
    (files.length > 1 && files.some(file => !file.type.startsWith('image/')))) {
    throw new Error('Joignez jusqu’à 4 photos, ou un seul document ou message vocal.')
  }

  const conversationRef = doc(db, 'conversations', conversationId)
  const conversationSnapshot = await getDoc(conversationRef)
  if (!conversationSnapshot.exists()) {
    throw new Error('Cette conversation n’existe plus. Actualisez votre liste d’amis.')
  }
  const conversation = conversationSnapshot.data()
  if (!conversation.participantIds?.includes(senderId)) {
    throw new Error('Vous ne faites pas partie de cette conversation.')
  }
  const recipientId = conversation.participantIds.find(uid => uid !== senderId)
  if (!recipientId) throw new Error('Le destinataire de cette conversation est introuvable.')

  const messageRef = doc(collection(db, 'conversations', conversationId, 'messages'))
  const attachments = []
  try {
    for (const [index, file] of files.entries()) {
      const attachment = await uploadAttachment(
        conversationId,
        `${messageRef.id}_${index}`,
        file,
        progress => onProgress?.((index + progress) / files.length)
      )
      attachments.push(attachment)
    }

    const lastMessage = cleanText || (attachments.length > 1
      ? `${attachments.length} photos`
      : attachments[0].contentType.startsWith('image/') ? 'Photo' : attachments[0].name)
    const createdAt = serverTimestamp()
    const batch = writeBatch(db)
    const content = {
      senderId,
      text: cleanText,
      readBy: [senderId],
      createdAt
    }
    if (attachments.length === 1) content.attachment = attachments[0]
    if (attachments.length > 1) content.attachments = attachments

    batch.set(messageRef, content)
    batch.update(conversationRef, {
      lastMessage,
      updatedAt: createdAt
    })
    batch.set(doc(db, 'users', recipientId, 'notifications', messageRef.id), {
      type: 'message',
      conversationId,
      messageId: messageRef.id,
      senderUid: senderId,
      senderName: conversation.participants?.[senderId]?.fullName || 'Un ami',
      senderUsername: conversation.participants?.[senderId]?.username || '',
      senderPhotoURL: conversation.participants?.[senderId]?.photoURL || '',
      preview: cleanText || lastMessage,
      createdAt,
      read: false
    })
    await batch.commit()
  } catch (error) {
    const uploadedFiles = attachments.filter(attachment => attachment.storagePath)
    for (const attachment of uploadedFiles) {
      try {
        await deleteObject(ref(storage, attachment.storagePath))
      } catch (cleanupError) {
        console.error('Unable to remove the unreferenced message attachment:', cleanupError)
      }
    }
    throw error
  }
}

export function listenMessages(conversationId, callback, onError) {
  const messagesQuery = query(
    collection(db, 'conversations', conversationId, 'messages'),
    orderBy('createdAt')
  )
  return onSnapshot(messagesQuery, snapshot => {
    callback(snapshot.docs.map(message => ({ id: message.id, ...message.data() })))
  }, onError)
}

export async function markMessagesRead(conversationId, userId, messages) {
  const unread = messages.filter(message =>
    message.senderId !== userId && !message.readBy?.includes(userId)
  )
  for (let offset = 0; offset < unread.length; offset += 400) {
    const batch = writeBatch(db)
    unread.slice(offset, offset + 400).forEach(message => {
      batch.update(doc(db, 'conversations', conversationId, 'messages', message.id), {
        readBy: arrayUnion(userId)
      })
    })
    await batch.commit()
  }
}

export function listenPresence(userId, callback, onError) {
  return onSnapshot(doc(db, 'users', userId, 'presence', 'status'), snapshot => {
    callback(snapshot.exists() ? snapshot.data() : null)
  }, onError)
}

export function listenNotifications(userId, callback, onError) {
  return onSnapshot(query(
    collection(db, 'users', userId, 'notifications'),
    orderBy('createdAt', 'desc'),
    limit(40)
  ), snapshot => {
    callback(snapshot.docs.map(item => ({ id: item.id, ...item.data() })))
  }, onError)
}

export async function markNotificationRead(userId, notificationId) {
  await updateDoc(doc(db, 'users', userId, 'notifications', notificationId), {
    read: true,
    readAt: serverTimestamp()
  })
}

export function listenTyping(conversationId, userId, callback, onError) {
  return onSnapshot(doc(db, 'conversations', conversationId, 'typing', userId), snapshot => {
    callback(snapshot.exists() ? snapshot.data() : null)
  }, onError)
}

export function setTypingStatus(conversationId, userId, isTyping) {
  return setDoc(doc(db, 'conversations', conversationId, 'typing', userId), {
    isTyping,
    updatedAt: serverTimestamp()
  })
}

export function updatePresence(userId, isOnline) {
  return setDoc(doc(db, 'users', userId, 'presence', 'status'), {
    isOnline,
    lastSeen: serverTimestamp()
  }, { merge: true })
}
