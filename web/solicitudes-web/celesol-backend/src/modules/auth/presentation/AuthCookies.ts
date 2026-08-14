import type { CookieOptions, Response } from "express";

import type { AuthTokens } from "../application/dtos/AuthSession.dto";

export const ACCESS_TOKEN_COOKIE = "accessToken";
export const REFRESH_TOKEN_COOKIE = "refreshToken";

export type AuthCookieConfig = {
  accessTokenTtlMinutes: number;
  isProduction: boolean;
  refreshTokenTtlDays: number;
};

function baseCookieOptions(config: AuthCookieConfig): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
  };
}

export function setAuthCookies(
  res: Response,
  tokens: AuthTokens,
  config: AuthCookieConfig,
) {
  res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...baseCookieOptions(config),
    expires: tokens.accessTokenExpiresAt,
    maxAge: config.accessTokenTtlMinutes * 60 * 1000,
  });
  res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...baseCookieOptions(config),
    expires: tokens.refreshTokenExpiresAt,
    maxAge: config.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(res: Response, config: AuthCookieConfig) {
  res.clearCookie(ACCESS_TOKEN_COOKIE, baseCookieOptions(config));
  res.clearCookie(REFRESH_TOKEN_COOKIE, baseCookieOptions(config));
}
