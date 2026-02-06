interface MediaGridProps {
  children: React.ReactNode;
  view?: 'grid' | 'list';
}

export function MediaGrid({ children, view = 'grid' }: MediaGridProps) {
  if (view === 'list') {
    return <div className="flex flex-col divide-y divide-border">{children}</div>;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {children}
    </div>
  );
}
