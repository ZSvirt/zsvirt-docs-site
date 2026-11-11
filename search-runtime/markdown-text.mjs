import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import { toString } from 'mdast-util-to-string';

const markdown = remark().use(remarkGfm);
const blockContainers = new Set(['root', 'blockquote', 'list', 'listItem', 'table', 'tableRow']);

function readableText(node) {
  if (node.type === 'break') return '\n';
  if (Array.isArray(node.children)) {
    return node.children.map(readableText).join(blockContainers.has(node.type) ? '\n' : '');
  }
  // Code and inlineCode values stay verbatim. HTML is text here, never executable;
  // the final snippet serializer escapes it along with all other source text.
  return toString(node);
}

/** Parse complete Markdown before clipping; formatting delimiters are not text. */
export function markdownText(content) {
  return readableText(markdown.parse(content));
}
