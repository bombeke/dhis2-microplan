export const Footer =()=>{
    return (
        <footer className="mt-auto border-t border-slate-200/80 bg-white">
            <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">

                {/* Identity — the product names itself once, quietly. */}
                <div className="flex items-center gap-3">
                <span
                    aria-hidden
                    className="h-6 w-1 rounded-full bg-gradient-to-b from-emerald-500 to-sky-500"
                />
                <div className="leading-tight">
                    <p className="text-sm font-semibold tracking-tight text-slate-800">
                    Outreach Microplan &amp; Coverage
                    </p>
                    <p className="text-xs text-slate-500">
                    Immunization Outreach Microplanning
                    </p>
                </div>
                </div>

                {/* Provenance — where the polygons and the records actually come from.
                    Data sources are facts about the tool, so they read as labelled links,
                    not nav items. */
                }
                <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
                <div className="flex items-center gap-2">
                    <dt className="font-medium uppercase tracking-wider text-slate-400">
                    Settlements Maps by
                    </dt>
                    <dd>
                    <a
                        href="https://grid3.org"
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-sm font-medium text-slate-700 underline-offset-4 transition-colors hover:text-emerald-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                    >
                        GRID3
                    </a>
                    </dd>
                </div>

                <div className="flex items-center gap-2">
                    <dt className="font-medium uppercase tracking-wider text-slate-400">
                    Platform by
                    </dt>
                    <dd>
                    <a
                        href="https://dhis2.org"
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-sm font-medium text-slate-700 underline-offset-4 transition-colors hover:text-sky-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                    >
                        DHIS2
                    </a>
                    </dd>
                </div>
                </dl>

                {/* Actions + copyright */}
                <div className="flex items-center gap-4 text-xs">
                <button
                    type="button"
                    onClick={() => navigate('files')}
                    className="rounded-sm font-medium text-slate-600 underline-offset-4 transition-colors hover:text-slate-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-600"
                >
                    Uploaded plans
                </button>
                <span aria-hidden className="h-3 w-px bg-slate-200" />
                <span className="tabular-nums text-slate-400">
                    &copy; {new Date().getFullYear()}
                </span>
                </div>
            </div>
            </footer>
    )
}