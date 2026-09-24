import { auth, signOut } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect('/sign-in');
  }

  return (
    <div className="flex-1 flex flex-col">
      <header className="h-14 flex items-center justify-between px-6 border-b border-border bg-bg-surface">
        <span className="font-heading font-semibold text-heading text-accent-amber tracking-tight">
          argus
        </span>
        <div className="flex items-center gap-4">
          <span className="text-caption text-text-secondary">
            {session.user.name ?? session.user.email}
          </span>
          <form
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/sign-in' });
            }}
          >
            <button
              type="submit"
              className="text-caption text-text-secondary hover:text-text-primary transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
