import express from 'express';
import { csrf, requireAuth, createLimiter } from '../../auth.js';
import { loginRoute, sessionRoutes } from './session.js';
import { generalRoutes } from './general.js';
import { eventRoutes } from './events.js';
import { dailyMenuRoutes } from './dailyMenus.js';
import { menuRoutes } from './menu.js';
import { galleryRoutes } from './gallery.js';

export function adminApi(ctx) {
  const r = express.Router();
  const limiter = createLimiter(ctx.nowMs);
  r.use(express.json({ limit: '1mb' }));
  r.use(csrf);
  r.use(loginRoute({ ...ctx, limiter }));
  r.use(requireAuth(ctx));
  r.use(sessionRoutes(ctx));
  r.use(generalRoutes(ctx));
  r.use('/events', eventRoutes(ctx));
  r.use('/daily-menus', dailyMenuRoutes(ctx));
  r.use('/menu', menuRoutes(ctx));
  r.use('/gallery', galleryRoutes(ctx));
  return r;
}
