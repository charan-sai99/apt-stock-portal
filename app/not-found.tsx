import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-paper p-6">
      <div className="text-center">
        <p className="eyebrow">404</p>
        <h1 className="display mt-2 text-4xl">Page not found</h1>
        <Link href="/" className="btn btn-dark mt-6">Back to portal</Link>
      </div>
    </main>
  );
}
