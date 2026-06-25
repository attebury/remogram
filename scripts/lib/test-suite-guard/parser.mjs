/** @param {string} source */
export function extractTopLevelDescribes(source) {
  const names = [];
  for (const line of source.split('\n')) {
    const match = line.match(/^describe\(['"]([^'"]+)['"]/);
    if (match) names.push(match[1]);
  }
  return names;
}

/**
 * @param {string} source
 * @returns {{ name: string, itCount: number, expectCount: number }[]}
 */
export function extractDescribeBlocks(source) {
  const lines = source.split('\n');
  /** @type {{ name: string, itCount: number, expectCount: number }[]} */
  const blocks = [];
  /** @type {string | null} */
  let currentName = null;
  let itCount = 0;
  let expectCount = 0;

  const flush = () => {
    if (currentName !== null) {
      blocks.push({ name: currentName, itCount, expectCount });
    }
    currentName = null;
    itCount = 0;
    expectCount = 0;
  };

  for (const line of lines) {
    const describeMatch = line.match(/^describe\(['"]([^'"]+)['"]/);
    if (describeMatch) {
      flush();
      currentName = describeMatch[1];
      continue;
    }
    if (currentName !== null) {
      if (/^\s+(it|test)\(/.test(line)) {
        itCount += 1;
      }
      if (/^\s+expect\(/.test(line)) {
        expectCount += 1;
      }
    }
  }
  flush();
  return blocks;
}
