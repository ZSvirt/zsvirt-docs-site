// Keep summaries useful without making each table cell a separate search result.
export const MAX_SEARCH_BLOCK_LENGTH = 2_000;

export function compactSearchContent(structuredData) {
  const contents = [];
  for (const item of structuredData.contents) {
    const previous = contents.at(-1);
    if (previous && previous.heading === item.heading && previous.content.length + item.content.length + 1 <= MAX_SEARCH_BLOCK_LENGTH) {
      previous.content += `\n${item.content}`;
    } else {
      // A single code block remains intact; never truncate or silently discard text.
      contents.push({ ...item });
    }
  }
  return { headings: structuredData.headings.map((heading) => ({ ...heading })), contents };
}
