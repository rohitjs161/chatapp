import React from 'react'
import { useNavigate } from 'react-router-dom'

const Home = () => {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-dvh flex-col bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.18),_transparent_35%),radial-gradient(circle_at_90%_10%,_rgba(168,85,247,0.22),_transparent_32%),linear-gradient(160deg,_#f8fbff_0%,_#eef3ff_100%)] text-slate-900">
      <header className="sticky top-0 z-30 border-b border-white/70 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-slate-100"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 text-lg text-white shadow-md">💬</span>
            <span className="text-lg font-bold tracking-tight">ChatApp</span>
          </button>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => navigate('/login')}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 sm:px-4"
            >
              Sign In
            </button>
            <button
              onClick={() => navigate('/signup')}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition-all hover:bg-slate-800 sm:px-4"
            >
              Create Account
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-10 top-24 h-40 w-40 rounded-full bg-blue-300/20 blur-2xl"></div>
            <div className="absolute right-0 top-40 h-56 w-56 rounded-full bg-indigo-300/20 blur-3xl"></div>
            <div className="absolute bottom-10 left-1/2 h-44 w-44 -translate-x-1/2 rounded-full bg-fuchsia-300/20 blur-3xl"></div>
          </div>

          <div className="relative mx-auto grid w-full max-w-7xl grid-cols-1 gap-10 px-4 pb-20 pt-8 sm:px-6 md:pt-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-12 lg:px-8 lg:pb-24 lg:pt-12">
            <div className="self-start pt-1">
              <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-blue-700">
                Fast, clean, reliable
              </span>
              <h1 className="text-4xl font-black leading-tight tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
                Real-time chat built for everyday conversations.
              </h1>
              <p className="mt-5 max-w-2xl text-base text-slate-600 sm:text-lg">
                ChatApp focuses on what you actually use: instant text messaging and photo sharing in a simple, responsive interface.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  onClick={() => navigate('/login')}
                  className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-200/70 transition-all hover:scale-[1.02] hover:from-blue-700 hover:to-indigo-700"
                >
                  Get Started
                </button>
                <button
                  onClick={() => navigate('/signup')}
                  className="rounded-xl border border-slate-300 bg-white px-6 py-3.5 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:border-slate-400 hover:bg-slate-50"
                >
                  Create Account
                </button>
              </div>

              <div className="mt-8 grid grid-cols-1 gap-3 text-sm text-slate-600 sm:grid-cols-2">
                <div className="flex items-center gap-2 rounded-lg border border-white/70 bg-white/70 px-3 py-2 backdrop-blur-sm">
                  <span className="text-emerald-600">✓</span>
                  <span>Real-time messaging</span>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-white/70 bg-white/70 px-3 py-2 backdrop-blur-sm">
                  <span className="text-blue-600">✓</span>
                  <span>Photo sharing</span>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-white/70 bg-white/70 px-3 py-2 backdrop-blur-sm">
                  <span className="text-violet-600">✓</span>
                  <span>Clean responsive layout</span>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-white/70 bg-white/70 px-3 py-2 backdrop-blur-sm">
                  <span className="text-orange-600">✓</span>
                  <span>Simple and focused UX</span>
                </div>
              </div>
            </div>

            <div className="self-start lg:pt-4">
              <div className="rounded-3xl border border-white/70 bg-white/90 p-5 shadow-[0_20px_70px_rgba(15,23,42,0.14)] backdrop-blur-xl sm:p-6">
                <div className="rounded-2xl bg-slate-50 p-5">
                  <div className="mb-5 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">General Chat</p>
                      <p className="text-xs text-emerald-600">Live conversation</p>
                    </div>
                    <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">Live</span>
                  </div>

                  <div className="space-y-4 text-sm">
                    <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-slate-700 shadow-sm">
                      Hey, can you share the final image for the landing page?
                    </div>
                    <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-blue-600 px-3.5 py-2.5 text-white shadow-sm">
                      Sure, uploading it now. Check this screenshot.
                    </div>
                    <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-slate-700 shadow-sm">
                      Got it. Looks perfect.
                    </div>
                  </div>

                  <div className="mt-5 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-500">
                    <span>Type your message...</span>
                    <span className="ml-auto text-lg">➤</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-white/60 bg-white/75 py-12 backdrop-blur-xl sm:py-14">
          <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-4 px-4 sm:px-6 md:grid-cols-3 lg:px-8">
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
              <h3 className="text-lg font-bold text-slate-900">Real-Time Chat</h3>
              <p className="mt-2 text-sm text-slate-600">Send and receive messages instantly with a smooth and familiar chat flow.</p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
              <h3 className="text-lg font-bold text-slate-900">Photo Sharing</h3>
              <p className="mt-2 text-sm text-slate-600">Share images directly in conversation for faster context and collaboration.</p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
              <h3 className="text-lg font-bold text-slate-900">Responsive Design</h3>
              <p className="mt-2 text-sm text-slate-600">A consistent experience across desktop and mobile with clean alignment.</p>
            </article>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/70 bg-white/70 py-8 backdrop-blur-xl sm:py-10">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-4 px-4 text-sm text-slate-500 sm:flex-row sm:gap-6 sm:px-6 lg:px-8">
          <p>© 2026 ChatApp. Built for real-time communication.</p>
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/login')} className="transition-colors hover:text-slate-700">Sign In</button>
            <button onClick={() => navigate('/signup')} className="transition-colors hover:text-slate-700">Sign Up</button>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default Home