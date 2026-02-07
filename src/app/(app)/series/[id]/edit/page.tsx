'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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
    return (
      <div>
        <PageHeader title="Edit Series" />
        <div className="px-4 pt-4 space-y-6">
          <div className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full rounded-xl" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full rounded-xl" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-4 w-16" />
            <div className="flex gap-2">
              <Skeleton className="h-7 w-16 rounded-full" />
              <Skeleton className="h-7 w-20 rounded-full" />
              <Skeleton className="h-7 w-14 rounded-full" />
            </div>
          </div>
        </div>
      </div>
    );
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
    <div>
      <PageHeader title={`Edit ${series.title}`} />

      <div className="px-4 pt-4 pb-8 space-y-6">
        {/* Quality Profile */}
        <div className="grouped-section">
          <p className="grouped-section-title">Quality Profile</p>
          <div className="grouped-section-content">
            <div className="grouped-row">
              <Label htmlFor="quality-profile" className="text-sm shrink-0">
                Profile
              </Label>
              <Select
                value={String(qualityProfileId)}
                onValueChange={(v) => setQualityProfileId(Number(v))}
              >
                <SelectTrigger id="quality-profile" className="w-[180px] border-0 bg-transparent text-right">
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
          </div>
        </div>

        {/* Series Type */}
        <div className="grouped-section">
          <p className="grouped-section-title">Series Type</p>
          <div className="grouped-section-content">
            <div className="grouped-row">
              <Label htmlFor="series-type" className="text-sm shrink-0">
                Type
              </Label>
              <Select value={seriesType} onValueChange={setSeriesType}>
                <SelectTrigger id="series-type" className="w-[180px] border-0 bg-transparent text-right">
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
        </div>

        {/* Tags */}
        {tags.length > 0 && (
          <div className="grouped-section">
            <p className="grouped-section-title">Tags</p>
            <div className="grouped-section-content">
              <div className="px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  {tags.map((t) => (
                    <Badge
                      key={t.id}
                      variant={selectedTags.includes(t.id) ? 'default' : 'outline'}
                      className="cursor-pointer select-none transition-colors"
                      onClick={() => toggleTag(t.id)}
                    >
                      {t.label}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => router.back()}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={handleSave}
            disabled={saving}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
