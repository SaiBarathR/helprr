'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { SonarrSeries, QualityProfile, Tag } from '@/types';

export default function SeriesEditPage() {
  const { id } = useParams();
  const router = useRouter();

  const [series, setSeries] = useState<SonarrSeries | null>(null);
  const [qualityProfiles, setQualityProfiles] = useState<QualityProfile[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Edit form state
  const [qualityProfileId, setQualityProfileId] = useState<number>(0);
  const [seriesType, setSeriesType] = useState('');
  const [selectedTags, setSelectedTags] = useState<number[]>([]);

  useEffect(() => {
    Promise.all([
      fetch(`/api/sonarr/${id}`).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/sonarr/qualityprofiles').then((r) => (r.ok ? r.json() : [])),
      fetch('/api/sonarr/tags').then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([s, qp, t]) => {
        setSeries(s);
        setQualityProfiles(qp);
        setTags(t);
        if (s) {
          setQualityProfileId(s.qualityProfileId);
          setSeriesType(s.seriesType);
          setSelectedTags([...s.tags]);
        }
      })
      .catch(() => {
        toast.error('Failed to load series data');
      })
      .finally(() => setLoading(false));
  }, [id]);

  function toggleTag(tagId: number) {
    setSelectedTags((prev) =>
      prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]
    );
  }

  async function handleSave() {
    if (!series) return;
    setSaving(true);
    try {
      const updatedSeries = {
        ...series,
        qualityProfileId,
        seriesType,
        tags: selectedTags,
      };
      const res = await fetch(`/api/sonarr/${series.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSeries),
      });
      if (res.ok) {
        toast.success('Series updated');
        router.back();
      } else {
        toast.error('Failed to update series');
      }
    } catch {
      toast.error('Failed to update series');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <><PageHeader title="Edit Series" /><PageSpinner /></>;
  }

  if (!series) {
    return (
      <div>
        <PageHeader title="Edit Series" />
        <div className="text-center py-12 text-muted-foreground">Series not found</div>
      </div>
    );
  }

  return (
    <div className="animate-content-in">
      <PageHeader title={series.title} subtitle="Edit · Series Sheet" />

      <div className="pt-4 pb-8 space-y-6">
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
              <Label htmlFor="quality-profile" className="tracked-caps text-[9.5px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>
                Quality Profile
              </Label>
              <Select
                value={String(qualityProfileId)}
                onValueChange={(v) => setQualityProfileId(Number(v))}
              >
                <SelectTrigger id="quality-profile" className="w-[200px]">
                  <SelectValue />
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

            <div className="flex justify-between items-center gap-3 py-3">
              <Label htmlFor="series-type" className="tracked-caps text-[9.5px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>
                Series Type
              </Label>
              <Select value={seriesType} onValueChange={setSeriesType}>
                <SelectTrigger id="series-type" className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="anime">Anime</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

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

        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            className="flex-1 h-11"
            onClick={() => router.back()}
            disabled={saving}
          >
            <span className="tracked-caps text-[10px]">Cancel</span>
          </Button>
          <Button
            className="flex-1 h-11 cta-sheen projector-glow"
            onClick={handleSave}
            disabled={saving}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            <span className="tracked-caps text-[10px]">Save</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
