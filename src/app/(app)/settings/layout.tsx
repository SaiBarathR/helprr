// Every settings page is a single column of grouped rows; on wide screens keep
// it at a readable width instead of stretching rows across the whole window.
// A page that is a multi-column editor (Theme) marks its root data-settings-wide
// and takes the full content width instead.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <div className="readable-column [&:has(>[data-settings-wide])]:max-w-none">{children}</div>;
}
