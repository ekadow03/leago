// app/signup/page.tsx
import Nav from '@/components/nav';
import SignUpForm from './signup-form';

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const destination = next || '/get-started';

  return (
    <div className="auth-page">
      <Nav />
      <div className="auth-body">
        <h1>Create an account</h1>
        <SignUpForm next={destination} />
        <p className="auth-footer">
          Already have an account?{' '}
          <a href={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Log in</a>
        </p>
      </div>
    </div>
  );
}
