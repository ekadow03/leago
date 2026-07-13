// components/nav.tsx
import Link from 'next/link';
import Image from 'next/image';

export default function Nav() {
  return (
    <nav className="nav">
      <Link href="/" style={{ display: 'flex', alignItems: 'center' }}>
        <Image src="/leago-logo.png" alt="leago" width={160} height={48} style={{ height: 40, width: 'auto' }} priority />
      </Link>
    </nav>
  );
}