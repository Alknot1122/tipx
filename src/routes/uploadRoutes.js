const express = require('express');
const router = express.Router();
const multer = require('multer');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client } = require('../config/r2');
const pool = require('../config/db');
const { requireAuth, requireSelf } = require('../middleware/auth');
const crypto = require('crypto');
const rateLimiter = require('../middleware/rateLimiter');

// Rate limiter: Max 10 uploads per 10 minutes per IP
const uploadLimiter = rateLimiter(10 * 60 * 1000, 10, 'Too many uploads. Please wait 10 minutes before trying again.');

// Configure multer — only allow image MIME types
const ALLOWED_MIME = ['image/webp', 'image/jpeg', 'image/png', 'image/gif', 'image/avif'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024 // 25MB limit
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type '${file.mimetype}' is not allowed. Only images (webp, jpeg, png, gif, avif) are accepted.`));
    }
  }
});

// POST /api/dashboard/:slug/upload
router.post('/:slug/upload', uploadLimiter, requireAuth, requireSelf, upload.single('image'), async (req, res) => {
  const { slug } = req.params;
  const { type } = req.query; // 'avatar' or 'background'

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded.' });
    }

    const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;
    const publicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL;

    if (!bucketName || !publicUrl) {
      return res.status(500).json({ error: 'Cloudflare R2 is not fully configured.' });
    }

    // Fetch the old image URL
    try {
      const userRes = await pool.query('SELECT avatar_url, bg_image_url FROM users WHERE slug = $1', [slug]);
      if (userRes.rows.length > 0) {
        const oldUrl = type === 'background' ? userRes.rows[0].bg_image_url : userRes.rows[0].avatar_url;
        const publicBase = publicUrl.replace(/\/$/, '');
        if (oldUrl && oldUrl.startsWith(publicBase)) {
          const oldKey = oldUrl.substring(publicBase.length + 1);
          if (oldKey) {
            await s3Client.send(new DeleteObjectCommand({
              Bucket: bucketName,
              Key: oldKey
            }));
            console.log(`[Upload] Deleted old file: ${oldKey}`);
          }
        }
      }
    } catch (e) {
      console.error('[Upload] Error deleting old file:', e);
    }

    const folder = type === 'background' ? 'backgrounds' : 'avatars';
    const randomSuffix = crypto.randomBytes(4).toString('hex');
    const filename = `${folder}/${slug}_${Date.now()}_${randomSuffix}.webp`;

    let imageBuffer = req.file.buffer;

    try {
      const sharp = require('sharp');
      if (type === 'background') {
        // High quality webp for background, but optimized
        imageBuffer = await sharp(req.file.buffer)
          .webp({ quality: 95, effort: 6 }) // quality 95 is extremely clear
          .toBuffer();
      } else {
        // Avatars can be smaller
        imageBuffer = await sharp(req.file.buffer)
          .resize({ width: 500, height: 500, fit: 'cover' })
          .webp({ quality: 80, effort: 4 })
          .toBuffer();
      }
    } catch (err) {
      console.error('[Upload] Error processing image with sharp, uploading original buffer instead:', err);
      // Fallback to original buffer if sharp fails or is not installed
    }

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: filename,
      Body: imageBuffer,
      ContentType: 'image/webp',
    });

    await s3Client.send(command);

    const imageUrl = `${publicUrl.replace(/\/$/, '')}/${filename}`;
    return res.json({ url: imageUrl });
  } catch (err) {
    console.error('[Upload] Error uploading to R2:', err);
    return res.status(500).json({ error: 'Failed to upload image.' });
  }
});

module.exports = router;
