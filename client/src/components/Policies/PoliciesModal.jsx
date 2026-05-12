import React, { useEffect } from 'react'

const TermsContent = () => (
  <div>
    <h3 className="text-sm font-semibold">Quick Summary</h3>
    <p>
      ChatApp is for personal messaging. By using it, you agree to keep your account secure,
      share only content you have rights to, and follow the rules below.
    </p>

    <h4 className="mt-4 font-medium">Your Account</h4>
    <p>
      Keep your password private and tell us right away if you think someone else accessed
      your account.
    </p>

    <h4 className="mt-4 font-medium">Use of the Service</h4>
    <p>
      Do not use ChatApp to harass, scam, impersonate, or upload illegal or harmful
      content.
    </p>

    <h4 className="mt-4 font-medium">Changes</h4>
    <p>
      We may update these Terms when needed. If you keep using ChatApp after changes are
      posted, that means you accept them.
    </p>
  </div>
)

const PrivacyContent = () => (
  <div>
    <h3 className="text-sm font-semibold">Privacy Summary</h3>
    <p>
      We only collect the data needed to run ChatApp, like your email, username, profile
      details, and the messages you send.
    </p>

    <h4 className="mt-4 font-medium">How We Use It</h4>
    <p>
      Your data is used to sign you in, deliver messages, support basic features, and keep
      the app working.
    </p>

    <h4 className="mt-4 font-medium">Storage and Sharing</h4>
    <p>
      We use trusted providers for storage and email delivery. We do not sell your personal
      data.
    </p>

    <h4 className="mt-4 font-medium">Your Choices</h4>
    <p>
      You can request access, correction, or deletion of your data by contacting support.
    </p>
  </div>
)

const PoliciesModal = ({ open = false, onClose = () => {}, initialTab = 'terms', onAccept = () => {} }) => {
  const [tab, setTab] = React.useState(initialTab)
  const POLICY_VERSION = '1.0.0'

  useEffect(() => {
    setTab(initialTab)
  }, [initialTab])

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-2xl ring-1 ring-black/10 overflow-hidden transform transition-transform duration-150">
          <header className="flex items-center justify-between bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 px-4 py-4">
          <div className="flex items-center gap-3">
            <button onClick={onClose} aria-label="Back" className="p-1 rounded hover:bg-white/10">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white/90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h2 className="text-xl md:text-2xl font-semibold text-white">Policies</h2>
          </div>
          <div className="flex items-center gap-2">
            <nav className="flex gap-1">
              <button onClick={() => setTab('terms')} className={`px-3 py-1 rounded ${tab === 'terms' ? 'bg-white text-blue-600 font-semibold' : 'text-white/90 hover:bg-white/10'}`}>Terms</button>
              <button onClick={() => setTab('privacy')} className={`px-3 py-1 rounded ${tab === 'privacy' ? 'bg-white text-blue-600 font-semibold' : 'text-white/90 hover:bg-white/10'}`}>Privacy</button>
            </nav>
            <button onClick={onClose} className="text-sm text-white/90 hover:text-white">Close</button>
          </div>
        </header>

          <div className="max-h-[70vh] overflow-y-auto p-6 prose prose-slate text-base leading-relaxed antialiased">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <p className="text-xs text-slate-500">Version {POLICY_VERSION} — Last updated May 2026</p>
            </div>
            {/* full-page link intentionally removed per inline-modal UX requirement */}
          </div>

          <div className="mb-4">
            <div className="text-sm font-medium text-slate-700 mb-2">Quick jump</div>
            <div className="mt-2 flex gap-3">
              <button onClick={() => setTab('terms')} className="text-sm text-blue-600 hover:underline py-1 px-2">Terms</button>
              <button onClick={() => setTab('privacy')} className="text-sm text-blue-600 hover:underline py-1 px-2">Privacy</button>
            </div>
          </div>

          {tab === 'terms' ? <TermsContent /> : <PrivacyContent />}
        </div>

          <footer className="flex items-center justify-between gap-3 border-t px-4 py-4 bg-slate-50">
          <div className="text-sm text-slate-600">By continuing you agree to these policies.</div>
            <div className="flex items-center gap-3">
            <button onClick={onClose} className="rounded-md px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Close</button>
            <button onClick={() => { onAccept({ version: POLICY_VERSION }); onClose(); }} className="rounded-md bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:opacity-95">Accept & Continue</button>
          </div>
        </footer>
      </div>
    </div>
  )
}

export default PoliciesModal
