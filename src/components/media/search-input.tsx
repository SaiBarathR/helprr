'use client';

import * as React from 'react';
import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useSearchHistory } from '@/lib/hooks/use-search-history';
import { useSearchHistoryListbox } from '@/lib/hooks/use-search-history-listbox';
import { SearchHistoryDropdown } from './search-history-dropdown';

interface SearchInputProps extends Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'onSubmit'> {
  value: string;
  onChange: (value: string) => void;
  /** Storage bucket for this bar's recent searches. */
  historyKey: string;
  /** Called when a history item is picked (after onChange), for bars that search on
   *  submit rather than on change (e.g. lookup forms). */
  onSubmit?: (term: string) => void;
  /** Class for the relative wrapper that anchors the dropdown. */
  wrapperClassName?: string;
  /** Adornments rendered inside the wrapper alongside the input (icons, clear button). */
  children?: React.ReactNode;
}

// A controlled text input with a recent-search dropdown, for the non-debounced
// search bars. Owns its own `relative` wrapper so the dropdown anchors correctly
// and it drops in wherever a bare <Input> was used. Terms are committed to history
// on Enter / blur; selecting a history item re-applies it (and onSubmit if given).
export function SearchInput({
  value,
  onChange,
  historyKey,
  onSubmit,
  wrapperClassName,
  children,
  onFocus,
  onBlur,
  onKeyDown,
  ...inputProps
}: SearchInputProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { recent, add, remove } = useSearchHistory(historyKey);

  const commit = () => {
    if (value.trim()) add(value.trim());
  };

  const query = value.trim().toLowerCase();
  const items = query
    ? recent.filter((h) => h.toLowerCase().includes(query) && h.toLowerCase() !== query)
    : recent;

  const select = (term: string) => {
    onChange(term);
    onSubmit?.(term);
    add(term);
    setOpen(false);
  };

  const listbox = useSearchHistoryListbox({
    items,
    open,
    onSelect: select,
    onClose: () => setOpen(false),
  });

  const showHistory = open && items.length > 0;

  return (
    <div className={cn('relative', wrapperClassName)} ref={wrapperRef}>
      {children}
      <Input
        {...inputProps}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={(e) => {
          setOpen(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          commit();
          setOpen(false);
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          listbox.onInputKeyDown(e);
          if (!e.defaultPrevented) {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') setOpen(false);
          }
          onKeyDown?.(e);
        }}
        aria-expanded={showHistory}
        aria-controls={showHistory ? listbox.listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={listbox.activeDescendantId}
      />
      {open && (
        <SearchHistoryDropdown
          anchorRef={wrapperRef}
          items={items}
          onSelect={select}
          onRemove={remove}
          highlightedIndex={listbox.highlightedIndex}
          listboxId={listbox.listboxId}
          getOptionId={listbox.getOptionId}
          onHighlightIndex={listbox.setHighlightedIndex}
        />
      )}
    </div>
  );
}
