import { createContext } from "react";

export interface CanvasRenderError {
  revision: number;
  filename: string;
  message: string;
  stack?: string;
  componentStack?: string;
}

export const RenderErrorContext = createContext<(error: CanvasRenderError) => void>(() => {});
