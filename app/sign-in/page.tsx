import { signIn } from '@/lib/auth';

export default function SignInPage() {
  return (
    <div className="flex-1 flex items-center justify-start pl-16 md:pl-24">
      <div className="max-w-md">
        <h1 className="font-heading font-semibold text-display text-text-primary mb-2">
          <span className="text-accent-amber">argus</span>
        </h1>
        <p className="text-body text-text-secondary mb-8 max-w-sm">
          AI code review with full-codebase context. Sign in with GitHub to get
          started.
        </p>

        <form
          action={async () => {
            'use server';
            await signIn('github', { redirectTo: '/' });
          }}
        >
          <button
            type="submit"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md
                       bg-accent-amber text-bg-base font-heading font-medium text-body
                       hover:brightness-110 transition-all duration-150
                       focus-visible:outline-2 focus-visible:outline-offset-2
                       focus-visible:outline-accent-amber"
          >
            <svg
              className="w-5 h-5"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                clipRule="evenodd"
              />
            </svg>
            Sign in with GitHub
          </button>
        </form>

        {/* Decorative code block — per design principles, show code not gradients */}
        <div className="mt-12 border border-border rounded-md bg-bg-surface p-4 max-w-sm">
          <pre className="font-mono text-code text-text-secondary leading-relaxed">
            <span className="text-accent-amber">{'// '}</span>
            <span className="text-text-secondary">
              reviewing pull request #42
            </span>
            {'\n'}
            <span className="text-accent-sage">{'+ '}</span>
            <span className="text-text-primary">context: full repository</span>
            {'\n'}
            <span className="text-accent-amber">{'~ '}</span>
            <span className="text-text-secondary">
              not just the diff
            </span>
          </pre>
        </div>
      </div>
    </div>
  );
}
