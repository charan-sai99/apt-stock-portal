export function PageHeader({ eyebrow, title, description, actions }: {
  eyebrow?: string; title: string; description?: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="display mt-1.5 text-[34px] leading-none sm:text-[40px]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, sub, icon: Icon, tone = "accent" }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; icon: React.ElementType;
  tone?: "accent" | "ok" | "warn" | "danger" | "muted";
}) {
  const tones = {
    accent: "bg-accent-50 text-accent", ok: "bg-ok-50 text-ok", warn: "bg-warn-50 text-warn",
    danger: "bg-danger-50 text-danger", muted: "bg-paper text-graphite-600",
  } as const;
  return (
    <div className="card relative overflow-hidden p-5">
      <div className="flex items-start justify-between">
        <p className="eyebrow">{label}</p>
        <span className={`grid h-8 w-8 place-items-center rounded-lg ${tones[tone]}`}><Icon size={16} /></span>
      </div>
      <div className="mt-3 text-[28px] font-bold leading-none tracking-tight">{value}</div>
      {sub && <div className="mt-2 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-paper text-graphite-600"><Icon size={22} /></span>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      {children && <div className="mt-1.5 max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}
