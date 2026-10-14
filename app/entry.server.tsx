import { PassThrough } from "node:stream";

import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import type { RenderToPipeableStreamOptions } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";
import type { EntryContext, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";

import { startServer } from "./.server/startup";

// Krestrel: boot the market hub when the server build loads (ADR 0004). React Router has no
// documented startup hook; module scope runs once at `react-router-serve` start, and on the first
// request under `react-router dev`. Awaited so requests never see an unmigrated database.
await startServer();

// Below: React Router 8.4 default entry (`react-router reveal entry.server`), with Promise.withResolvers.

export const streamTimeout = 5_000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider,
) {
  // https://httpwg.org/specs/rfc9110.html#HEAD
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    });
  }

  const { promise, resolve, reject } = Promise.withResolvers<Response>();
  let shellRendered = false;
  const userAgent = request.headers.get("user-agent");

  // Ensure requests from bots and SPA Mode renders wait for all content to load before responding
  // https://react.dev/reference/react-dom/server/renderToPipeableStream#waiting-for-all-content-to-load-for-crawlers-and-static-generation
  const readyOption: keyof RenderToPipeableStreamOptions =
    (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? "onAllReady" : "onShellReady";

  // Abort the rendering stream after the `streamTimeout` so it has time to
  // flush down the rejected boundaries
  let timeoutId: NodeJS.Timeout | undefined = setTimeout(() => abort(), streamTimeout + 1000);

  const { pipe, abort } = renderToPipeableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      [readyOption]() {
        shellRendered = true;
        const body = new PassThrough({
          final(callback) {
            // Clear the timeout to prevent retaining the closure and memory leak
            clearTimeout(timeoutId);
            timeoutId = undefined;
            callback();
          },
        });
        const stream = createReadableStreamFromReadable(body);

        responseHeaders.set("Content-Type", "text/html");

        pipe(body);

        resolve(
          new Response(stream, {
            headers: responseHeaders,
            status: responseStatusCode,
          }),
        );
      },
      onShellError(error: unknown) {
        reject(error);
      },
      onError(error: unknown) {
        responseStatusCode = 500;
        // Log streaming rendering errors from inside the shell.  Don't log
        // errors encountered during initial shell rendering since they'll
        // reject and get logged in handleDocumentRequest.
        if (shellRendered) {
          console.error(error);
        }
      },
    },
  );
  return promise;
}
