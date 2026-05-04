const MobileBlock = () => {
    return (
        <div className="relative min-h-[100dvh] overflow-y-auto bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.22),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(168,85,247,0.18),_transparent_28%),linear-gradient(180deg,_#f8fbff_0%,_#eef2ff_100%)] px-4 py-6 sm:px-6 sm:py-8 lg:flex lg:items-center lg:justify-center lg:py-10">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[linear-gradient(180deg,_rgba(15,23,42,0.06),_transparent)]" />
            <div className="pointer-events-none absolute left-[-6rem] top-10 h-44 w-44 rounded-full bg-blue-400/25 blur-3xl" />
            <div className="pointer-events-none absolute bottom-4 right-[-4rem] h-56 w-56 rounded-full bg-fuchsia-400/20 blur-3xl" />

            <main className="relative mx-auto w-full max-w-5xl overflow-hidden rounded-[2rem] border border-white/70 bg-white/85 shadow-[0_24px_90px_rgba(15,23,42,0.16)] backdrop-blur-xl">
                <div className="grid lg:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.1fr)]">
                    <section className="relative flex items-start justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-indigo-950 px-6 py-10 text-white sm:px-8 lg:items-center lg:px-10 lg:py-12">
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.18),_transparent_34%)]" />
                        <div className="absolute right-[-2rem] top-[-2rem] h-36 w-36 rounded-full bg-blue-400/20 blur-3xl" />
                        <div className="relative w-full max-w-sm">
                            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-white/85 backdrop-blur">
                                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                                Desktop access required
                            </div>

                            <div className="mt-6 flex items-center gap-4">
                                <div className="flex h-16 w-16 items-center justify-center rounded-[1.25rem] bg-gradient-to-br from-blue-500 to-cyan-400 text-2xl shadow-[0_18px_40px_rgba(59,130,246,0.35)]">
                                    💻
                                </div>
                                <div>
                                    <p className="text-sm uppercase tracking-[0.32em] text-blue-200/80">Desktop Only</p>
                                    <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
                                        Open on a bigger screen
                                    </h1>
                                </div>
                            </div>

                            <p className="mt-5 max-w-md text-sm leading-7 text-slate-200 sm:text-base">
                                This experience is optimized for laptops and desktops. Switch your browser to desktop mode, or open the app on a wider device to continue.
                            </p>

                            <div className="mt-6 grid gap-3 sm:grid-cols-2">
                                <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-200/80">Why this matters</p>
                                    <p className="mt-2 text-sm leading-6 text-slate-100">
                                        The app uses a dense multi-panel interface that works best with desktop width.
                                    </p>
                                </div>
                                <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-200/80">Auto unlock</p>
                                    <p className="mt-2 text-sm leading-6 text-slate-100">
                                        Once the viewport becomes wide enough, access is restored automatically.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="flex items-start px-5 py-8 sm:px-6 lg:items-center lg:px-8 lg:py-10">
                        <div className="w-full">
                            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 shadow-[0_14px_45px_rgba(15,23,42,0.06)] sm:p-5">
                                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">How to continue</p>
                                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                                        <p className="text-sm font-semibold text-slate-900">Chrome on Android</p>
                                        <ol className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                                            <li>1. Open the menu in Chrome.</li>
                                            <li>2. Tap <span className="font-medium text-slate-900">Desktop site</span>.</li>
                                            <li>3. Refresh after the page widens.</li>
                                        </ol>
                                    </div>

                                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                                        <p className="text-sm font-semibold text-slate-900">Best experience</p>
                                        <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                                            <li>• Use a laptop or desktop browser.</li>
                                            <li>• Keep the window wider than 768px.</li>
                                            <li>• Rotate the device only if desktop mode is enabled.</li>
                                        </ul>
                                    </div>
                                </div>

                                <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-900">
                                    Tip: if you just enabled desktop mode, the app will unlock automatically once the viewport updates.
                                </div>
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium text-slate-500">
                                <span className="rounded-full border border-slate-200 bg-white px-3 py-1">Responsive check enabled</span>
                                <span className="rounded-full border border-slate-200 bg-white px-3 py-1">Viewport-based unlock</span>
                                <span className="rounded-full border border-slate-200 bg-white px-3 py-1">Accessible fallback screen</span>
                            </div>
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
};

export default MobileBlock;