import type { Request, Response, NextFunction } from 'express';
import type { AppConfig } from '../../core/config.js';

/**
 * Admin auth middleware. Checks Authorization: Bearer <secret> header
 * or admin_session cookie. Skips auth for /admin/login and /admin/logout.
 */
export function adminAuth(config: AppConfig) {
  const secret = config.ADMIN_SECRET!;

  return (req: Request, res: Response, next: NextFunction) => {
    // Public routes
    if (req.path === '/admin/login' || req.path === '/admin/logout') {
      next();
      return;
    }

    // Check Bearer token
    const authHeader = req.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      if (token === secret) {
        next();
        return;
      }
    }

    // Check cookie (set by cookie-parser)
    const cookie = (req as unknown as { cookies?: Record<string, string> })
      .cookies;
    if (cookie?.['admin_session'] === secret) {
      next();
      return;
    }

    // Not authenticated
    const isHtml =
      req.headers['accept']?.includes('text/html') &&
      !req.headers['hx-request'];
    if (isHtml) {
      res.redirect('/admin/login');
      return;
    }
    res.status(401).json({ error: 'Unauthorized' });
  };
}
