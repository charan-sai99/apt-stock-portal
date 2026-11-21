export function StatusTag({ status }: { status: string }) {
  if (status === "published") return <span className="tag tag-ok">Published</span>;
  if (status === "amended") return <span className="tag tag-unit">Published · amended</span>;
  return <span className="tag tag-warn">Draft</span>;
}
