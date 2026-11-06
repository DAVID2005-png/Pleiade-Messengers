import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  browserLocalPersistence, sendEmailVerification, sendPasswordResetEmail, setPersistence
} from 'firebase/auth'
import {
  ArrowLeft, AtSign, Bell, CalendarDays, Camera, Check, ChevronRight, Download, FileText,
  ImagePlus, LogOut, MessageCircle, Mic, Paperclip, Plus, Search, CircleDashed, Newspaper,
  Send, Settings, ShieldBan, UserRound, UserPlus, Users, X
} from 'lucide-react'
import {
  cancelFriendRequest, listenFriendRequests, listenFriends, respondToFriendRequest,
  searchUsers, sendFriendRequest
} from '../services/friends'
import {
  listenConversations, listenMessages, listenNotifications, listenPresence, listenTyping,
  markMessagesRead, markNotificationRead, sendMessage, setTypingStatus, updatePresence
} from '../services/messages'
import {
  blockAccount, listenAccountsBlockingUser, listenBlockedUsers, saveProfile, unblockAccount
} from '../services/profile'
import { compressImage } from '../services/images'
import { auth } from '../services/firebase'
import Posts from '../components/Posts'
import Statuses from '../components/Statuses'
import Toast from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'

const maxAttachmentSize = 15 * 1024 * 1024

function getDate(timestamp) {
  return timestamp?.toDate?.() || null
}

function formatTime(timestamp) {
  return getDate(timestamp)?.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) || ''
}

function formatDate(timestamp) {
  const date = getDate(timestamp)
  if (!date) return ''
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return "Aujourd'hui"
  if (date.toDateString() === yesterday.toDateString()) return 'Hier'
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

function isOnline(presence) {
  const lastSeen = getDate(presence?.lastSeen)
  return Boolean(presence?.isOnline && lastSeen && Date.now() - lastSeen.getTime() < 120_000)
}

function formatLastSeen(presence) {
  if (isOnline(presence)) return 'En ligne'
  const lastSeen = getDate(presence?.lastSeen)
  if (!lastSeen) return 'Hors ligne'
  return `Vu ${lastSeen.toLocaleString('fr-FR', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  })}`
}

function Avatar({ person, small = false, onPhotoClick }) {
  const canOpen = Boolean(person?.photoURL && onPhotoClick)
  return <div
    className={`avatar${small ? ' small' : ''}${canOpen ? ' photo-avatar' : ''}`}
    role={canOpen ? 'button' : undefined}
    tabIndex={canOpen ? 0 : undefined}
    onClick={canOpen ? event => {
      event.stopPropagation()
      onPhotoClick(person)
    } : undefined}
    onKeyDown={canOpen ? event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        event.stopPropagation()
        onPhotoClick(person)
      }
    } : undefined}
    aria-label={canOpen ? `Agrandir la photo de ${person.fullName || person.username || 'profil'}` : undefined}
  >
    {person?.photoURL ? <img src={person.photoURL} alt="" /> : <UserRound />}
  </div>
}

function MessageAttachment({ attachment, onImageClick }) {
  if (attachment.contentType?.startsWith('image/')) {
    const imageURL = attachment.dataUrl || attachment.downloadURL
    if (!imageURL) return null
    return <button className="message-image-link" type="button" onClick={() => onImageClick(imageURL)}>
      <img className="message-image" src={imageURL} alt={attachment.name} loading="lazy" />
    </button>
  }
  if (!attachment?.downloadURL) return null
  if (attachment.contentType?.startsWith('audio/')) {
    return <div className="message-file"><b>{attachment.name}</b><audio controls preload="none" src={attachment.downloadURL} /></div>
  }
  return <a className="message-file document-link" href={attachment.downloadURL} target="_blank" rel="noreferrer" download={attachment.name}>
    <FileText size={22} /><span>{attachment.name}<small>{(attachment.size / (1024 * 1024)).toFixed(2)} Mo · Télécharger</small></span>
  </a>
}

export default function Messenger({ user, profile, profileError, onProfileChange, onLogout }) {
  const [tab, setTab] = useState(() =>
    new URLSearchParams(window.location.search).has('post')
      ? 'posts'
      : new URLSearchParams(window.location.search).has('status') ? 'statuses' : 'chats'
  )
  const [selected, setSelected] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [editingField, setEditingField] = useState('')
  const [fieldDraft, setFieldDraft] = useState('')
  const [friendUsername, setFriendUsername] = useState('')
  const [friendResults, setFriendResults] = useState([])
  const [friendRequests, setFriendRequests] = useState([])
  const [notifications, setNotifications] = useState([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [friendSearchBusy, setFriendSearchBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [attachmentFiles, setAttachmentFiles] = useState([])
  const [profilePhoto, setProfilePhoto] = useState('')
  const [imageZoomed, setImageZoomed] = useState(false)
  const [search, setSearch] = useState('')
  const [friends, setFriends] = useState([])
  const [blockedUsers, setBlockedUsers] = useState([])
  const [blockingUsers, setBlockingUsers] = useState([])
  const [blockSearch, setBlockSearch] = useState('')
  const [blockResults, setBlockResults] = useState([])
  const [blockSearchBusy, setBlockSearchBusy] = useState(false)
  const [blockingTarget, setBlockingTarget] = useState(null)
  const [conversations, setConversations] = useState([])
  const [messages, setMessages] = useState([])
  const [presenceByUser, setPresenceByUser] = useState({})
  const [typingData, setTypingData] = useState(null)
  const [, setPresenceClock] = useState(0)
  const [contactsLoading, setContactsLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(null)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState(profileError || '')
  const [notice, setNotice] = useState('')
  const [profileImageBusy, setProfileImageBusy] = useState(false)
  const recorderRef = useRef(null)
  const openNotificationRef = useRef(() => {})
  const seenNotificationIdsRef = useRef(new Set())
  const notificationsInitializedRef = useRef(false)
  const mediaStreamRef = useRef(null)
  const typingTimerRef = useRef(null)
  const typingActiveRef = useRef(false)
  const recordingTimerRef = useRef(null)
  const messageEndRef = useRef(null)
  const pendingAttachmentUrlsRef = useRef(new Set())
  const profilePhotoInputRef = useRef(null)
  const coverPhotoInputRef = useRef(null)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const name = profile?.fullName || user.email || 'Mon compte'
  const dismissError = useCallback(() => setError(''), [])
  const dismissNotice = useCallback(() => setNotice(''), [])
  const openProfilePhoto = person => {
    if (person?.photoURL) {
      setProfilePhoto(person.photoURL)
      setImageZoomed(false)
    }
  }
  const openMessageImage = imageUrl => {
    setProfilePhoto(imageUrl)
    setImageZoomed(false)
  }
  const removeAttachment = id => {
    setAttachmentFiles(current => {
      const removed = current.find(item => item.id === id)
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl)
        pendingAttachmentUrlsRef.current.delete(removed.previewUrl)
      }
      return current.filter(item => item.id !== id)
    })
  }
  const clearAttachmentFiles = () => {
    setAttachmentFiles(current => {
      current.forEach(item => {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl)
          pendingAttachmentUrlsRef.current.delete(item.previewUrl)
        }
      })
      return []
    })
  }

  useEffect(() => () => {
    pendingAttachmentUrlsRef.current.forEach(url => URL.revokeObjectURL(url))
    pendingAttachmentUrlsRef.current.clear()
  }, [])

  useEffect(() => {
    if (profileError) setError(profileError)
  }, [profileError])

  useEffect(() => {
    const fail = err => {
      console.error('Unable to load messenger data:', err)
      setError(err.message || 'Impossible de charger les données. Vérifiez la configuration Firebase.')
    }
    const stopFriends = listenFriends(user.uid, setFriends, fail)
    const stopRequests = listenFriendRequests(user.uid, setFriendRequests, fail)
    const stopConversations = listenConversations(user.uid, setConversations, fail)
    setContactsLoading(false)
    return () => {
      stopFriends()
      stopRequests()
      stopConversations()
    }
  }, [user.uid])

  useEffect(() => listenBlockedUsers(user.uid, setBlockedUsers, err => {
    console.error('Unable to load blocked accounts:', err)
    setError(err.message || 'Impossible de charger les comptes bloqués.')
  }), [user.uid])

  useEffect(() => listenAccountsBlockingUser(user.uid, setBlockingUsers, err => {
    console.error('Unable to load account restrictions:', err)
    setError(err.message || 'Impossible de charger les restrictions de compte.')
  }), [user.uid])

  useEffect(() => {
    seenNotificationIdsRef.current = new Set()
    notificationsInitializedRef.current = false
    return listenNotifications(user.uid, items => {
      const newItems = items.filter(item => !seenNotificationIdsRef.current.has(item.id))
      items.forEach(item => seenNotificationIdsRef.current.add(item.id))
      setNotifications(items)
      if (!notificationsInitializedRef.current) {
        notificationsInitializedRef.current = true
        return
      }
      if (document.visibilityState === 'visible' || !('Notification' in window) ||
        Notification.permission !== 'granted') return
      newItems.filter(item => item.type === 'message').forEach(item => {
        const browserNotification = new Notification(item.senderName || 'Nouveau message', {
          body: item.preview || 'Vous avez reçu un message.',
          icon: item.senderPhotoURL || '/icons/pwa-192.png',
          tag: item.conversationId
        })
        browserNotification.onclick = () => {
          window.focus()
          openNotificationRef.current(item)
          browserNotification.close()
        }
      })
    }, err => {
      console.error('Unable to listen for notifications:', err)
      setError(err.message || 'Impossible de charger les notifications.')
    })
  }, [user.uid])

  useEffect(() => {
    const searchText = friendUsername.trim()
    if (!showAdd || searchText.replace(/^@/, '').length < 2) {
      setFriendResults([])
      return undefined
    }

    let active = true
    const timer = window.setTimeout(() => {
      setFriendSearchBusy(true)
      searchUsers(searchText, user.uid)
        .then(results => {
          if (active) setFriendResults(results)
        })
        .catch(err => {
          if (active) {
            console.error('Unable to search user directory:', err)
            setError(err.message || 'Impossible de rechercher des comptes.')
          }
        })
        .finally(() => {
          if (active) setFriendSearchBusy(false)
        })
    }, 250)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [friendUsername, showAdd, user.uid])

  const activeConversation = selected
    ? conversations.find(conversation => conversation.id === selected.id) || selected
    : null
  const otherUserId = activeConversation?.participantIds?.find(uid => uid !== user.uid)
  const otherParticipant = activeConversation?.participants?.[otherUserId]
  const typingUpdatedAt = getDate(typingData?.updatedAt)
  const otherIsTyping = Boolean(
    typingData?.isTyping && typingUpdatedAt && Date.now() - typingUpdatedAt.getTime() < 6000
  )

  useEffect(() => {
    const timer = window.setInterval(() => setPresenceClock(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const presenceIds = useMemo(() => Array.from(new Set([
    ...friends.map(friend => friend.uid),
    ...conversations.flatMap(conversation => conversation.participantIds || [])
  ].filter(uid => uid && uid !== user.uid))), [friends, conversations, user.uid])
  const presenceKey = presenceIds.join('|')

  useEffect(() => {
    let active = true
    const publish = () => updatePresence(user.uid, document.visibilityState === 'visible')
      .catch(err => {
        if (active) {
          console.error('Unable to update online status:', err)
          setError(err.message || 'Impossible de mettre à jour le statut en ligne.')
        }
      })
    publish()
    const heartbeat = window.setInterval(publish, 60_000)
    const onVisibilityChange = () => publish()
    const onPageHide = () => {
      updatePresence(user.uid, false).catch(err => console.error('Unable to mark the user offline:', err))
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      active = false
      window.clearInterval(heartbeat)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', onPageHide)
      updatePresence(user.uid, false).catch(err => console.error('Unable to mark the user offline:', err))
    }
  }, [user.uid])

  useEffect(() => {
    const stops = presenceIds.map(uid => listenPresence(uid, presence => {
      setPresenceByUser(old => ({ ...old, [uid]: presence }))
    }, err => {
      console.error(`Unable to load presence for ${uid}:`, err)
    }))
    return () => stops.forEach(stop => stop())
  }, [presenceKey])

  useEffect(() => {
    setMessages([])
    if (!activeConversation) return undefined
    return listenMessages(activeConversation.id, setMessages, err => {
      console.error('Unable to load conversation messages:', err)
      setError(err.message || 'Impossible de charger cette conversation.')
    })
  }, [activeConversation?.id])

  useEffect(() => {
    if (!activeConversation || document.visibilityState !== 'visible') return
    const markVisibleMessagesRead = () => {
      if (document.visibilityState !== 'visible') return
      markMessagesRead(activeConversation.id, user.uid, messages).catch(err => {
        console.error('Unable to mark messages as read:', err)
        setError(err.message || 'Impossible de confirmer la lecture des messages.')
      })
    }
    markVisibleMessagesRead()
    document.addEventListener('visibilitychange', markVisibleMessagesRead)
    return () => document.removeEventListener('visibilitychange', markVisibleMessagesRead)
  }, [activeConversation?.id, messages, user.uid])

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    setTypingData(null)
    typingActiveRef.current = false
    if (!activeConversation || !otherUserId) return undefined
    const stop = listenTyping(activeConversation.id, otherUserId, status => {
      setTypingData(status)
    }, err => console.error('Unable to listen for typing status:', err))
    return () => {
      stop()
      window.clearTimeout(typingTimerRef.current)
      setTypingStatus(activeConversation.id, user.uid, false)
        .catch(err => console.error('Unable to clear typing status:', err))
    }
  }, [activeConversation?.id, otherUserId, user.uid])

  useEffect(() => () => {
    window.clearInterval(recordingTimerRef.current)
    mediaStreamRef.current?.getTracks().forEach(track => track.stop())
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }, [])

  const blockedUidSet = useMemo(() => new Set([
    ...blockedUsers.map(person => person.uid),
    ...blockingUsers.map(person => person.uid)
  ]), [blockedUsers, blockingUsers])
  const blockedUidList = useMemo(() => Array.from(blockedUidSet), [blockedUidSet])
  useEffect(() => {
    const otherUid = selected?.participantIds?.find(uid => uid !== user.uid)
    if (otherUid && blockedUidSet.has(otherUid)) setSelected(null)
  }, [selected, user.uid, blockedUidSet])
  const filteredFriends = useMemo(() => friends.filter(friend =>
    !blockedUidSet.has(friend.uid) &&
    `${friend.fullName || ''} ${friend.username || ''}`.toLowerCase().includes(search.toLowerCase())
  ), [friends, search, blockedUidSet])
  const filteredConversations = useMemo(() => conversations.filter(conversation => {
    const otherUid = conversation.participantIds?.find(uid => uid !== user.uid)
    if (blockedUidSet.has(otherUid)) return false
    const participant = conversation.participants?.[otherUid]
    return `${participant?.fullName || ''} ${participant?.username || ''} ${conversation.lastMessage || ''}`
      .toLowerCase().includes(search.toLowerCase())
  }), [conversations, search, user.uid, blockedUidSet])
  const incomingRequests = friendRequests.filter(request =>
    request.status === 'pending' && request.toUid === user.uid && !blockedUidSet.has(request.fromUid)
  )
  const acceptedFriendshipsToFinish = friendRequests.filter(request =>
    request.status === 'accepted' &&
    (request.fromUid === user.uid || request.toUid === user.uid) &&
    !blockedUidSet.has(request.fromUid === user.uid ? request.toUid : request.fromUid) &&
    !friends.some(friend => friend.uid === (request.fromUid === user.uid ? request.toUid : request.fromUid))
  )
  const outgoingRequests = friendRequests.filter(request =>
    request.status === 'pending' && request.fromUid === user.uid && !blockedUidSet.has(request.toUid)
  )

  function openFriend(friend) {
    if (blockedUidSet.has(friend.uid)) return
    const conversationId = [user.uid, friend.uid].sort().join('_')
    setSelected(conversations.find(conversation => conversation.id === conversationId) || {
      id: conversationId,
      participantIds: [user.uid, friend.uid],
      participants: {
        [user.uid]: { uid: user.uid, fullName: name, photoURL: profile?.photoURL || '' },
        [friend.uid]: friend
      }
    })
  }

  async function searchAccountToBlock() {
    if (blockSearch.trim().replace(/^@/, '').length < 2) {
      setBlockResults([])
      return
    }
    setBlockSearchBusy(true)
    try {
      const results = await searchUsers(blockSearch, user.uid)
      setBlockResults(results.filter(person => !blockedUidSet.has(person.uid)))
    } catch (err) {
      console.error('Unable to search for an account to block:', err)
      setError(err.message || 'Impossible de rechercher ce compte.')
    } finally {
      setBlockSearchBusy(false)
    }
  }

  async function handleBlockAccount() {
    if (!blockingTarget) return
    setBusy(true)
    setError('')
    try {
      await blockAccount({ userUid: user.uid, currentProfile: profile, target: blockingTarget })
      setBlockedUsers(current => current.some(person => person.uid === blockingTarget.uid)
        ? current
        : [...current, blockingTarget])
      setBlockResults(current => current.filter(person => person.uid !== blockingTarget.uid))
      setBlockingTarget(null)
      setNotice(`${blockingTarget.fullName || blockingTarget.username} a été bloqué. Il ne peut plus vous inviter ni vous écrire.`)
    } catch (err) {
      console.error('Unable to block account:', err)
      setError(err.message || 'Impossible de bloquer ce compte.')
    } finally {
      setBusy(false)
    }
  }

  async function handleUnblockAccount(person) {
    setBusy(true)
    setError('')
    try {
      await unblockAccount({ userUid: user.uid, targetUid: person.uid })
      setBlockedUsers(current => current.filter(item => item.uid !== person.uid))
      setNotice(`${person.fullName || person.username} a été débloqué. Vous pourrez recevoir une nouvelle invitation.`)
    } catch (err) {
      console.error('Unable to unblock account:', err)
      setError(err.message || 'Impossible de débloquer ce compte.')
    } finally {
      setBusy(false)
    }
  }

  function openNotification(notification) {
    if (blockedUidSet.has(notification.senderUid)) {
      setShowNotifications(false)
      setNotice('Cette conversation est indisponible pour un compte bloqué.')
      return
    }
    const conversation = conversations.find(item => item.id === notification.conversationId) || {
      id: notification.conversationId,
      participantIds: [user.uid, notification.senderUid],
      participants: {
        [user.uid]: { uid: user.uid, fullName: name, photoURL: profile?.photoURL || '' },
        [notification.senderUid]: {
          uid: notification.senderUid,
          fullName: notification.senderName,
          username: notification.senderUsername,
          photoURL: notification.senderPhotoURL
        }
      }
    }
    setTab('chats')
    setSelected(conversation)
    setShowNotifications(false)
    if (!notification.read) {
      markNotificationRead(user.uid, notification.id).catch(err => {
        console.error('Unable to mark the notification as read:', err)
        setError(err.message || 'Impossible de marquer la notification comme lue.')
      })
    }
  }
  openNotificationRef.current = openNotification

  async function enableBrowserNotifications() {
    if (!('Notification' in window)) {
      setError('Les notifications du navigateur ne sont pas prises en charge sur cet appareil.')
      return
    }
    try {
      const permission = await Notification.requestPermission()
      if (permission === 'granted') setNotice('Les notifications du navigateur sont activées.')
      else if (permission === 'denied') setError('Autorisez les notifications PLEIADE TECH dans les paramètres du navigateur.')
    } catch (err) {
      console.error('Unable to request browser notification permission:', err)
      setError(err.message || 'Impossible d’activer les notifications du navigateur.')
    }
  }

  async function handleSendFriendRequest(person) {
    setError('')
    setBusy(true)
    try {
      await sendFriendRequest({ sender: profile, senderUid: user.uid, recipient: person })
      setFriendUsername('')
      setFriendResults([])
      setNotice(`Invitation envoyée à ${person.fullName || person.username}.`)
    } catch (err) {
      console.error('Unable to send friend request:', err)
      setError(err.message || 'Impossible d’envoyer cette invitation.')
    } finally {
      setBusy(false)
    }
  }

  async function handleFriendRequestAction(request, action) {
    setError('')
    setBusy(true)
    try {
      if (action === 'cancel') await cancelFriendRequest(request.id)
      else await respondToFriendRequest({ request, accept: action === 'accept' })
      if (action === 'accept') {
        const friend = request.fromUid === user.uid ? request.toUser : request.fromUser
        const conversationId = [user.uid, friend.uid].sort().join('_')
        setSelected(conversations.find(item => item.id === conversationId) || {
          id: conversationId,
          participantIds: [user.uid, friend.uid].sort(),
          participants: {
            [user.uid]: { uid: user.uid, fullName: name, username: profile.username, photoURL: profile.photoURL || '' },
            [friend.uid]: friend
          }
        })
        setTab('chats')
        setNotice(`Invitation acceptée. Vous pouvez maintenant discuter avec ${friend.fullName || friend.username}.`)
      } else {
        setNotice(action === 'decline' ? 'Invitation refusée.' : 'Invitation annulée.')
      }
    } catch (err) {
      console.error('Unable to update friend request:', err)
      setError(err.message || 'Impossible de mettre à jour cette invitation.')
    } finally {
      setBusy(false)
    }
  }

  function publishTyping(isTyping) {
    if (!activeConversation) return
    typingActiveRef.current = isTyping
    setTypingStatus(activeConversation.id, user.uid, isTyping)
      .catch(err => console.error('Unable to update typing status:', err))
  }

  function handleMessageChange(value) {
    setMessage(value)
    if (value.trim() && !typingActiveRef.current) publishTyping(true)
    if (!value.trim() && typingActiveRef.current) publishTyping(false)
    window.clearTimeout(typingTimerRef.current)
    if (value.trim()) {
      typingTimerRef.current = window.setTimeout(() => publishTyping(false), 2500)
    }
  }

  async function handleSendMessage(event) {
    event.preventDefault()
    if (!activeConversation || (!message.trim() && !attachmentFiles.length)) return
    setError('')
    setBusy(true)
    setUploadProgress(attachmentFiles.length ? 0 : null)
    publishTyping(false)
    try {
      await sendMessage({
        conversationId: activeConversation.id,
        senderId: user.uid,
        text: message,
        attachmentFiles: attachmentFiles.map(item => item.file),
        onProgress: progress => setUploadProgress(Math.round(progress * 100))
      })
      setMessage('')
      clearAttachmentFiles()
      setUploadProgress(null)
    } catch (err) {
      console.error('Unable to send message:', err)
      setError(err.message || 'Impossible d’envoyer le message.')
    } finally {
      setBusy(false)
    }
  }

  function selectAttachment(event) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    const choosingImages = files.every(file => file.type.startsWith('image/'))
    const existingImages = attachmentFiles.every(item => item.file.type.startsWith('image/'))
    if ((choosingImages && attachmentFiles.length && !existingImages) ||
      (!choosingImages && (attachmentFiles.length || files.length > 1))) {
      setError('Joignez plusieurs photos ensemble, ou un seul document ou message vocal.')
      return
    }
    if (choosingImages && attachmentFiles.length + files.length > 4) {
      setError('Vous pouvez joindre jusqu’à 4 photos par message.')
      return
    }
    const oversized = files.find(file =>
      file.size > (file.type.startsWith('image/') ? 50 * 1024 * 1024 : maxAttachmentSize)
    )
    if (oversized) {
      setError(oversized.type.startsWith('image/')
        ? 'Choisissez une image de moins de 50 Mo pour la compresser.'
        : 'Chaque document ou note vocale est limité à 15 Mo.')
      return
    }
    if (attachmentFiles.length && !choosingImages) {
      setError('Un document ou message vocal ne peut pas être mélangé avec des photos.')
      return
    }
    const newAttachments = files.map((file, index) => {
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : ''
      if (previewUrl) pendingAttachmentUrlsRef.current.add(previewUrl)
      return { id: `${Date.now()}-${index}-${Math.random()}`, file, previewUrl }
    })
    setError('')
    setAttachmentFiles(current => [...current, ...newAttachments])
  }

  async function startRecording() {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
        .find(type => MediaRecorder.isTypeSupported(type))
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      const chunks = []
      recorder.ondataavailable = event => {
        if (event.data.size) chunks.push(event.data)
      }
      recorder.onstop = () => {
        const type = recorder.mimeType || 'audio/webm'
        const extension = type.includes('mp4') ? 'm4a' : 'webm'
        setAttachmentFiles([{
          id: `${Date.now()}-voice`,
          file: new File(chunks, `note-vocale.${extension}`, { type }),
          previewUrl: ''
        }])
        stream.getTracks().forEach(track => track.stop())
        mediaStreamRef.current = null
      }
      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
      setRecordingSeconds(0)
      recordingTimerRef.current = window.setInterval(() => setRecordingSeconds(seconds => seconds + 1), 1000)
    } catch (err) {
      console.error('Unable to start voice recording:', err)
      setError('Autorisez l’accès au microphone pour enregistrer une note vocale.')
    }
  }

  function stopRecording() {
    window.clearInterval(recordingTimerRef.current)
    setRecording(false)
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  function editProfileField(field) {
    const value = field === 'fullName' ? profile?.fullName || ''
      : field === 'username' ? profile?.username || ''
        : field === 'birthDate' ? profile?.birthDate || ''
          : profile?.gender || 'Non précisé'
    setFieldDraft(value)
    setEditingField(field)
  }

  async function saveProfileChanges(patch, messageText) {
    setError('')
    setBusy(true)
    try {
      const savedProfile = await saveProfile({ ...profile, uid: user.uid, ...patch })
      onProfileChange(savedProfile)
      setNotice(messageText || 'Votre profil a été mis à jour.')
      return true
    } catch (err) {
      console.error('Unable to save profile:', err)
      setError(err.message || 'Impossible d’enregistrer le profil.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function handleSaveProfileField(event) {
    event.preventDefault()
    if (editingField === 'fullName' && !fieldDraft.trim()) {
      setError('Le nom complet ne peut pas être vide.')
      return
    }
    const value = editingField === 'username' ? fieldDraft.trim().toLowerCase() : fieldDraft.trim()
    if (editingField === 'username' && !/^[a-z0-9_]{3,20}$/.test(value)) {
      setError('Le pseudo doit contenir 3 à 20 lettres minuscules, chiffres ou tirets bas.')
      return
    }
    const saved = await saveProfileChanges({ [editingField]: value })
    if (saved) setEditingField('')
  }

  async function handleProfileImageChange(event, field) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setProfileImageBusy(true)
    setError('')
    try {
      const image = await compressImage(file, { maxBytes: 200 * 1024, maxDimension: field === 'photoURL' ? 800 : 1600 })
      await saveProfileChanges({ [field]: image.dataUrl }, field === 'photoURL'
        ? 'Votre photo de profil a été mise à jour.'
        : 'Votre photo de couverture a été mise à jour.')
    } catch (err) {
      console.error('Unable to update profile image:', err)
      setError(err.message || 'Impossible de préparer cette image.')
    } finally {
      setProfileImageBusy(false)
    }
  }

  async function resendVerification() {
    setError('')
    setNotice('')
    try {
      await sendEmailVerification(auth.currentUser)
      setNotice('Un nouveau lien de vérification vient d’être envoyé.')
    } catch (err) {
      console.error('Unable to send verification email:', err)
      setError(err.message || 'Impossible d’envoyer le lien de vérification.')
    }
  }

  async function resetPassword() {
    setError('')
    setNotice('')
    try {
      await setPersistence(auth, browserLocalPersistence)
      await sendPasswordResetEmail(auth, user.email)
      setNotice(`Un lien de réinitialisation a été envoyé à ${user.email}.`)
    } catch (err) {
      console.error('Unable to send password reset email:', err)
      setError(err.message || 'Impossible d’envoyer le lien de réinitialisation.')
    }
  }

  const nav = [
    { id: 'chats', label: 'Conversations', mobileLabel: 'Chats', icon: MessageCircle },
    { id: 'friends', label: 'Amis', icon: Users },
    { id: 'statuses', label: 'Statuts', icon: CircleDashed },
    { id: 'posts', label: 'Publications', mobileLabel: 'Posts', icon: Newspaper },
    { id: 'settings', label: 'Paramètres', mobileLabel: 'Réglages', icon: Settings }
  ]

  return <div className="app-shell">
    <aside className={`sidebar ${selected || tab === 'statuses' || tab === 'posts' ? 'mobile-hidden' : ''}`}>
      <header className="side-header">
        <div className="brand"><img src="/logo.png" alt="" /><div><b>PLEIADE</b><small>MESSENGERS</small></div></div>
        <button className="icon-button notification-toggle" onClick={() => setShowNotifications(value => !value)} aria-label="Notifications">
          <Bell />
          {notifications.some(item => !item.read) && <i>{notifications.filter(item => !item.read).length}</i>}
        </button>
        <button className="icon-button" onClick={() => setShowAdd(true)} aria-label="Ajouter un ami"><Plus /></button>
        {showNotifications && <section className="notification-panel" aria-label="Notifications">
          <header><b>Notifications</b>
            {typeof Notification !== 'undefined' && Notification.permission === 'default' &&
              <button onClick={enableBrowserNotifications}>Activer sur cet appareil</button>}
          </header>
          <div className="notification-list">
            {notifications.length
              ? notifications.map(item => <button className={`notification-item${item.read ? '' : ' unread'}`} key={item.id} onClick={() => openNotification(item)}>
                <Avatar person={{ fullName: item.senderName, photoURL: item.senderPhotoURL }} small onPhotoClick={openProfilePhoto} />
                <span><b>{item.senderName || 'Notification'}</b><small>{item.preview || 'Nouveau message'}</small></span>
                {!item.read && <i />}
              </button>)
              : <p>Aucune notification pour le moment.</p>}
          </div>
          {typeof Notification !== 'undefined' && Notification.permission === 'denied' &&
            <small className="notification-permission-note">Les notifications sont bloquées dans les paramètres du navigateur.</small>}
        </section>}
      </header>
      <div className="side-search"><Search size={18} /><input aria-label="Rechercher" placeholder="Rechercher" value={search} onChange={event => setSearch(event.target.value)} /></div>
      <nav className="side-nav">{nav.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => { setTab(item.id); setSelected(null) }}><item.icon size={19} />{item.label}</button>)}</nav>
      <div className="side-content">
        {tab === 'chats' && (contactsLoading
          ? <div className="empty-side">Chargement des conversations…</div>
          : filteredConversations.length
            ? <div className="contact-list">{filteredConversations.map(conversation => {
              const personId = conversation.participantIds?.find(uid => uid !== user.uid)
              const person = conversation.participants?.[personId]
              const last = conversation.lastMessage || 'Commencez une conversation'
              return <button className={`contact-item${selected?.id === conversation.id ? ' selected' : ''}`} key={conversation.id} onClick={() => setSelected(conversation)}>
                <span className="contact-avatar"><Avatar person={person} onPhotoClick={openProfilePhoto} />{isOnline(presenceByUser[personId]) && <i className="online-dot" />}</span>
                <span className="contact-copy"><b>{person?.fullName || person?.username || 'Utilisateur'}</b><small>{last}</small></span>
                <small className="contact-time">{formatTime(conversation.updatedAt)}</small>
              </button>
            })}</div>
            : <div className="empty-side"><MessageCircle /><b>Aucune conversation</b><span>Ajoutez un ami pour commencer à discuter.</span><button className="primary compact" onClick={() => setShowAdd(true)}>Ajouter un ami</button></div>)}
        {tab === 'friends' && (contactsLoading
          ? <div className="empty-side">Chargement des amis…</div>
          : <div className="friend-sections">
            {incomingRequests.length > 0 && <section>
              <h3>Invitations reçues</h3>
              {incomingRequests.map(request => <div className="friend-request-item" key={request.id}>
                <Avatar person={request.fromUser} onPhotoClick={openProfilePhoto} />
                <div className="friend-request-copy"><b>{request.fromUser.fullName || request.fromUser.username}</b><small>@{request.fromUser.username}</small></div>
                <button className="friend-action accept" disabled={busy} onClick={() => handleFriendRequestAction(request, 'accept')} aria-label="Accepter l’invitation"><Check size={17} /></button>
                <button className="friend-action decline" disabled={busy} onClick={() => handleFriendRequestAction(request, 'decline')} aria-label="Refuser l’invitation"><X size={17} /></button>
              </div>)}
            </section>}
            {acceptedFriendshipsToFinish.length > 0 && <section>
              <h3>Finaliser les nouvelles conversations</h3>
              {acceptedFriendshipsToFinish.map(request => {
                const person = request.fromUid === user.uid ? request.toUser : request.fromUser
                return <div className="friend-request-item" key={request.id}>
                  <Avatar person={person} onPhotoClick={openProfilePhoto} />
                  <div className="friend-request-copy"><b>{person.fullName || person.username}</b><small>Invitation acceptée</small></div>
                  <button className="friend-cancel" disabled={busy} onClick={() => handleFriendRequestAction(request, 'accept')}>Ouvrir</button>
                </div>
              })}
            </section>}
            {outgoingRequests.length > 0 && <section>
              <h3>Invitations envoyées</h3>
              {outgoingRequests.map(request => <div className="friend-request-item" key={request.id}>
                <Avatar person={request.toUser} onPhotoClick={openProfilePhoto} />
                <div className="friend-request-copy"><b>{request.toUser.fullName || request.toUser.username}</b><small>@{request.toUser.username} · En attente</small></div>
                <button className="friend-cancel" disabled={busy} onClick={() => handleFriendRequestAction(request, 'cancel')}>Annuler</button>
              </div>)}
            </section>}
            <section>
              <h3>Vos amis</h3>
              {filteredFriends.length
                ? <div className="contact-list">{filteredFriends.map(friend => <button className="contact-item" key={friend.uid} onClick={() => openFriend(friend)}>
                  <span className="contact-avatar"><Avatar person={friend} onPhotoClick={openProfilePhoto} />{isOnline(presenceByUser[friend.uid]) && <i className="online-dot" />}</span>
                  <span className="contact-copy"><b>{friend.fullName || friend.username || 'Utilisateur'}</b><small>{formatLastSeen(presenceByUser[friend.uid])} · @{friend.username}</small></span>
                </button>)}</div>
                : <div className="empty-side"><Users /><b>Pas encore d’amis</b><span>Recherchez des comptes PLEIADE TECH pour envoyer une invitation.</span><button className="primary compact" onClick={() => setShowAdd(true)}>Trouver des amis</button></div>}
            </section>
          </div>)}
        {tab === 'settings' && <div className="settings-list">
          <section className="settings-profile-card">
            <div className="settings-cover" style={profile?.coverPhotoURL ? { backgroundImage: `url("${profile.coverPhotoURL}")` } : undefined}>
              <button type="button" className="settings-cover-edit" onClick={() => coverPhotoInputRef.current?.click()} aria-label="Modifier la photo de couverture">
                <Camera size={17} />
              </button>
            </div>
            <button type="button" className="settings-avatar-edit" onClick={() => setShowProfile(true)} aria-label="Modifier la photo de profil et les informations">
              {profile?.photoURL ? <img src={profile.photoURL} alt="" /> : <UserRound />}
              <span><Camera size={15} /></span>
            </button>
            <div className="settings-profile-identity"><b>{name}</b><small>@{profile?.username || 'pseudo'}</small></div>
          </section>
          <input ref={coverPhotoInputRef} className="settings-hidden-input" type="file" accept="image/*" onChange={event => handleProfileImageChange(event, 'coverPhotoURL')} />
          <h3 className="settings-section-title">Informations personnelles</h3>
          <button className="settings-info-row" onClick={() => editProfileField('fullName')}>
            <UserRound /><span>Nom</span><strong>{profile?.fullName || 'Ajouter un nom'}</strong><ChevronRight />
          </button>
          <button className="settings-info-row" onClick={() => editProfileField('username')}>
            <AtSign /><span>Pseudo</span><strong>@{profile?.username || 'Ajouter un pseudo'}</strong><ChevronRight />
          </button>
          <button className="settings-info-row" onClick={() => editProfileField('birthDate')}>
            <CalendarDays /><span>Date de naissance</span><strong>{profile?.birthDate || 'Ajouter'}</strong><ChevronRight />
          </button>
          <button className="settings-info-row" onClick={() => editProfileField('gender')}>
            <Users /><span>Genre</span><strong>{profile?.gender || 'Non précisé'}</strong><ChevronRight />
          </button>
          <div className="settings-info-row settings-readonly-row"><AtSign /><span>E-mail</span><strong>{user.email}</strong></div>
          <h3 className="settings-section-title">Sécurité</h3>
          {user.emailVerified
            ? <p className="security-status">Adresse e-mail vérifiée</p>
            : <button className="settings-action-row" onClick={resendVerification}>Renvoyer le lien de vérification</button>}
          <button className="settings-action-row" onClick={resetPassword}>Réinitialiser mon mot de passe</button>
          <section className="blocked-accounts-section">
            <h3><ShieldBan size={17} /> Comptes bloqués</h3>
            <p>Un compte bloqué ne peut plus vous inviter ni vous envoyer de messages. Ses publications et statuts sont masqués dans l’application.</p>
            {blockingUsers.length > 0 && <small className="block-search-hint">Certains comptes ne sont pas disponibles pour vous.</small>}
            <form className="block-search-form" onSubmit={event => { event.preventDefault(); searchAccountToBlock() }}>
              <input aria-label="Pseudo du compte à bloquer" value={blockSearch} onChange={event => setBlockSearch(event.target.value)} placeholder="Rechercher un pseudo…" />
              <button type="submit" disabled={blockSearchBusy}><Search size={17} /></button>
            </form>
            {blockSearchBusy && <small className="block-search-hint">Recherche…</small>}
            {blockResults.map(person => <div className="blocked-account-row" key={person.uid}>
              <Avatar person={person} />
              <span><b>{person.fullName || person.username}</b><small>@{person.username}</small></span>
              <button type="button" disabled={busy} onClick={() => setBlockingTarget(person)}>Bloquer</button>
            </div>)}
            {blockedUsers.map(person => <div className="blocked-account-row" key={person.uid}>
              <Avatar person={person} />
              <span><b>{person.fullName || person.username}</b><small>@{person.username}</small></span>
              <button type="button" disabled={busy} onClick={() => handleUnblockAccount(person)}>Débloquer</button>
            </div>)}
            {!blockedUsers.length && !blockResults.length && <small className="block-search-hint">Aucun compte bloqué.</small>}
          </section>
          <button onClick={onLogout} className="logout"><LogOut size={17} /> Se déconnecter</button>
        </div>}
      </div>
      <footer className="side-user"><Avatar person={profile} small onPhotoClick={openProfilePhoto} /><span>{name}</span><button onClick={onLogout} title="Déconnexion"><LogOut size={17} /></button></footer>
    </aside>
    <main className={`chat-panel ${selected || tab === 'statuses' || tab === 'posts' ? 'mobile-visible' : ''}`}>
      {tab === 'statuses' && !activeConversation ? <Statuses user={user} profile={profile} blockedUserIds={blockedUidList} />
        : tab === 'posts' && !activeConversation ? <Posts user={user} profile={profile} blockedUserIds={blockedUidList} />
        : activeConversation ? <>
        <header className="chat-header">
          <button className="icon-button mobile-back" onClick={() => setSelected(null)} aria-label="Retour"><ArrowLeft /></button>
          <span className="contact-avatar"><Avatar person={otherParticipant} onPhotoClick={openProfilePhoto} /><i className={`online-dot${isOnline(presenceByUser[otherUserId]) ? '' : ' offline'}`} /></span>
          <div><b>{otherParticipant?.fullName || otherParticipant?.username || 'Conversation'}</b><small>{otherIsTyping ? 'En train d’écrire…' : formatLastSeen(presenceByUser[otherUserId])}</small></div>
        </header>
        <div className="message-list">
          {messages.length ? messages.map((item, index) => {
            const previousDate = index ? formatDate(messages[index - 1].createdAt) : ''
            const currentDate = formatDate(item.createdAt)
            const sentByMe = item.senderId === user.uid
            const sender = sentByMe ? profile : otherParticipant
            const readByRecipient = item.readBy?.includes(otherUserId)
            const recipientOnline = isOnline(presenceByUser[otherUserId])
            return <div key={item.id}>
              {currentDate && currentDate !== previousDate && <div className="message-date"><span>{currentDate}</span></div>}
              <div className={`message-row${sentByMe ? ' own' : ''}`}>
                <Avatar person={sender} small onPhotoClick={openProfilePhoto} />
                <div className="message-bubble">
                  {(item.attachments || (item.attachment ? [item.attachment] : [])).map((attachment, attachmentIndex) =>
                    <MessageAttachment key={`${item.id}-${attachmentIndex}`} attachment={attachment} onImageClick={openMessageImage} />
                  )}
                  {item.text && <p>{item.text}</p>}
                  <small>{formatTime(item.createdAt)}{sentByMe && <span
                    className={`message-receipt${readByRecipient ? ' read' : ''}`}
                    title={readByRecipient ? 'Lu' : recipientOnline ? 'Envoyé, pas encore lu' : 'Envoyé'}
                  >{readByRecipient || recipientOnline ? '✓✓' : '✓'}</span>}</small>
                </div>
              </div>
            </div>
          }) : <div className="chat-empty"><MessageCircle /><p>Votre conversation commence ici.</p></div>}
          <div ref={messageEndRef} />
        </div>
        {attachmentFiles.length > 0 && <div className="attachment-pending">
          {attachmentFiles.map(item => <div className="attachment-pending-item" key={item.id}>
            {item.previewUrl && <img src={item.previewUrl} alt="" />}
            <span>{item.file.name} · {(item.file.size / (1024 * 1024)).toFixed(2)} Mo</span>
            <button type="button" onClick={() => removeAttachment(item.id)} aria-label={`Retirer ${item.file.name}`}><X size={17} /></button>
          </div>)}
        </div>}
        {uploadProgress !== null && <div className="upload-progress"><span style={{ width: `${uploadProgress}%` }} /></div>}
        <form className="message-compose" onSubmit={handleSendMessage}>
          <label className="compose-icon" title="Envoyer jusqu’à 4 photos"><ImagePlus size={20} /><input type="file" accept="image/*" multiple onChange={selectAttachment} /></label>
          <label className="compose-icon" title="Envoyer un document"><Paperclip size={19} /><input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,application/pdf" onChange={selectAttachment} /></label>
          <input aria-label="Message" maxLength={5000} placeholder="Écrire un message…" value={message} onChange={event => handleMessageChange(event.target.value)} />
          {recording
            ? <button className="record-button recording" type="button" onClick={stopRecording} aria-label="Arrêter l’enregistrement">● {recordingSeconds}s</button>
            : !message.trim() && !attachmentFiles.length
              ? <button className="compose-icon" type="button" onClick={startRecording} aria-label="Enregistrer une note vocale"><Mic size={20} /></button>
              : <button className="send-button" disabled={busy} aria-label="Envoyer"><Send size={19} /></button>}
        </form>
      </> : <div className="welcome"><div className="welcome-mark"><MessageCircle /></div><h2>Bienvenue sur Pleiade Messengers</h2><p>Une messagerie simple, privée et facile à utiliser.</p><span>Sélectionnez une conversation ou ajoutez un ami.</span></div>}
    </main>
    <nav className={`mobile-tab-bar${selected ? ' conversation-open' : ''}`} aria-label="Navigation principale">
      {nav.map(item => <button
        key={item.id}
        type="button"
        className={tab === item.id ? 'active' : ''}
        aria-current={tab === item.id ? 'page' : undefined}
        onClick={() => { setTab(item.id); setSelected(null) }}
      >
        <item.icon size={20} />
        <span>{item.mobileLabel || item.label}</span>
      </button>)}
    </nav>

    {showAdd && <div className="modal-backdrop" onClick={() => setShowAdd(false)}>
      <section className="modal friend-search-modal" onClick={event => event.stopPropagation()}>
        <button type="button" className="modal-close" onClick={() => setShowAdd(false)} aria-label="Fermer">×</button>
        <div className="modal-icon"><UserPlus /></div><h2>Trouver des amis</h2>
        <p>Recherchez un compte PLEIADE TECH par son pseudo. Une invitation sera envoyée pour accord.</p>
        <label htmlFor="friend-search">Pseudo</label>
        <input id="friend-search" autoComplete="off" value={friendUsername} onChange={event => setFriendUsername(event.target.value)} placeholder="Commencez à écrire un pseudo…" />
        <div className="friend-search-results">
          {friendSearchBusy && <small>Recherche…</small>}
          {!friendSearchBusy && friendUsername.trim().replace(/^@/, '').length >= 2 && friendResults.length === 0 && <small>Aucun compte trouvé pour ce pseudo.</small>}
          {friendResults.map(person => {
            const existingFriend = friends.some(friend => friend.uid === person.uid)
            const isBlocked = blockedUidSet.has(person.uid)
            const existingRequest = friendRequests.find(request =>
              request.status === 'pending' &&
              ((request.fromUid === user.uid && request.toUid === person.uid) ||
               (request.toUid === user.uid && request.fromUid === person.uid))
            )
            const requestReceived = existingRequest?.toUid === user.uid
            return <div className="friend-search-result" key={person.uid}>
              <Avatar person={person} />
              <div className="friend-request-copy"><b>{person.fullName || person.username}</b><small>@{person.username}</small></div>
              {isBlocked
                ? <span className="friend-result-status">Indisponible</span>
                : existingFriend
                ? <span className="friend-result-status">Ami</span>
                : existingRequest
                  ? <span className="friend-result-status">{requestReceived ? 'Invitation reçue' : 'Envoyée'}</span>
                  : <button className="friend-add-button" disabled={busy} onClick={() => handleSendFriendRequest(person)}><UserPlus size={16} /> Ajouter</button>}
            </div>
          })}
        </div>
      </section>
    </div>}

    {showProfile && <div className="modal-backdrop" onClick={() => setShowProfile(false)}>
      <section className="modal profile-editor-modal" onClick={event => event.stopPropagation()}>
        <button type="button" className="modal-close" onClick={() => setShowProfile(false)} aria-label="Fermer">×</button>
        <h2>Modifier le profil</h2>
        <p>Personnalisez votre photo et vos informations personnelles.</p>
        <div className="profile-editor-cover" style={profile?.coverPhotoURL ? { backgroundImage: `url("${profile.coverPhotoURL}")` } : undefined}>
          <button type="button" disabled={profileImageBusy} onClick={() => coverPhotoInputRef.current?.click()} aria-label="Modifier la couverture"><Camera /></button>
        </div>
        <button type="button" className="profile-editor-avatar" disabled={profileImageBusy} onClick={() => profilePhotoInputRef.current?.click()} aria-label="Modifier la photo de profil">
          {profile?.photoURL ? <img src={profile.photoURL} alt="" /> : <UserRound />}
          <span><Camera size={15} /></span>
        </button>
        {profileImageBusy && <small className="field-hint">Compression et enregistrement de l’image…</small>}
        <div className="profile-editor-fields">
          <button className="settings-info-row" onClick={() => editProfileField('fullName')}><UserRound /><span>Nom</span><strong>{profile?.fullName}</strong><ChevronRight /></button>
          <button className="settings-info-row" onClick={() => editProfileField('username')}><AtSign /><span>Pseudo</span><strong>@{profile?.username}</strong><ChevronRight /></button>
          <button className="settings-info-row" onClick={() => editProfileField('birthDate')}><CalendarDays /><span>Date de naissance</span><strong>{profile?.birthDate || 'Ajouter'}</strong><ChevronRight /></button>
          <button className="settings-info-row" onClick={() => editProfileField('gender')}><Users /><span>Genre</span><strong>{profile?.gender || 'Non précisé'}</strong><ChevronRight /></button>
        </div>
      </section>
    </div>}
    {editingField && <div className="modal-backdrop settings-field-backdrop" onClick={() => setEditingField('')}>
      <form className="modal settings-field-modal" onSubmit={handleSaveProfileField} onClick={event => event.stopPropagation()}>
        <button type="button" className="modal-close" onClick={() => setEditingField('')} aria-label="Fermer">×</button>
        <h2>{editingField === 'fullName' ? 'Modifier le nom'
          : editingField === 'username' ? 'Modifier le pseudo'
            : editingField === 'birthDate' ? 'Modifier la date de naissance' : 'Modifier le genre'}</h2>
        {editingField === 'gender'
          ? <select autoFocus value={fieldDraft} onChange={event => setFieldDraft(event.target.value)}>
            <option>Non précisé</option><option>Femme</option><option>Homme</option><option>Autre</option>
          </select>
          : <input autoFocus={true} required={editingField !== 'birthDate'} maxLength={editingField === 'fullName' ? 100 : 20}
            minLength={editingField === 'username' ? 3 : undefined}
            type={editingField === 'birthDate' ? 'date' : 'text'}
            value={fieldDraft}
            onChange={event => setFieldDraft(editingField === 'username' ? event.target.value.toLowerCase() : event.target.value)}
            placeholder={editingField === 'username' ? 'votre_pseudo' : 'Saisissez une valeur'} />}
        {editingField === 'username' && <small className="field-hint">3 à 20 caractères : lettres minuscules, chiffres et tiret bas.</small>}
        <button className="primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
      </form>
    </div>}
    {blockingTarget && <ConfirmDialog
      title={`Bloquer ${blockingTarget.fullName || blockingTarget.username} ?`}
      message="Cette personne sera retirée de vos amis et ne pourra plus vous inviter ni vous écrire. Ses publications et statuts seront masqués pour vous."
      confirmLabel="Bloquer"
      onCancel={() => setBlockingTarget(null)}
      onConfirm={handleBlockAccount}
    />}
    <input ref={profilePhotoInputRef} className="settings-hidden-input" type="file" accept="image/*" onChange={event => handleProfileImageChange(event, 'photoURL')} />
    {profilePhoto && <div className="image-viewer" role="dialog" aria-modal="true" aria-label="Photo agrandie" onClick={() => setProfilePhoto('')}>
      <button className="image-viewer-close" type="button" aria-label="Fermer" onClick={() => setProfilePhoto('')}><X /></button>
      <a className="image-download" href={profilePhoto} download="photo-pleiade.jpg" aria-label="Télécharger la photo" onClick={event => event.stopPropagation()}><Download /></a>
      <img
        className={imageZoomed ? 'zoomed' : ''}
        src={profilePhoto}
        alt="Photo agrandie"
        onClick={event => {
          event.stopPropagation()
          setImageZoomed(value => !value)
        }}
      />
    </div>}
    <div className="toast-stack">
      <Toast message={error} onClose={dismissError} />
      <Toast message={notice} type="success" onClose={dismissNotice} />
    </div>
  </div>
}
