export function isPreviewableFile(path: string | null | undefined): boolean {
  if (!path) return false;
  return path.toLowerCase().endsWith('.md');
}
