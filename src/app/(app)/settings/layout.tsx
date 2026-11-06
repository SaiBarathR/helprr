// Every settings page is a single column of grouped rows; on wide screens keep
// it at a readable width instead of stretching rows across the whole window.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <div className="readable-column">{children}</div>;
}
