// components/nav.tsx
import Link from 'next/link';

export default function Nav() {
  return (
    <nav className="nav">
      <Link href="/register" className="nav-logo">
        lea<span>go</span>
      </Link>
    </nav>
  );
}