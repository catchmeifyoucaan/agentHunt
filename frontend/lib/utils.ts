import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleString();
}

export function formatRelativeTime(date: string | Date): string {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(date);
}

export function getSeverityColor(severity: string): string {
  switch (severity.toLowerCase()) {
    case 'critical':
      return 'text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-400';
    case 'high':
      return 'text-orange-600 bg-orange-50 dark:bg-orange-950 dark:text-orange-400';
    case 'medium':
      return 'text-yellow-600 bg-yellow-50 dark:bg-yellow-950 dark:text-yellow-400';
    case 'low':
      return 'text-blue-600 bg-blue-50 dark:bg-blue-950 dark:text-blue-400';
    default:
      return 'text-gray-600 bg-gray-50 dark:bg-gray-950 dark:text-gray-400';
  }
}

export function getStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'active':
    case 'completed':
    case 'confirmed':
      return 'text-green-600 bg-green-50 dark:bg-green-950 dark:text-green-400';
    case 'pending':
    case 'new':
      return 'text-blue-600 bg-blue-50 dark:bg-blue-950 dark:text-blue-400';
    case 'failed':
    case 'error':
      return 'text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-400';
    case 'cancelled':
    case 'false_positive':
      return 'text-gray-600 bg-gray-50 dark:bg-gray-950 dark:text-gray-400';
    default:
      return 'text-gray-600 bg-gray-50 dark:bg-gray-950 dark:text-gray-400';
  }
}
