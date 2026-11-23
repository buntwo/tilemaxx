import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

export type ApiCredentials = {
  token: string;
  browserPassword: string;
};

const digest = (value: string) => createHash("sha256").update(value).digest();

export function apiAuthentication(credentials?: ApiCredentials) {
  if (
    credentials &&
    (!/^[a-fA-F0-9]{64}$/.test(credentials.token) ||
      !/^[a-fA-F0-9]{64}$/.test(credentials.browserPassword) ||
      credentials.token.toLowerCase() ===
        credentials.browserPassword.toLowerCase())
  ) {
    throw new Error(
      "Set TILEMAXX_API_TOKEN and TILEMAXX_WEB_PASSWORD to distinct 64-character hex secrets.",
    );
  }
  const token = credentials && digest(credentials.token);
  const browser =
    credentials && digest(`tilemaxx:${credentials.browserPassword}`);
  const bearer: RequestHandler = (req, res, next) => {
    if (!token) {
      res.status(404).json({ error: "The programmatic API is disabled." });
      return;
    }
    const match = /^Bearer ([a-fA-F0-9]{64})$/i.exec(
      req.get("authorization") ?? "",
    );
    if (match && timingSafeEqual(digest(match[1]), token)) {
      next();
      return;
    }
    res.setHeader("WWW-Authenticate", 'Bearer realm="Tilemaxx API"');
    res.status(401).json({ error: "A valid API token is required." });
  };
  const web: RequestHandler = (req, res, next) => {
    if (!browser) {
      next();
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    const match = /^Basic ([A-Za-z0-9+/]{98}==)$/i.exec(
      req.get("authorization") ?? "",
    );
    if (
      match &&
      timingSafeEqual(
        digest(Buffer.from(match[1], "base64").toString("utf8")),
        browser,
      )
    ) {
      next();
      return;
    }
    res.setHeader(
      "WWW-Authenticate",
      'Basic realm="Tilemaxx", charset="UTF-8"',
    );
    res.status(401).json({ error: "Sign in to Tilemaxx." });
  };
  return { bearer, web };
}
