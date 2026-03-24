export function formatDate(date, locale = 'en-US') {
  if (!date || !(date instanceof Date)) {
    return 'unknown';
  }
  
  return date.toLocaleDateString(locale, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatRelativeTime(date) {
  if (!date || !(date instanceof Date)) {
    return 'unknown';
  }
  
  const now = new Date();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'just now';
}

export function parseTimeString(timeStr) {
  const patterns = [
    /^(\d{1,2}):(\d{2})$/,
    /^(\d{1,2}):(\d{2})\s*(am|pm)$/i,
    /^(\d{1,2})\s*(am|pm)$/i,
  ];
  
  for (const pattern of patterns) {
    const match = timeStr.match(pattern);
    if (match) {
      let hours, minutes = 0;
      
      if (match.length === 3) {
        hours = parseInt(match[1]);
        minutes = parseInt(match[2]);
      } else if (match.length === 2) {
        hours = parseInt(match[1]);
      }
      
      const period = match[match.length - 1]?.toLowerCase();
      if (period === 'pm' && hours < 12) hours += 12;
      if (period === 'am' && hours === 12) hours = 0;
      
      return { hours, minutes };
    }
  }
  
  return null;
}
