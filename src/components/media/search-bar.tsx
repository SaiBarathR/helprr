'use client';

import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { useSearchHistory } from '@/lib/hooks/use-search-history';
import { SearchHistoryDropdown } from './search-history-dropdown';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** When set, recent searches are remembered and shown under the bar on focus. */
  historyKey?: string;
}

export function SearchBar({ value, onChange, placeholder = 'Search...', historyKey }: SearchBarProps) {
  const [internal, setInternal] = useState(value);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { recent, add, remove } = useSearchHistory(historyKey ?? '');

  useEffect(() => {
    if (internal === '') {
      onChange('');
      return;
    }

    const timer = setTimeout(() => onChange(internal), 700);
    return () => clearTimeout(timer);
  }, [internal, onChange]);

  useEffect(() => {
    setInternal(value);
  }, [value]);

  const commit = () => {
    if (historyKey && internal.trim()) add(internal.trim());
  };

  const query = internal.trim().toLowerCase();
  const items = query
    ? recent.filter((h) => h.toLowerCase().includes(query) && h.toLowerCase() !== query)
    : recent;

  const select = (term: string) => {
    setInternal(term);
    onChange(term);
    if (historyKey) add(term);
    setOpen(false);
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        value={internal}
        onChange={(e) => {
          setInternal(e.target.value);
          if (historyKey) setOpen(true);
        }}
        onFocus={() => historyKey && setOpen(true)}
        onBlur={() => {
          commit();
          setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            setOpen(false);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="pl-9"
      />
      {historyKey && open && (
        <SearchHistoryDropdown anchorRef={wrapperRef} items={items} onSelect={select} onRemove={remove} />
      )}
    </div>
  );
}
