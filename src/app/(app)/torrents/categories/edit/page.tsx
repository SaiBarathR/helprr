'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageSpinner } from '@/components/ui/page-spinner';
import { CategoryForm } from '../../_components/category-form';

function EditCategory() {
  const name = useSearchParams().get('name') ?? '';
  // Keyed: another category's page starts from its own save path.
  return <CategoryForm key={name} editName={name} />;
}

export default function EditTorrentCategoryPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <EditCategory />
    </Suspense>
  );
}
