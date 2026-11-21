/** Geometric motif derived from the APT logo: two overlapping squares forming an eight-point star. */
export function GeoMark({ className = "", strokeWidth = 1 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={strokeWidth}>
      <rect x="20" y="20" width="60" height="60" />
      <rect x="20" y="20" width="60" height="60" transform="rotate(45 50 50)" />
      <rect x="32" y="32" width="36" height="36" transform="rotate(22.5 50 50)" opacity=".6" />
      <rect x="32" y="32" width="36" height="36" transform="rotate(67.5 50 50)" opacity=".6" />
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/apt-mark.png" alt="APT" className={compact ? "h-8 w-8 rounded-md object-cover" : "h-11 w-11 rounded-lg object-cover ring-1 ring-white/10"} />
      <div className="leading-[.92]">
        {compact ? (
          <div className="display whitespace-nowrap text-[17px] tracking-wide">Axis Plastics Transition</div>
        ) : (
          <>
            <div className="display text-[21px] tracking-wide">Axis Plastics</div>
            <div className="display text-[21px] tracking-wide">Transition</div>
          </>
        )}
        {!compact && <div className="mt-1.5 text-[8.5px] font-semibold tracking-[.28em] text-graphite-300">STOCK PORTAL</div>}
      </div>
    </div>
  );
}
