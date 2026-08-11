import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { config } from './config';

const COOKIE_NAME = 'image_studio_session';
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const sessions = new Set<string>();

function sameText(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function matchesPassword(password: string, storedHash: string) {
  const [algorithm, salt, expectedHex] = storedHash.split('$');
  if (algorithm !== 'scrypt' || !salt || !expectedHex || !/^[a-f\d]+$/i.test(expectedHex)) return false;

  const expected = Buffer.from(expectedHex, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sessionFrom(req: Request) {
  const cookie = req.headers.cookie?.split(';').map((item) => item.trim())
    .find((item) => item.startsWith(`${COOKIE_NAME}=`));
  return cookie ? decodeURIComponent(cookie.slice(COOKIE_NAME.length + 1)) : '';
}

function sessionCookie(value: string, maxAge: number) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAge / 1000)}${secure}`;
}

export const authRouter = Router();

authRouter.get('/status', (req, res) => {
  res.json({ authenticated: sessions.has(sessionFrom(req)) });
});

authRouter.post('/login', (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!sameText(username, config.authUsername) || !matchesPassword(password, config.authPasswordHash)) {
    res.status(401).json({ error: 'Tài khoản hoặc mật khẩu không đúng.' });
    return;
  }

  const sessionId = randomBytes(32).toString('hex');
  sessions.add(sessionId);
  res.setHeader('Set-Cookie', sessionCookie(sessionId, SESSION_MAX_AGE_MS));
  res.json({ authenticated: true });
});

authRouter.post('/logout', (req, res) => {
  sessions.delete(sessionFrom(req));
  res.setHeader('Set-Cookie', sessionCookie('', 0));
  res.json({ authenticated: false });
});

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (sessions.has(sessionFrom(req))) {
    next();
    return;
  }
  res.status(401).json({ error: 'Vui lòng đăng nhập.' });
}
