export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 flex flex-col">
      <header className="h-14 flex items-center px-6 border-b border-border bg-bg-surface">
        <span className="font-heading font-semibold text-heading text-accent-amber tracking-tight">
          argus
        </span>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
