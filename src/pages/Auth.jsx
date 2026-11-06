import { useState } from 'react'
import {
  browserLocalPersistence, createUserWithEmailAndPassword, EmailAuthProvider,
  linkWithCredential, sendEmailVerification, setPersistence,
  sendPasswordResetEmail, signInWithEmailAndPassword, updateProfile
} from 'firebase/auth'
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ChevronLeft, ShieldCheck, UserRound } from 'lucide-react'
import { auth, db, functions } from '../services/firebase'
import { compressImage } from '../services/images'

export default function Auth({ user = null, onProfileComplete, profileError = '' }) {
  const [mode, setMode] = useState(user ? 'complete' : 'signup')
  const [fullName, setFullName] = useState(user?.displayName || '')
  const [username, setUsername] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [gender, setGender] = useState('Non précisé')
  const [email, setEmail] = useState(user?.email || '')
  const [password, setPassword] = useState('')
  const [photo, setPhoto] = useState(null)
  const [photoPreview, setPhotoPreview] = useState('')
  const [photoBusy, setPhotoBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [resetBusy, setResetBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [accountStep, setAccountStep] = useState(0)
  const navigate = useNavigate()
  const currentUser = user || auth.currentUser
  const screenMode = user ? 'complete' : mode
  const accountSteps = screenMode === 'complete' && user?.email
    ? ['name', 'details', 'profile']
    : ['name', ...(!user || !user.email ? ['account'] : []), 'details', 'profile']
  const currentStep = accountSteps[accountStep] || accountSteps[0]
  const stepTitles = {
    name: 'Comment vous appelez-vous ?',
    account: 'Vos informations de connexion',
    details: 'Quelques informations sur vous',
    profile: 'Choisissez votre pseudo'
  }

  async function completeProfile(account, createDocument = false) {
    const safeUsername = username.trim().toLowerCase()
    if (!/^[a-z0-9_]{3,20}$/.test(safeUsername)) {
      throw new Error('Le pseudo doit contenir 3 à 20 lettres minuscules, chiffres ou tirets bas.')
    }

    const photoURL = photo?.dataUrl || ''

    const profile = {
      username: safeUsername,
      fullName: fullName.trim(),
      birthDate,
      gender,
      photoURL,
      coverPhotoURL: ''
    }
    if (createDocument) {
      const batch = writeBatch(db)
      batch.set(doc(db, 'usernames', safeUsername), {
        uid: account.uid,
        username: profile.username,
        fullName: profile.fullName,
        photoURL: profile.photoURL,
        coverPhotoURL: profile.coverPhotoURL
      })
      batch.set(doc(db, 'users', account.uid), {
        ...profile,
        email: account.email,
        updatedAt: serverTimestamp()
      })
      await batch.commit()
    } else {
      const createProfile = httpsCallable(functions, 'createUserProfile')
      await createProfile(profile)
    }
    onProfileComplete({ ...profile, email: account.email })
    navigate('/', { replace: true })
  }

  async function submit(event) {
    event.preventDefault()
    if (screenMode !== 'login' && accountStep < accountSteps.length - 1) {
      setError('')
      setNotice('')
      setAccountStep(step => step + 1)
      return
    }
    setError('')
    setNotice('')
    setBusy(true)
    try {
      if (screenMode === 'login') {
        await setPersistence(auth, browserLocalPersistence)
        const credential = await signInWithEmailAndPassword(auth, email.trim(), password)
        navigate(credential.user ? '/' : '/connexion', { replace: true })
        return
      }

      async function resetPassword() {
        setError('')
        setNotice('')
        setResetBusy(true)
        try {
          if (!email.trim()) throw new Error('Saisissez votre adresse e-mail.')
          await sendPasswordResetEmail(auth, email.trim())
          setNotice('Le lien de réinitialisation a été envoyé à votre adresse e-mail.')
        } catch (err) {
          console.error('Unable to request a password reset:', err)
          setError(err.message || 'Impossible d’envoyer le lien de réinitialisation.')
        } finally {
          setResetBusy(false)
        }
      }

      if (!currentUser) {
        await setPersistence(auth, browserLocalPersistence)
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password)
        if (fullName.trim()) await updateProfile(credential.user, { displayName: fullName.trim() })
        sendEmailVerification(credential.user).catch(error => {
          console.error('Unable to send verification email:', error)
        })
        await completeProfile(credential.user, true)
      } else if (!currentUser.email) {
        await setPersistence(auth, browserLocalPersistence)
        const credential = EmailAuthProvider.credential(email.trim(), password)
        const linked = await linkWithCredential(currentUser, credential)
        sendEmailVerification(linked.user).catch(error => {
          console.error('Unable to send verification email:', error)
        })
        await completeProfile(linked.user)
      } else {
        await completeProfile(currentUser, Boolean(user?.email))
      }
    } catch (err) {
      console.error('Authentication or profile setup failed:', err)
      setError(err.message || 'Impossible de terminer cette opération.')
    } finally {
      setBusy(false)
    }
  }

  async function resetPassword() {
    setError('')
    setNotice('')
    setResetBusy(true)
    try {
      if (!email.trim()) throw new Error('Saisissez votre adresse e-mail.')
      await sendPasswordResetEmail(auth, email.trim())
      setNotice('Le lien de réinitialisation a été envoyé à votre adresse e-mail.')
    } catch (err) {
      console.error('Unable to request a password reset:', err)
      setError(err.message || 'Impossible d’envoyer le lien de réinitialisation.')
    } finally {
      setResetBusy(false)
    }
  }

  return <main className="auth-shell">
    <section className="auth-card">
      <img className="brand-logo" src="/logo.png" alt="PLEIADE TECH" />
      <p className="eyebrow">PLEIADE MESSENGERS</p>
      <h1>{screenMode === 'login' ? 'Connexion' : screenMode === 'complete' ? 'Terminer mon profil' : stepTitles[currentStep]}</h1>
      <p className="muted">{screenMode === 'login'
        ? 'Retrouvez vos conversations et vos amis.'
        : screenMode === 'complete'
          ? 'Complétez votre profil étape par étape.'
          : 'Créez votre compte sans numéro de téléphone ni code SMS.'}</p>

      <form onSubmit={submit}>
        {screenMode !== 'login' && <div className="signup-progress" aria-label={`Étape ${accountStep + 1} sur ${accountSteps.length}`}>
          <div className="signup-progress-track"><span style={{ width: `${((accountStep + 1) / accountSteps.length) * 100}%` }} /></div>
          <small>Étape {accountStep + 1} sur {accountSteps.length}</small>
        </div>}
        {screenMode !== 'login' && currentStep === 'name' && <>
          <label>Nom complet</label>
          <input required maxLength={100} autoComplete="name" value={fullName} onChange={event => setFullName(event.target.value)} placeholder="Votre prénom et nom" />
        </>}
        {screenMode !== 'login' && currentStep === 'account' && <>
          <label>Adresse e-mail</label>
          <input required type="email" autoComplete="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="nom@exemple.com" />
          <label>Mot de passe</label>
          <input required type="password" autoComplete="new-password" minLength={8} value={password} onChange={event => setPassword(event.target.value)} placeholder="8 caractères minimum" />
        </>}
        {screenMode !== 'login' && currentStep === 'details' && <>
          <label>Date de naissance</label>
          <input required type="date" autoComplete="bday" value={birthDate} onChange={event => setBirthDate(event.target.value)} />
          <label>Genre (facultatif)</label>
          <select value={gender} onChange={event => setGender(event.target.value)}><option>Non précisé</option><option>Femme</option><option>Homme</option><option>Autre</option></select>
        </>}
        {screenMode !== 'login' && currentStep === 'profile' && <>
          <label>Pseudo public</label>
          <input required minLength={3} maxLength={20} autoComplete="username" pattern="[A-Za-z0-9_]{3,20}" value={username} onChange={event => setUsername(event.target.value)} placeholder="exemple_123" />
          <small className="field-hint">Les amis pourront vous retrouver avec ce pseudo.</small>
          <div className="photo-picker">
            <label className="photo-circle">{photoPreview ? <img src={photoPreview} alt="Aperçu du profil" /> : <UserRound size={30} />}<input type="file" accept="image/*" disabled={photoBusy} onChange={async event => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              setPhotoBusy(true)
              setError('')
              try {
                const compressed = await compressImage(file, { maxBytes: 220 * 1024, maxDimension: 800 })
                setPhoto(compressed)
                setPhotoPreview(compressed.dataUrl)
              } catch (err) {
                setError(err.message || 'Impossible de préparer cette photo.')
              } finally {
                setPhotoBusy(false)
              }
            }} /></label>
            <span>{photoBusy ? 'Compression de la photo…' : 'Photo de profil facultative · compressée avant enregistrement'}</span>
          </div>
        </>}
        {screenMode === 'login' && <>
          <label>Adresse e-mail</label>
          <input required type="email" autoComplete="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="nom@exemple.com" />
          <label>Mot de passe</label>
          <input required type="password" autoComplete="current-password" minLength={8} value={password} onChange={event => setPassword(event.target.value)} placeholder="Votre mot de passe" />
        </>}
        <div className={screenMode !== 'login' && accountStep > 0 ? 'signup-actions' : undefined}>
          {screenMode !== 'login' && accountStep > 0 && <button className="back-link signup-back" type="button" onClick={() => {
            setError('')
            setAccountStep(step => step - 1)
          }}><ChevronLeft size={17} /> Retour</button>}
          <button className="primary" disabled={busy || photoBusy}>
            {busy ? 'Veuillez patienter…' : screenMode === 'login' ? 'Se connecter' : screenMode === 'complete'
              ? accountStep === accountSteps.length - 1 ? 'Terminer mon profil' : 'Suivant'
              : accountStep === accountSteps.length - 1 ? 'Créer mon compte' : 'Suivant'}
            {!busy && (screenMode === 'login' || accountStep === accountSteps.length - 1
              ? <ShieldCheck size={18} />
              : <ArrowRight size={18} />)}
          </button>
        </div>
      </form>

      {notice && <p className="success" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {profileError && <p className="error" role="alert">{profileError}</p>}
      {screenMode === 'login' && <button className="back-link" disabled={resetBusy} onClick={resetPassword}>
        {resetBusy ? 'Envoi…' : 'Mot de passe oublié ?'}
      </button>}
      {!user && <button className="back-link" onClick={() => {
        setError('')
        setNotice('')
        setMode(screenMode === 'login' ? 'signup' : 'login')
        setAccountStep(0)
      }}>{screenMode === 'login' ? 'Créer un nouveau compte' : 'J’ai déjà un compte'}</button>}
      <small className="auth-foot">Votre session est conservée sur cet appareil jusqu’à votre déconnexion.</small>
    </section>
  </main>
}
