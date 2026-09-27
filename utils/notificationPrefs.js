// utils/notificationPrefs.js
// Pure mapping from a notification `type` to its user-preference key. Kept
// dependency-free (no DB import) so it can be unit-tested in isolation and
// reused by the notification service.

const TYPE_TO_PREF = {
  reactions: 'reactions',
  gift: 'gifts',
  theme_unlock: 'themes',
  reply: 'replies',
  reply_like: 'reply_likes',
  announcement: 'announcements',
  poll: 'polls',
  premium: 'account_status',
  account_status: 'account_status'
};

/** Map a notification type to its preference key (falls back to the type). */
export function mapTypeToPreferenceKey(type) {
  return TYPE_TO_PREF[type] || type;
}
