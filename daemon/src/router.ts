export type RouteHandler = (req: Request, url: URL, match: URLPatternResult) => Response | Promise<Response>;

export interface Route {
  method: string;
  pattern: URLPattern;
  handler: RouteHandler;
}

export function dispatch(routes: Route[], req: Request, url: URL): Response | Promise<Response> | null {
  for (const route of routes) {
    if (route.method !== req.method) continue;
    const match = route.pattern.exec(url);
    if (match) return route.handler(req, url, match);
  }
  return null;
}
