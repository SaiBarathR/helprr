'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Search, X } from 'lucide-react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChange, placeholder = 'Search…' }: SearchBarProps) {
  const [internal, setInternal] = useState(value);

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

  return (
    <div className="relative group">
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70 group-focus-within:text-[color:var(--amber)] transition-colors" />
      <Input
        placeholder={placeholder}
        value={internal}
        onChange={(e) => setInternal(e.target.value)}
        className="pl-10 pr-10 bg-card/40"
      />
      {internal && (
        <button
          onClick={() => setInternal('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md hover:bg-accent flex items-center justify-center"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}
