import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { auth, firebaseConfigured } from './services/firebase'
import { getProfile } from './services/profile'
import { updatePresence } from './services/messages'
import Auth from './pages/Auth'
import Messenger from './pages/Messenger'

export default function App() {
  if (!firebaseConfigured) {
    return <FirebaseSetup />
  }

  return <AuthenticatedApp />
}

function FirebaseSetup() {
  return <main className="setup-shell">
    <section className="setup-card">
      <img className="brand-logo" src="/logo.png" alt="PLEIADE TECH" />
      <p className="eyebrow">CONFIGURATION REQUISE</p>
      <h1>Connectez votre projet Firebase</h1>
      <p className="setup-copy">L’interface ne peut pas démarrer sans les paramètres Firebase. Créez un fichier <code>.env</code> à la racine du projet en vous basant sur <code>.env.example</code>, puis remplacez les valeurs par celles de votre application Firebase.</p>
      <ol>
        <li>Dans Firebase Console, activez E-mail/Mot de passe dans Authentication et créez Firestore et Storage.</li>
        <li>Enregistrez les valeurs Firebase dans <code>.env</code>.</li>
        <li>Redémarrez le serveur avec <code>npm run dev</code>.</li>
      </ol>
      <p className="setup-note">Ne partagez pas votre fichier <code>.env</code>. Les fonctions de messagerie nécessitent votre propre projet Firebase.</p>
    </section>
  </main>
}

function AuthenticatedApp() {
  const [user, setUser] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [profileError, setProfileError] = useState('')
  const [profileLoading, setProfileLoading] = useState(true)
  useEffect(() => {
    let active = true
    const unsubscribe = onAuthStateChanged(auth, current => {
      if (!active) return
      setUser(current)
      setProfileError('')
      setProfileLoading(Boolean(current))
      if (!current) {
        setProfile(null)
        setProfileLoading(false)
        return
      }
      getProfile(current.uid)
        .then(currentProfile => {
          if (!active) return
          setProfile(currentProfile)
          setProfileLoading(false)
        })
        .catch(error => {
          if (!active) return
          console.error('Unable to load the user profile:', error)
          const code = error.code ? ` (${error.code})` : ''
          setProfileError(`Le profil n’a pas pu être chargé${code}. Vérifiez les règles Firestore et déployez firestore.rules.`)
          setProfileLoading(false)
        })
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  if (user === undefined) return <div className="loading-screen"><img src="/logo.png" alt="" /><span>Chargement de Pleiade Messengers…</span></div>
  const profileSetup = user && (!profile || !user.email)
  return <Routes>
    <Route path="/connexion" element={user && profile && user.email
      ? <Navigate to="/" replace />
      : <Auth user={profileSetup ? user : null} profileError={profileError} onProfileComplete={setProfile} />} />
    <Route path="/*" element={user && profileLoading && user.emailVerified
      ? <div className="loading-screen"><img src="/logo.png" alt="" /><span>Chargement du profil…</span></div>
      : user && profile && user.email ? <Messenger
      user={user}
      profile={profile}
      profileError={profileError}
      onProfileChange={setProfile}
      onLogout={async () => {
        await updatePresence(user.uid, false)
        await signOut(auth)
      }}
    /> : profileSetup
      ? <Auth user={user} profileError={profileError} onProfileComplete={setProfile} />
      : <Navigate to="/connexion" replace />} />
  </Routes>
}
