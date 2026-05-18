import express from 'express';
import request from 'supertest';
import sharp from 'sharp';
import { upload, validateImageUpload } from '../middlewares/multer.middleware.js';
import { uploadOnCloudinary } from '../utils/cloudinary.js';
import { logger } from '../utils/logger.js';

jest.mock('cloudinary', () => ({
  v2: { uploader: { upload: jest.fn().mockResolvedValue({ secure_url: 'https://example.com/test.jpg', public_id: 'public123' }) } }
}));

// silence logger in tests
jest.mock('../utils/logger.js', () => ({ logger: { log: () => {}, warn: () => {}, error: () => {} } }));

describe('Upload security middleware', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.post('/test/upload', upload.single('media'), validateImageUpload, async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ success: false });

        // simulate controller uploading processed buffer if present
        if (req.file.processedBuffer) {
          const result = await uploadOnCloudinary({ buffer: req.file.processedBuffer, mimetype: req.file.processedMimetype, secureFilename: req.file.secureFilename, originalname: req.file.originalname });
          return res.status(200).json({ success: true, url: result?.url || result?.secure_url });
        }

        return res.status(400).json({ success: false });
      } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message });
      }
    });

    // error handler to translate multer errors
    app.use((err, req, res, next) => {
      if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ success: false, message: 'File too large' });
      return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'error' });
    });
  });

  const createImageBuffer = async (format = 'png') => {
    const img = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ffffff' } })
      [format]()
      .toBuffer();
    return img;
  };

  test.each([['png'], ['jpeg'], ['jpg'], ['webp']])('accepts valid %s images', async (fmt) => {
    const buf = await createImageBuffer(fmt === 'jpg' ? 'jpeg' : fmt);
    const res = await request(app)
      .post('/test/upload')
      .attach('media', buf, `avatar.${fmt}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('blocks php file', async () => {
    const phpBuf = Buffer.from('<?php echo "pwned"; ?>');
    const res = await request(app).post('/test/upload').attach('media', phpBuf, 'evil.php');
    expect([400, 415]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });

  test('blocks svg with scripts', async () => {
    const svg = Buffer.from('<svg><script>alert(1)</script></svg>');
    const res = await request(app).post('/test/upload').attach('media', svg, 'bad.svg');
    expect([400, 415]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });

  test('blocks double-extension image.php.png', async () => {
    const buf = await createImageBuffer('png');
    const res = await request(app).post('/test/upload').attach('media', buf, 'image.php.png');
    expect([400, 415]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });

  test('blocks fake mime type (php content but image/png mimetype)', async () => {
    const phpBuf = Buffer.from('<?php // backdoor ?>');
    const res = await request(app)
      .post('/test/upload')
      .attach('media', phpBuf, { filename: 'fake.png', contentType: 'image/png' });
    expect([400, 415]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });

  test('blocks oversized file (>5MB)', async () => {
    const big = Buffer.alloc((5 * 1024 * 1024) + 1024, 0xff);
    const res = await request(app).post('/test/upload').attach('media', big, 'big.png');
    expect([413, 400, 415]).toContain(res.status);
  });

  test('blocks corrupted image', async () => {
    const buf = Buffer.from('not-a-valid-image');
    const res = await request(app).post('/test/upload').attach('media', buf, 'corrupt.png');
    expect([400, 415]).toContain(res.status);
  });

  test('malicious uploads never reach Cloudinary', async () => {
    const cloudinary = await import('cloudinary');
    cloudinary.v2.uploader.upload.mockClear();

    const bad = Buffer.from('<?php printf("x"); ?>');
    await request(app).post('/test/upload').attach('media', bad, 'evil.php');

    expect(cloudinary.v2.uploader.upload).not.toHaveBeenCalled();
  });
});
