/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, Request, Response } from 'express';
import { readStore, writeStore } from '../store/store.js';
import { requireRole } from './auth.js';
import { GigaChatModel } from '../types.js';

export const settingsRouter = Router();

// GET /api/settings
settingsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    const defaultModel = store.config.default_gigachat_model || (process.env.GIGACHAT_DEFAULT_MODEL as GigaChatModel) || 'GigaChat:Lite';
    res.json({
      default_gigachat_model: defaultModel,
      activeModel: defaultModel,
      encryption_active: true,
      yandex_speechkit_configured: !!process.env.YC_SERVICE_ACCOUNT_KEY_FILE,
      gigachat_configured: !!process.env.GIGACHAT_AUTH_KEY,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings
settingsRouter.put('/', requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const { default_gigachat_model } = req.body;
    if (!default_gigachat_model) {
      return res.status(400).json({ error: 'Поле default_gigachat_model обязательно' });
    }

    const validModels: GigaChatModel[] = ['GigaChat:Lite', 'GigaChat:Pro', 'GigaChat:Max', 'GigaChat:Ultra'];
    if (!validModels.includes(default_gigachat_model)) {
      return res.status(400).json({ error: `Недопустимая модель. Допустимые: ${validModels.join(', ')}` });
    }

    const store = await readStore();
    store.config.default_gigachat_model = default_gigachat_model;
    store.config.activeModel = default_gigachat_model;
    await writeStore(store);

    res.json({
      success: true,
      default_gigachat_model: store.config.default_gigachat_model,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
