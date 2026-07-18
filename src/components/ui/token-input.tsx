'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';

export interface TokenSuggestionGroup {
  /** Optional heading rendered above the group's options. */
  label?: string;
  options: string[];
}

interface TokenInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** If set, deduplicate tokens case-insensitively. Defaults to true. */
  dedupe?: boolean;
  /** Optional max number of tokens; further input is rejected silently. */
  maxTokens?: number;
  /**
   * Autocomplete options shown in a dropdown while typing (and on focus).
   * Pass a flat list, or groups with labels for mixed sources. Already-added
   * tokens are hidden. Free text remains allowed — suggestions only assist.
   */
  suggestions?: string[] | TokenSuggestionGroup[];
  /**
   * Whether a comma commits the current draft as a token (and pasted text is
   * split on commas). Defaults to true. Turn off for values that may legally
   * contain commas (e.g. free-text match patterns); newline/Enter still commit.
   */
  splitCommas?: boolean;
  'aria-invalid'?: boolean;
  id?: string;
}

function normalizeGroups(suggestions: TokenInputProps['suggestions']): TokenSuggestionGroup[] {
  if (!suggestions || suggestions.length === 0) return [];
  if (typeof suggestions[0] === 'string') return [{ options: suggestions as string[] }];
  return suggestions as TokenSuggestionGroup[];
}

/**
 * Chip-style multi-value input with optional autocomplete. Press Enter (or
 * comma, unless `splitCommas` is off) to commit the current draft. Backspace
 * on empty draft removes the last chip. Paste a comma-/newline-separated list
 * to bulk-add. When `suggestions` are provided, a dropdown offers matching
 * options on focus/typing — arrow keys + Enter or tap to add.
 */
export function TokenInput({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  dedupe = true,
  maxTokens,
  suggestions,
  splitCommas = true,
  id,
  'aria-invalid': ariaInvalid,
}: TokenInputProps) {
  const [draft, setDraft] = React.useState('');
  const [focused, setFocused] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);
  const [highlight, setHighlight] = React.useState(-1);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const suggestionPointerRef = React.useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const listboxId = React.useId();

  const commitTokens = React.useCallback((raw: string) => {
    const incoming = raw
      .split(splitCommas ? /[,\n]/ : /\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (incoming.length === 0) return;

    const next = [...value];
    const lowerSet = dedupe ? new Set(next.map((s) => s.toLowerCase())) : null;
    for (const tok of incoming) {
      if (lowerSet) {
        const key = tok.toLowerCase();
        if (lowerSet.has(key)) continue;
        lowerSet.add(key);
      }
      if (maxTokens != null && next.length >= maxTokens) break;
      next.push(tok);
    }
    if (next.length !== value.length || next.some((v, i) => v !== value[i])) {
      onChange(next);
    }
  }, [value, onChange, dedupe, maxTokens, splitCommas]);

  // Filter suggestions by the current draft and drop already-added tokens.
  const groups = React.useMemo(() => {
    const all = normalizeGroups(suggestions);
    if (all.length === 0) return [];
    const selected = new Set(value.map((s) => s.toLowerCase()));
    const q = draft.trim().toLowerCase();
    return all
      .map((g) => ({
        label: g.label,
        options: g.options.filter((o) => {
          const lo = o.toLowerCase();
          return !selected.has(lo) && (q === '' || lo.includes(q));
        }),
      }))
      .filter((g) => g.options.length > 0);
  }, [suggestions, value, draft]);
  const flatOptions = React.useMemo(() => groups.flatMap((g) => g.options), [groups]);
  // Flat index of each group's first option — keeps keyboard highlight and
  // rendered options aligned without mutating a counter during render.
  const groupOffsets = React.useMemo(() => {
    const offsets: number[] = [];
    let acc = 0;
    for (const g of groups) {
      offsets.push(acc);
      acc += g.options.length;
    }
    return offsets;
  }, [groups]);

  const open = focused && !dismissed && flatOptions.length > 0 && !disabled;

  // Keep the highlight in range as the filtered list changes.
  React.useEffect(() => {
    setHighlight((h) => (h >= flatOptions.length ? flatOptions.length - 1 : h));
  }, [flatOptions.length]);

  React.useEffect(() => {
    if (highlight < 0 || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-index="${highlight}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  const addToken = (tok: string) => {
    commitTokens(tok);
    setDraft('');
    setHighlight(-1);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.key === 'Enter' || (splitCommas && e.key === ',')) {
      e.preventDefault();
      if (open && highlight >= 0 && e.key === 'Enter') {
        addToken(flatOptions[highlight]);
      } else if (draft.trim()) {
        commitTokens(draft);
        setDraft('');
        setHighlight(-1);
      }
    } else if (e.key === 'ArrowDown') {
      if (dismissed) setDismissed(false);
      if (flatOptions.length > 0) {
        e.preventDefault();
        setHighlight((h) => (h + 1) % flatOptions.length);
      }
    } else if (e.key === 'ArrowUp') {
      if (open) {
        e.preventDefault();
        setHighlight((h) => (h <= 0 ? flatOptions.length - 1 : h - 1));
      }
    } else if (e.key === 'Escape') {
      if (open) {
        // Swallow the Escape so a wrapping dialog/drawer doesn't also close.
        e.preventDefault();
        e.stopPropagation();
        setDismissed(true);
        setHighlight(-1);
      }
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      e.preventDefault();
      const next = value.slice(0, -1);
      onChange(next);
    } else if (e.key === 'Tab' && draft.trim()) {
      // Commit on Tab so users can keyboard their way through a form.
      commitTokens(draft);
      setDraft('');
      // Don't preventDefault — let focus move on.
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if ((splitCommas && text.includes(',')) || text.includes('\n')) {
      e.preventDefault();
      commitTokens(draft + text);
      setDraft('');
    }
  };

  const handleBlur = () => {
    setFocused(false);
    setDismissed(false);
    setHighlight(-1);
    if (draft.trim()) {
      commitTokens(draft);
      setDraft('');
    }
  };

  const removeToken = (idx: number) => {
    if (disabled) return;
    const next = value.filter((_, i) => i !== idx);
    onChange(next);
    inputRef.current?.focus();
  };

  return (
    <Popover open={open} onOpenChange={(o) => { if (!o) setDismissed(true); }} modal={false}>
      <PopoverAnchor asChild>
        <div
          className={cn(
            'flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent dark:bg-input/30 px-2 py-1.5 min-h-9 text-sm shadow-xs transition-[color,box-shadow]',
            ariaInvalid && 'aria-invalid:border-destructive border-destructive ring-destructive/20',
            disabled && 'pointer-events-none opacity-50',
            className,
          )}
          onClick={() => inputRef.current?.focus()}
        >
          {value.map((tok, idx) => (
            <span
              key={`${tok}-${idx}`}
              className="inline-flex items-center gap-1 rounded-md bg-secondary text-secondary-foreground px-2 py-0.5 text-xs"
            >
              <span className="break-all">{tok}</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeToken(idx); }}
                disabled={disabled}
                aria-label={`Remove ${tok}`}
                className="text-muted-foreground hover:text-foreground disabled:cursor-not-allowed p-1 -m-1"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <input
            id={id}
            ref={inputRef}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setDismissed(false); setHighlight(-1); }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => setFocused(true)}
            onBlur={handleBlur}
            disabled={disabled}
            placeholder={value.length === 0 ? placeholder : undefined}
            aria-invalid={ariaInvalid}
            role={suggestions ? 'combobox' : undefined}
            aria-expanded={suggestions ? open : undefined}
            aria-controls={open ? listboxId : undefined}
            aria-autocomplete={suggestions ? 'list' : undefined}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className="flex-1 min-w-[6rem] bg-transparent outline-none placeholder:text-muted-foreground py-0.5"
          />
        </div>
      </PopoverAnchor>
      {open && (
        <PopoverContent
          id={listboxId}
          role="listbox"
          align="start"
          sideOffset={4}
          className="w-(--radix-popover-trigger-width) min-w-40 p-1 max-h-56 overflow-y-auto"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          // Keep focus (and the keyboard on mobile) in the input while tapping options.
          onPointerDown={(e) => e.preventDefault()}
        >
          <div ref={listRef}>
            {groups.map((g, gi) => (
              <div key={g.label ?? gi}>
                {g.label && (
                  <div className="px-2 pt-1.5 pb-0.5 text-[11px] font-medium text-muted-foreground select-none">
                    {g.label}
                  </div>
                )}
                {g.options.map((opt, oi) => {
                  const idx = groupOffsets[gi] + oi;
                  return (
                    <div
                      key={opt}
                      role="option"
                      aria-selected={idx === highlight}
                      data-index={idx}
                      onPointerDown={(e) => {
                        if (!e.isPrimary || e.button !== 0) {
                          suggestionPointerRef.current = null;
                          return;
                        }
                        // Keep focus (and the mobile keyboard) in the input, but
                        // wait for pointerup before committing so a scroll gesture
                        // does not select the option it started over.
                        e.preventDefault();
                        suggestionPointerRef.current = {
                          pointerId: e.pointerId,
                          x: e.clientX,
                          y: e.clientY,
                        };
                      }}
                      onPointerMove={(e) => {
                        const origin = suggestionPointerRef.current;
                        if (!origin || origin.pointerId !== e.pointerId) return;
                        const deltaX = e.clientX - origin.x;
                        const deltaY = e.clientY - origin.y;
                        if ((deltaX * deltaX) + (deltaY * deltaY) > 100) {
                          suggestionPointerRef.current = null;
                        }
                      }}
                      onPointerCancel={() => {
                        suggestionPointerRef.current = null;
                      }}
                      onPointerUp={(e) => {
                        const origin = suggestionPointerRef.current;
                        suggestionPointerRef.current = null;
                        if (
                          origin
                          && origin.pointerId === e.pointerId
                          && e.isPrimary
                          && e.button === 0
                        ) {
                          addToken(opt);
                        }
                      }}
                      onMouseMove={() => setHighlight(idx)}
                      className={cn(
                        'px-2 py-1.5 text-sm rounded-sm cursor-pointer break-all',
                        idx === highlight && 'bg-accent text-accent-foreground',
                      )}
                    >
                      {opt}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </PopoverContent>
      )}
    </Popover>
  );
}
