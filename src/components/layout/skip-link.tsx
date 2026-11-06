'use client';

// First focusable element of the app, so keyboard users can jump past the
// sidebar. Focuses <main id="main"> directly instead of following the hash:
// a #main left in the URL would sit in history and change scroll restoration.
// The tabindex lasts only until focus leaves: a permanent one would make every
// click inside <main> focus it (Tab restarts at the top, and Safari's
// tap-to-blur menus such as the rating control would close early).
export function SkipLink() {
  return (
    <a
      href="#main"
      onClick={(event) => {
        const main = document.getElementById('main');
        if (!main) return;
        event.preventDefault();
        main.setAttribute('tabindex', '-1');
        main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true });
        main.focus();
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:left-[calc(env(safe-area-inset-left)+0.75rem)] focus:top-[calc(env(safe-area-inset-top)+0.75rem)] focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg focus:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      Skip to content
    </a>
  );
}
