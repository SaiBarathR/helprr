'use client';

import { useId, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EVENT_GROUPS, EVENT_META, eventEnabledByDefault } from '@/lib/notification-events';
import {
  CHANNEL_CATALOG,
  CHANNEL_TYPES,
  type ChannelField,
  type ChannelSummary,
  type ChannelType,
} from '@/lib/notification-channels/catalog';

export interface ChannelFormValues {
  type: ChannelType;
  name: string;
  events: string[];
  config: Record<string, string>;
  /** Only fields typed in, plus null for a saved secret to remove. */
  secrets: Record<string, string | null>;
}

interface ChannelFormProps {
  initial?: ChannelSummary;
  availableEvents: string[];
  submitLabel: string;
  onSubmit: (values: ChannelFormValues) => Promise<void>;
  onCancel: () => void;
}

function defaultConfig(type: ChannelType): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of CHANNEL_CATALOG[type].fields) {
    if (!field.secret && field.defaultValue) out[field.key] = field.defaultValue;
  }
  return out;
}

/** The add and edit form for one channel. Saved secrets are never shown: an empty field keeps them. */
export function ChannelForm({ initial, availableEvents, submitLabel, onSubmit, onCancel }: ChannelFormProps) {
  const formId = useId();
  const [type, setType] = useState<ChannelType>(initial?.type ?? 'ntfy');
  const [name, setName] = useState(initial?.name ?? '');
  const [config, setConfig] = useState<Record<string, string>>(initial ? { ...initial.config } : defaultConfig('ntfy'));
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [events, setEvents] = useState<Set<string>>(new Set(initial?.events ?? availableEvents.filter(eventEnabledByDefault)));
  const [showEvents, setShowEvents] = useState(false);
  const [saving, setSaving] = useState(false);
  const meta = CHANNEL_CATALOG[type];
  const available = new Set(availableEvents);

  function changeType(next: ChannelType) {
    setType(next);
    setConfig(defaultConfig(next));
    setSecrets({});
    setRemoved(new Set());
  }

  function toggleEvent(eventType: string, on: boolean) {
    setEvents((prev) => {
      const next = new Set(prev);
      if (on) next.add(eventType);
      else next.delete(eventType);
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const secretValues: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(secrets)) if (value.trim()) secretValues[key] = value.trim();
    for (const key of removed) if (!(key in secretValues)) secretValues[key] = null;
    setSaving(true);
    try {
      await onSubmit({ type, name: name.trim(), events: [...events], config, secrets: secretValues });
    } finally {
      setSaving(false);
    }
  }

  function renderField(field: ChannelField) {
    const id = `${formId}-${field.key}`;
    const saved = Boolean(initial && initial.type === type && initial.secretsSet.includes(field.key) && !removed.has(field.key));
    const label = (
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {field.label}{field.required ? '' : ' (optional)'}
      </Label>
    );
    if (field.kind === 'select') {
      return (
        <div key={field.key} className="space-y-1.5">
          {label}
          <Select
            value={config[field.key] ?? field.defaultValue ?? ''}
            onValueChange={(value) => setConfig((prev) => ({ ...prev, [field.key]: value }))}
          >
            <SelectTrigger id={id} className="h-10 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {field.options?.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
        </div>
      );
    }
    return (
      <div key={field.key} className="space-y-1.5">
        {label}
        <Input
          id={id}
          type={field.secret ? 'password' : field.kind === 'number' ? 'number' : field.kind === 'email' ? 'email' : field.kind === 'url' ? 'url' : 'text'}
          inputMode={field.kind === 'number' ? 'numeric' : undefined}
          value={field.secret ? secrets[field.key] ?? '' : config[field.key] ?? ''}
          placeholder={saved ? 'Saved. Leave empty to keep it.' : field.placeholder}
          // A saved browser password must never be filled into a secret field: on Save it would replace the stored secret.
          autoComplete={field.secret ? 'new-password' : 'off'}
          spellCheck={false}
          onChange={(e) => {
            const value = e.target.value;
            if (field.secret) setSecrets((prev) => ({ ...prev, [field.key]: value }));
            else setConfig((prev) => ({ ...prev, [field.key]: value }));
          }}
          className="h-10"
        />
        {saved && !field.required && (
          <button
            type="button"
            className="text-xs text-primary min-h-[24px]"
            onClick={() => setRemoved((prev) => new Set(prev).add(field.key))}
          >
            Remove the saved {field.label.toLowerCase()}
          </button>
        )}
        {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="px-4 py-4 space-y-4">
      {!initial && (
        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-type`} className="text-xs text-muted-foreground">Type</Label>
          <Select value={type} onValueChange={(value) => changeType(value as ChannelType)}>
            <SelectTrigger id={`${formId}-type`} className="h-10 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CHANNEL_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{CHANNEL_CATALOG[t].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{meta.description}</p>
      <div className="space-y-1.5">
        <Label htmlFor={`${formId}-name`} className="text-xs text-muted-foreground">Name</Label>
        <Input
          id={`${formId}-name`}
          value={name}
          maxLength={60}
          placeholder={`My ${meta.label}`}
          onChange={(e) => setName(e.target.value)}
          className="h-10"
        />
      </div>
      {meta.fields.map(renderField)}

      <div>
        <button
          type="button"
          onClick={() => setShowEvents((v) => !v)}
          aria-expanded={showEvents}
          className="inline-flex items-center gap-1 text-sm font-medium min-h-[44px]"
        >
          {showEvents ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Events · {[...events].filter((e) => available.has(e)).length} of {availableEvents.length}
        </button>
        {showEvents && (
          <div className="space-y-3 pt-1">
            <div className="flex gap-3 text-xs">
              <button type="button" className="text-primary min-h-[32px]" onClick={() => setEvents(new Set(availableEvents))}>All</button>
              <button type="button" className="text-primary min-h-[32px]" onClick={() => setEvents(new Set())}>None</button>
            </div>
            {EVENT_GROUPS.map((group) => {
              const types = group.types.filter((t) => available.has(t));
              if (types.length === 0) return null;
              return (
                <fieldset key={group.id} className="space-y-1">
                  <legend className="text-xs uppercase tracking-[0.08em] text-muted-foreground/80">{group.title}</legend>
                  {types.map((eventType) => {
                    const id = `${formId}-event-${eventType}`;
                    return (
                      <label key={eventType} htmlFor={id} className="flex items-center gap-3 min-h-[36px] text-sm">
                        <Checkbox
                          id={id}
                          checked={events.has(eventType)}
                          onCheckedChange={(checked) => toggleEvent(eventType, checked === true)}
                        />
                        {EVENT_META[eventType].label}
                      </label>
                    );
                  })}
                </fieldset>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <Button type="submit" disabled={saving || !name.trim()} className="w-full sm:flex-1 h-9">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {submitLabel}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving} className="w-full sm:flex-1 h-9">
          Cancel
        </Button>
      </div>
    </form>
  );
}
