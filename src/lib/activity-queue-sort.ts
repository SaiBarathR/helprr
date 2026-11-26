import type {
  ActivitySortDirectionPreference,
  ActivitySortPreference,
} from '@/lib/store';
import { timeLeftSeconds } from '@/lib/media-download-progress';

export interface ActivityQueueSortableItem {
  title?: string;
  size: number;
  sizeleft: number;
  timeleft?: string;
}

export function getDefaultActivitySortDirection(
  sortBy: ActivitySortPreference,
): ActivitySortDirectionPreference {
  return sortBy === 'title' || sortBy === 'timeleft' ? 'asc' : 'desc';
}

export function compareActivityQueueItems(
  a: ActivityQueueSortableItem,
  b: ActivityQueueSortableItem,
  sortBy: ActivitySortPreference,
  direction: ActivitySortDirectionPreference,
): number {
  let comparison: number;

  switch (sortBy) {
    case 'title':
      comparison = (a.title || '').localeCompare(b.title || '');
      break;
    case 'progress': {
      const progressA = a.size > 0 ? (a.size - a.sizeleft) / a.size : 0;
      const progressB = b.size > 0 ? (b.size - b.sizeleft) / b.size : 0;
      comparison = progressA - progressB;
      break;
    }
    case 'timeleft': {
      // By the duration, not the TimeSpan text ("694.01:41" before "1970.04:10");
      // no time left sorts after every known one.
      const leftA = timeLeftSeconds(a.timeleft) ?? Infinity;
      const leftB = timeLeftSeconds(b.timeleft) ?? Infinity;
      comparison = leftA === leftB ? 0 : leftA < leftB ? -1 : 1;
      break;
    }
    case 'size':
      comparison = a.size - b.size;
      break;
    default:
      comparison = 0;
  }

  return direction === 'asc' ? comparison : -comparison;
}
