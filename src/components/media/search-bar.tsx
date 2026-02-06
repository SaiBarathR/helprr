'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChange, placeholder = 'Search...' }: SearchBarProps) {
  const [internal, setInternal] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => onChange(internal), 300);
    return () => clearTimeout(timer);
  }, [internal, onChange]);

  useEffect(() => {
    setInternal(value);
  }, [value]);

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        value={internal}
        onChange={(e) => setInternal(e.target.value)}
        className="pl-9"
      />
    </div>
  );
}
