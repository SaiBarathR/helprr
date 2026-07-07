'use client';

import { useState } from 'react';
import { ApiError, jsonFetcher, withInstanceQuery } from '@/lib/query-fetch';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
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
import { TagSelector } from '@/components/media/tag-selector';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { invalidateMovies } from '@/lib/query-invalidation';
import { useQualityProfiles, useRootFolders } from '@/lib/hooks/use-reference-data';
import type { RadarrMovie } from '@/types';
import { parentPath, lastPathSegment, joinPath } from '@/lib/paths';

export default function MovieEditPage() {
  const { id } = useParams();
  const router = useRouter();
  const instance = useSearchParams().get('instance') ?? undefined;
  const queryClient = useQueryClient();
  const movieId = Number(id);

  const movieQuery = useQuery({
    queryKey: queryKeys.detail('radarr', movieId, instance),
    queryFn: jsonFetcher<RadarrMovie>(`/api/radarr/${movieId}`, instance),
    enabled: Number.isFinite(movieId),
  });
  const movie = movieQuery.data ?? null;
  const loading = movieQuery.isLoading;

  const { data: qualityProfiles = [] } = useQualityProfiles('radarr', instance);
  const { data: rootFolders = [] } = useRootFolders('radarr', instance);

  // Edit form state
  const [qualityProfileId, setQualityProfileId] = useState<number>(0);
  const [minimumAvailability, setMinimumAvailability] = useState('');
  const [rootFolder, setRootFolder] = useState('');
  const [selectedTags, setSelectedTags] = useState<number[]>([]);

  // Seed the form once the movie loads (and re-seed if the cached movie
  // changes). Guarded during render.
  const [seededMovie, setSeededMovie] = useState<RadarrMovie | null>(null);
  if (movie && movie !== seededMovie) {
    setSeededMovie(movie);
    setQualityProfileId(movie.qualityProfileId);
    setMinimumAvailability(movie.minimumAvailability);
    setSelectedTags([...movie.tags]);
    setRootFolder(movie.path ? parentPath(movie.path) : '');
  }

  const saveMutation = useMutation({
    mutationFn: async (updatedMovie: RadarrMovie) => {
      const res = await fetch(withInstanceQuery(`/api/radarr/${updatedMovie.id}`, instance), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedMovie),
      });
      // ApiError (not a plain Error) so a 401 carries its status to the global
      // MutationCache handler, which redirects to /login.
      if (!res.ok) throw new ApiError(res.status, 'Failed to update movie');
    },
    onSuccess: (_data, updatedMovie) => {
      invalidateMovies(queryClient, { itemId: updatedMovie.id, instanceId: instance });
      toast.success('Movie updated');
      router.back();
    },
    onError: (err) => {
      // 401 is handled globally (redirect to /login); only toast other failures.
      if (err instanceof ApiError && err.status === 401) return;
      toast.error('Failed to update movie');
    },
  });
  const saving = saveMutation.isPending;

  function handleSave() {
    if (!movie) return;

    const updatedMovie: RadarrMovie = {
      ...movie,
      qualityProfileId,
      minimumAvailability,
      tags: selectedTags,
    };

    // Update root folder path if changed
    if (rootFolder && movie.path) {
      updatedMovie.path = joinPath(rootFolder, lastPathSegment(movie.path));
    }

    saveMutation.mutate(updatedMovie);
  }

  if (loading && !movie) {
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
      <PageHeader title={`Edit ${movie.title}`} />

      <div className="px-4 space-y-6 mt-4 pb-8">
        {/* Settings Section */}
        <div className="grouped-section">
          <div className="grouped-section-title">Settings</div>
          <div className="grouped-section-content">
            {/* Quality Profile */}
            <div className="grouped-row">
              <Label className="text-sm shrink-0">Quality Profile</Label>
              <Select
                value={String(qualityProfileId)}
                onValueChange={(v) => setQualityProfileId(Number(v))}
              >
                <SelectTrigger className="w-[180px]">
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

            {/* Minimum Availability */}
            <div className="grouped-row">
              <Label className="text-sm shrink-0">Minimum Availability</Label>
              <Select
                value={minimumAvailability}
                onValueChange={setMinimumAvailability}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Select availability" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="announced">Announced</SelectItem>
                  <SelectItem value="inCinemas">In Cinemas</SelectItem>
                  <SelectItem value="released">Released</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Root Folder */}
            {rootFolders.length > 0 && (
              <div className="grouped-row">
                <Label className="text-sm shrink-0">Root Folder</Label>
                <Select value={rootFolder} onValueChange={setRootFolder}>
                  <SelectTrigger className="w-[180px]">
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
        </div>

        {/* Tags Section */}
        <div className="grouped-section">
          <div className="grouped-section-title">Tags</div>
          <div className="grouped-section-content">
            <div className="grouped-row">
              <TagSelector
                service="radarr"
                instanceId={instance}
                value={selectedTags}
                onChange={setSelectedTags}
              />
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 pt-2">
          <Button
            className="flex-1"
            onClick={handleSave}
            disabled={saving}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => router.back()}
            disabled={saving}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
