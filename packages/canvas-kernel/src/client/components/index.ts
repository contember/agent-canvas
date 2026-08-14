// Components every canvas host provides. Hosts that ship extra components
// compose their own `#canvas/components` barrel over this one.
export { Section } from "./Section";
export { Item, Task } from "./Task";
export { CodeBlock } from "./CodeBlock";
export { Callout } from "./Callout";
export { Note } from "./Note";
export { Table } from "./Table";
export { Checklist } from "./Checklist";
export { Priority } from "./Priority";
export { FilePreview } from "./FilePreview";
export { Mermaid } from "./Mermaid";
export { Diff } from "./Diff";
export { Choice, MultiChoice } from "./Choice";
export { UserInput, RangeInput } from "./UserInput";
export { ImageView } from "./Image";
export { Markdown } from "./Markdown";
export { useFeedback } from "#canvas/runtime";
