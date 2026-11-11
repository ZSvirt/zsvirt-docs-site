import { remarkStructure, remarkStructureDefaultOptions } from 'fumadocs-core/mdx-plugins/remark-structure';
import { visit } from 'unist-util-visit';

function staticValue(attribute, file) {
  if (!attribute) return undefined;
  if (typeof attribute.value === 'string') return attribute.value;
  const expression = attribute.value?.data?.estree?.body?.[0]?.expression;
  if (expression?.type === 'Literal' && typeof expression.value === 'string') return expression.value;
  if (expression?.type === 'ArrayExpression' && expression.elements.every((item) => item?.type === 'Literal' && typeof item.value === 'string')) {
    return expression.elements.map((item) => item.value);
  }
  file.fail(`Search requires a static APIPage ${attribute.name} value.`, attribute);
}

/** Use Fumadocs' structure extraction, including code and the visible API endpoint. */
export function remarkSearchStructure() {
  const extract = remarkStructure.call(this, {
    types: [...remarkStructureDefaultOptions.types, 'code'],
    exportAs: false,
  });

  return (tree, file) => {
    extract(tree, file);
    const endpoints = [];
    visit(tree, 'mdxJsxFlowElement', (node) => {
      if (node.name !== 'APIPage') return;
      const attribute = (name) => node.attributes.find((item) => item.type === 'mdxJsxAttribute' && item.name === name);
      const path = staticValue(attribute('path'), file);
      const altPaths = staticValue(attribute('altPaths'), file);
      const method = staticValue(attribute('method'), file) ?? 'GET';
      if (typeof method !== 'string' || (path !== undefined && typeof path !== 'string') || (altPaths !== undefined && !Array.isArray(altPaths))) {
        file.fail('APIPage method/path must be strings and altPaths must be a string array.', node);
      }
      if (!path) return;
      for (const endpoint of new Set([path, ...(altPaths ?? [])])) {
        endpoints.push({ content: `${method.toUpperCase()} /zstack${endpoint}\n${endpoint}` });
      }
    });
    file.data.structuredData.contents.unshift(...endpoints);
  };
}
