import type {
  ActivitySortDirectionPreference,
  ActivitySortPreference,
} from '@/lib/store';

export interface ActivityQueueSortableItem {
  title?: string;
  size: number;
  sizeleft: number;
  timeleft?: string;
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
    case 'timeleft':
      comparison = (a.timeleft || 'zz').localeCompare(b.timeleft || 'zz');
      break;
    case 'size':
      comparison = a.size - b.size;
      break;
    default:
      comparison = 0;
  }

  return direction === 'asc' ? comparison : -comparison;
}
