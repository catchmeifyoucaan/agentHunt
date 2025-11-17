import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format, formatDistanceToNow } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | number | Date): string {
  return format(new Date(date), 'PPpp');
}

export function formatRelativeTime(date: string | number | Date): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

export function getSeverityColor(severity: string): string {
  switch (severity.toLowerCase()) {
    case 'critical':
      return 'text-red-500';
    case 'high':
      return 'text-orange-500';
    case 'medium':
      return 'text-yellow-500';
    case 'low':
      return 'text-blue-500';
    default:
      return 'text-gray-500';
  }
}
