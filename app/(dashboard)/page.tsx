export default function DashboardPage() {
  return (
    <div className="max-w-3xl">
      <h1 className="font-heading font-semibold text-display text-text-primary mb-3">
        Repositories
      </h1>
      <p className="text-body text-text-secondary mb-8">
        Install Argus on a repository to start receiving AI-powered code
        reviews.
      </p>

      {/* Empty state — stub for now, will be replaced with real repo list */}
      <div className="border border-border rounded-md bg-bg-surface p-8">
        <pre className="font-mono text-code text-text-secondary leading-relaxed">
          {`  // No repositories connected yet.
  // Install the Argus GitHub App on a repo
  // to see it listed here.`}
        </pre>
      </div>
    </div>
  );
}
