import { isIosDevice } from '@/lib/push-availability';

/**
 * Hand a downloaded file to the user. iOS (where an <a download> of a blob is
 * unreliable in the home-screen app) gets the share sheet, so it can go to
 * Files; elsewhere, or when sharing is unavailable, an ordinary download. The
 * object URL is revoked a moment later: WebKit can drop a download whose URL
 * is revoked in the same tick. Resolves 'cancelled' when the user closes the
 * share sheet.
 */
export async function saveFile(blob: Blob, filename: string): Promise<'saved' | 'cancelled'> {
  if (isIosDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints) && 'share' in navigator) {
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return 'saved';
      } catch (error) {
        if ((error as Error).name === 'AbortError') return 'cancelled';
        // Fall through to a plain download.
      }
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  return 'saved';
}
