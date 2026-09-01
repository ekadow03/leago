// app/login/page.tsx
//
// Every gated page in the app (Dashboard, Season Builder, Teams, etc.)
// redirects unauthenticated visitors to /login?next=<the page they wanted>
// — this page reads that param server-side (so no Suspense boundary is
// needed around a client-side useSearchParams()) and hands it to the
// actual form, which sends the browser back there after a successful
// login instead of always landing in the same place.
import Nav from '@/components/nav';
import LoginForm from './login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const destination = next || '/admin';

  return (
    <div className="auth-page">
      <Nav />
      <div className="auth-body">
        <h1>Log in</h1>
        <LoginForm next={destination} />
        <p className="auth-footer">
          Need an account?{' '}
          <a href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Sign up</a>
        </p>
      </div>
    </div>
  );
}
