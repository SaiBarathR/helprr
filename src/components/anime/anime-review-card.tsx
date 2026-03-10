'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Star, ChevronDown, ChevronUp, ThumbsUp } from 'lucide-react';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import type { AniListReview } from '@/types/anilist';

interface AnimeReviewCardProps {
  reviews: AniListReview[];
}

export function AnimeReviewCard({ reviews }: AnimeReviewCardProps) {
  if (!reviews.length) return null;

  return (
    <div>
      <h2 className="text-base font-semibold mb-2">Reviews</h2>
      <div className="space-y-3">
        {reviews.map((review) => (
          <ReviewItem key={review.id} review={review} />
        ))}
      </div>
    </div>
  );
}

function ReviewItem({ review }: { review: AniListReview }) {
  const [expanded, setExpanded] = useState(false);
  const avatarSrc = review.user.avatar.large || review.user.avatar.medium;
  const imgSrc = avatarSrc
    ? toCachedImageSrc(avatarSrc, 'anilist') || avatarSrc
    : null;

  return (
    <div className="rounded-lg border border-border/40 bg-muted/20 p-3">
      <div className="flex items-center gap-2 mb-2">
        <div className="relative w-7 h-7 rounded-full overflow-hidden bg-muted shrink-0">
          {imgSrc ? (
            <Image
              src={imgSrc}
              alt={review.user.name}
              fill
              sizes="28px"
              className="object-cover"
              unoptimized={isProtectedApiImageSrc(imgSrc)}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-[10px]">
              {review.user.name.charAt(0)}
            </div>
          )}
        </div>
        <span className="text-sm font-medium">{review.user.name}</span>
        {review.score > 0 && (
          <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground ml-auto">
            <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
            {review.score}/100
          </span>
        )}
      </div>
      <p className={`text-sm text-muted-foreground ${expanded ? '' : 'line-clamp-3'}`}>
        {review.summary}
      </p>
      <div className="flex items-center gap-3 mt-2">
        {review.summary.length > 150 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-primary inline-flex items-center gap-0.5"
          >
            {expanded ? (
              <>Show less <ChevronUp className="h-3 w-3" /></>
            ) : (
              <>Read more <ChevronDown className="h-3 w-3" /></>
            )}
          </button>
        )}
        {review.rating > 0 && (
          <span className="text-[11px] text-muted-foreground inline-flex items-center gap-0.5 ml-auto">
            <ThumbsUp className="h-3 w-3" />
            {review.rating}/{review.ratingAmount}
          </span>
        )}
      </div>
    </div>
  );
}
