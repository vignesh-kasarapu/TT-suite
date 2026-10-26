// Ambient types for the tests package (typecheck only).
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
declare module '*.json' {
  const value: Record<string, string>;
  export default value;
}
