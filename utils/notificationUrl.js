// utils/notificationUrl.js
// Pure URL helper for push notifications. Kept dependency-free so it can be
// unit-tested in isolation (the OneSignal service imports the DB layer, which
// opens a live pool at import time and can't be pulled into tests).

export const SITE_ORIGIN = 'https://www.cherrish.in';

// OneSignal's web_url MUST be an absolute URL. Our notification data.url values
// are relative deep-links (e.g. "/?confession=<id>"), so prefix them with the
// site origin. Absolute URLs are passed through unchanged.
export function toAbsoluteUrl(url) {
  if (!url) return SITE_ORIGIN;
  if (/^https?:\/\//i.test(url)) return url;
  return `${SITE_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`;
}
