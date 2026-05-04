const AuthLoadingScreen = ({
    title = "Signing you in",
    subtitle = "Checking your session and preparing your chat space.",
    detail = "Please keep this tab open for a moment.",
}) => {
    return (
        <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.22),_transparent_34%),radial-gradient(circle_at_85%_20%,_rgba(14,165,233,0.2),_transparent_28%),linear-gradient(160deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 text-white">
            <div className="absolute left-1/2 top-1/2 h-[32rem] w-[32rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/10 blur-3xl" />
            <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-white/8 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
                <div className="mb-6 flex items-center gap-3">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-400 text-2xl shadow-lg shadow-blue-500/30">
                        💬
                    </div>
                    <div>
                        <p className="text-sm uppercase tracking-[0.24em] text-slate-300">ChatApp</p>
                        <h1 className="text-xl font-semibold text-white">{title}</h1>
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/6 px-4 py-3">
                        <div className="h-3 w-3 animate-pulse rounded-full bg-cyan-400" />
                        <p className="text-sm text-slate-200">{subtitle}</p>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-4">
                        <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-[0.22em] text-slate-400">
                            <span>Session</span>
                            <span>Secure</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                            <div className="h-full w-2/3 animate-[loadingBar_1.2s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-400" />
                        </div>
                    </div>

                    <p className="text-sm leading-6 text-slate-300">{detail}</p>
                </div>
            </div>
        </div>
    );
};

export default AuthLoadingScreen;