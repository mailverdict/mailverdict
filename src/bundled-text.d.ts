// Wrangler "Text" rule imports (see wrangler.toml): .txt/.yaml imports
// resolve to the file's contents as a string in the worker bundle.
declare module '*.txt' {
  const content: string
  export default content
}
declare module '*.yaml' {
  const content: string
  export default content
}
