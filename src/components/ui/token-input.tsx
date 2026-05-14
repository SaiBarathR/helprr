'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

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
  'aria-invalid'?: boolean;
  id?: string;
}

/**
 * Chip-style multi-value input. Press Enter or comma to commit the current
 * draft. Backspace on empty draft removes the last chip. Paste a comma- or
 * newline-separated list to bulk-add. Avoids the cursor-jump bug from
 * splitting/rejoining a single Input value on every keystroke.
 */
export function TokenInput({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  dedupe = true,
  maxTokens,
  id,
  'aria-invalid': ariaInvalid,
}: TokenInputProps) {
  const [draft, setDraft] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const commitTokens = React.useCallback((raw: string) => {
    const incoming = raw
      .split(/[,\n]/)
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
  }, [value, onChange, dedupe, maxTokens]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (draft.trim()) {
        commitTokens(draft);
        setDraft('');
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
    if (text.includes(',') || text.includes('\n')) {
      e.preventDefault();
      commitTokens(draft + text);
      setDraft('');
    }
  };

  const handleBlur = () => {
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
    <div
      className={cn(
        'flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent dark:bg-input/30 px-2 py-1.5 min-h-9 text-sm shadow-xs transition-[color,box-shadow]',
        'focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]',
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
            className="text-muted-foreground hover:text-foreground disabled:cursor-not-allowed"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={handleBlur}
        disabled={disabled}
        placeholder={value.length === 0 ? placeholder : undefined}
        aria-invalid={ariaInvalid}
        className="flex-1 min-w-[6rem] bg-transparent outline-none placeholder:text-muted-foreground py-0.5"
      />
    </div>
  );
}
