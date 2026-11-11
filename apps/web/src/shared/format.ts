// Omitted locale and time zone intentionally retain the browser's display settings.
export function localDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

export function retainedDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : localDateTime(value);
}
