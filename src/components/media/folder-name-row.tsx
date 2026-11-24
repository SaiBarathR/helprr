'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const FOLDER_NAME_ERROR_ID = 'folder-name-error';

/**
 * The Edit pages' Folder field: the title's own folder inside the chosen root
 * folder, so the saved path is root folder + this name. The page shows `error`
 * under the section, at FOLDER_NAME_ERROR_ID.
 */
export function FolderNameRow({
  value,
  onChange,
  error,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  disabled?: boolean;
}) {
  return (
    <div className="grouped-row">
      <Label htmlFor="folder-name" className="text-sm shrink-0">Folder</Label>
      <Input
        id="folder-name"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? FOLDER_NAME_ERROR_ID : undefined}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        disabled={disabled}
        className="ml-3 min-w-0 flex-1 sm:max-w-[320px]"
      />
    </div>
  );
}
