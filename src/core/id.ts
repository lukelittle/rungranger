let counter = 0;

/** Generates a short unique id for AST nodes and projects. */
export function newId(prefix = 'n'): string {
  counter = (counter + 1) % 0x7fffffff;
  const rand = Math.floor(Math.random() * 0x7fffffff).toString(36);
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}
