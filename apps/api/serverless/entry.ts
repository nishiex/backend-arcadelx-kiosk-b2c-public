// Vercel serverless entry point.
//
// Vercel has no long-running port, so it cannot use server.ts (which calls app.listen).
// scripts/build-vercel.mjs bundles this file into api/index.mjs, the location Vercel
// requires for a Function. Vercel executes the bundle, not this file.
//
// The app is imported dynamically and memoised so a cold start pays the module cost once
// and warm invocations reuse the same instance.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Express } from "express";

let cached: Promise<Express> | undefined;

function loadApp(): Promise<Express> {
  cached ??= import("../src/app.js").then((module) => module.default as Express);
  return cached;
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  const app = await loadApp();
  return app(request as never, response as never);
}
