import { createContext } from "react";

// Radix portals keep React context, even though they render outside the shell.
export const WorkspaceTheme = createContext(false);
