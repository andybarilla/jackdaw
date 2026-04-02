export interface UrlMatch {
  url: string;
  start: number;
  end: number;
}

const URL_REGEX = /https?:\/\/[^\s"'`>\])]*/g;

export function extractUrlsFromText(text: string | null | undefined): UrlMatch[] {
  if (!text) return [];

  const matches: UrlMatch[] = [];
  let match: RegExpExecArray | null;

  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match[0].length > 8) {
      matches.push({
        url: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  return matches;
}
