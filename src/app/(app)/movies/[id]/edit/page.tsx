'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { RadarrMovie, QualityProfile, RootFolder, Tag } from '@/types';

export default function MovieEditPage() {
  const { id } = useParams();
  const router = useRouter();

  const [movie, setMovie] = useState<RadarrMovie | null>(null);
  const [qualityProfiles, setQualityProfiles] = useState<QualityProfile[]>([]);
  const [rootFolders, setRootFolders] = useState<RootFolder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Edit form state
  const [qualityProfileId, setQualityProfileId] = useState<number>(0);
  const [minimumAvailability, setMinimumAvailability] = useState('');
  const [rootFolder, setRootFolder] = useState('');
  const [selectedTags, setSelectedTags] = useState<number[]>([]);

  useEffect(() => {
    Promise.all([
      fetch(`/api/radarr/${id}`).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/radarr/qualityprofiles').then((r) => (r.ok ? r.json() : [])),
      fetch('/api/radarr/rootfolders').then((r) => (r.ok ? r.json() : [])),
      fetch('/api/radarr/tags').then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([m, qp, rf, t]) => {
        setMovie(m);
        setQualityProfiles(qp);
        setRootFolders(rf);
        setTags(t);

        if (m) {
          setQualityProfileId(m.qualityProfileId);
          setMinimumAvailability(m.minimumAvailability);
          setSelectedTags([...m.tags]);
          setRootFolder(
            m.path ? m.path.split('/').slice(0, -1).join('/') : ''
          );
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  function toggleTag(tagId: number) {
    setSelectedTags((prev) =>
      prev.includes(tagId)
        ? prev.filter((t) => t !== tagId)
        : [...prev, tagId]
    );
  }

  async function handleSave() {
    if (!movie) return;
    setSaving(true);

    try {
      const updatedMovie = {
        ...movie,
        qualityProfileId,
        minimumAvailability,
        tags: selectedTags,
      };

      // Update root folder path if changed
      if (rootFolder && movie.path) {
        const movieFolder = movie.path.split('/').pop();
        updatedMovie.path = `${rootFolder}/${movieFolder}`;
      }

      const res = await fetch(`/api/radarr/${movie.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedMovie),
      });

      if (res.ok) {
        toast.success('Movie updated');
        router.back();
      } else {
        toast.error('Failed to update movie');
      }
    } catch {
      toast.error('Failed to update movie');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <><PageHeader title="Edit Movie" /><PageSpinner /></>;
  }

  if (!movie) {
    return (
      <div>
        <PageHeader title="Edit Movie" />
        <div className="text-center py-12 text-muted-foreground">
          Movie not found
        </div>
      </div>
    );
  }

  return (
    <div className="animate-content-in">
      <PageHeader title={movie.title} subtitle="Edit · Booth Sheet" />

      <div className="space-y-6 mt-4 pb-8">
        {/* Settings */}
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="reel" aria-hidden />
            <h2 className="tracked-caps text-[9.5px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>
              Settings
            </h2>
            <span className="hairline flex-1" aria-hidden />
          </div>
          <div className="border-t border-b border-[color:var(--hairline)]">
            <div className="flex justify-between items-center gap-3 py-3 border-b border-[color:var(--hairline)]">
              <Label className="tracked-caps text-[9.5px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>
                Quality Profile
              </Label>
              <Select
                value={String(qualityProfileId)}
                onValueChange={(v) => setQualityProfileId(Number(v))}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select profile" />
                </SelectTrigger>
                <SelectContent>
                  {qualityProfiles.map((qp) => (
                    <SelectItem key={qp.id} value={String(qp.id)}>
                      {qp.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-between items-center gap-3 py-3 border-b border-[color:var(--hairline)]">
              <Label className="tracked-caps text-[9.5px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>
                Min. Availability
              </Label>
              <Select
                value={minimumAvailability}
                onValueChange={setMinimumAvailability}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select availability" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="announced">Announced</SelectItem>
                  <SelectItem value="inCinemas">In Cinemas</SelectItem>
                  <SelectItem value="released">Released</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {rootFolders.length > 0 && (
              <div className="flex justify-between items-center gap-3 py-3">
                <Label className="tracked-caps text-[9.5px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>
                  Root Folder
                </Label>
                <Select value={rootFolder} onValueChange={setRootFolder}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Select folder" />
                  </SelectTrigger>
                  <SelectContent>
                    {rootFolders.map((rf) => (
                      <SelectItem key={rf.id} value={rf.path}>
                        {rf.path}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </section>

        {/* Tags */}
        {tags.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="reel" aria-hidden />
              <h2 className="tracked-caps text-[9.5px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>
                Tags · {selectedTags.length}
              </h2>
              <span className="hairline flex-1" aria-hidden />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => {
                const active = selectedTags.includes(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => toggleTag(t.id)}
                    className={`px-2.5 py-1 text-[11px] border transition-all ${
                      active
                        ? 'border-[color:var(--amber)] text-[color:var(--amber)] bg-[color:var(--amber-soft)]'
                        : 'border-[color:var(--hairline)] text-muted-foreground hover:text-foreground hover:border-foreground/30'
                    }`}
                    style={{ borderRadius: '999px' }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button
            className="flex-1 h-11 cta-sheen projector-glow"
            onClick={handleSave}
            disabled={saving}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            <span className="tracked-caps text-[10px]">Save Changes</span>
          </Button>
          <Button
            variant="outline"
            className="flex-1 h-11"
            onClick={() => router.back()}
            disabled={saving}
          >
            <span className="tracked-caps text-[10px]">Cancel</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
