export default function Loading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-10 w-72 rounded-lg bg-line" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-28 rounded-xl bg-line/70" />)}</div>
      <div className="h-96 rounded-xl bg-line/60" />
    </div>
  );
}
