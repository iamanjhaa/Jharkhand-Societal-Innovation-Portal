import express from 'express';
import multer from 'multer';
import authMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();
const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function getSahayakApiUrl() {
  return (process.env.SAHAYAK_API_URL || 'http://localhost:8000').replace(/\/$/, '');
}

router.post('/chat', authMiddleware, async (req, res, next) => {
  const { problem, language } = req.body || {};
  if (typeof problem !== 'string' || !problem.trim()) {
    return res.status(400).json({ success: false, message: 'Problem text cannot be empty' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);
  try {
    const response = await fetch(`${getSahayakApiUrl()}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problem: problem.trim(), language: language === 'hi' ? 'hi' : 'en' }),
      signal: controller.signal,
    });

    router.post('/transcribe', authMiddleware, audioUpload.single('audio'), async (req, res, next) => {
      if (!req.file) return res.status(400).json({ success: false, message: 'Voice recording is required' });
      if (String(process.env.STT_PROVIDER || '').toLowerCase() !== 'openai' || !process.env.STT_API_KEY) {
        return res.status(503).json({ success: false, message: 'Speech transcription service is not configured' });
      }
      const form = new FormData();
      form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname || 'emergency.webm');
      form.append('model', process.env.STT_MODEL || 'whisper-1');
      try {
        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.STT_API_KEY}` },
          body: form,
        });
        const data = await response.json();
        if (!response.ok) return res.status(response.status).json({ success: false, message: data.error?.message || 'Speech transcription failed' });
        return res.json({ success: true, data: { transcript: data.text || '' } });
      } catch (error) {
        return next(error);
      }
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ success: false, message: data.detail || data.message || 'Sahayak request failed' });
    return res.json({ success: true, data });
  } catch (error) {
    if (error.name === 'AbortError') return res.status(504).json({ success: false, message: 'Sahayak took too long to respond' });
    return next(error);
  } finally {
    clearTimeout(timeout);
  }
});

export default router;