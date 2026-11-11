const TRAILING_PAREN_SUFFIX_RE = /^(.*)\s*[\(（][^）)]*[\)）]\s*$/;

export function stripApiTitleSuffix(title: string): string {
  let current = title.trim();

  while (true) {
    const match = TRAILING_PAREN_SUFFIX_RE.exec(current);
    if (!match) {
      return current;
    }
    current = match[1].trim();
  }
}
