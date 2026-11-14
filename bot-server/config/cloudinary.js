// config/cloudinary.js
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ---- Catalogs (PDFs, and Illustrator files saved as PDF) --------------------------
// The file is held in memory first so its CONTENT can be checked before anything is
// stored (utils/fileKind.js): the previous setup streamed straight to Cloudinary and
// only looked at the file's extension, so anything named "x.pdf" became a catalog — and
// a catalog is a file the bot hands to customers. `req.file` keeps the shape the routes
// already use: `path` (the URL), `filename` (the Cloudinary public id), `originalname`.
const { fileKind } = require('../utils/fileKind');
const CATALOG_KINDS = new Set(['pdf', 'postscript']);

function catalogPublicId(originalname) {
  const base = String(originalname || 'catalogo');
  const name = base.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 120) || 'catalogo';
  const ext = (base.match(/\.([^/.]+)$/)?.[1] || 'pdf').toLowerCase();
  return `${name}_${Date.now()}.${ext === 'ai' ? 'ai' : 'pdf'}`;
}

function storeCatalog(buffer, originalname) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'hanlob/catalogs', resource_type: 'raw', public_id: catalogPublicId(originalname) },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

const catalogMemory = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB max

// Same call shape as a multer instance: uploadCatalog.single('catalog').
const uploadCatalog = {
  single(field) {
    const parse = catalogMemory.single(field);
    return (req, res, next) => parse(req, res, async (err) => {
      if (err) return next(err);
      if (!req.file) return next(); // the route answers "No file uploaded"
      if (!CATALOG_KINDS.has(fileKind(req.file.buffer))) {
        return res.status(400).json({ success: false, error: 'El archivo no es un PDF válido.' });
      }
      try {
        const result = await storeCatalog(req.file.buffer, req.file.originalname);
        req.file.path = result.secure_url;
        req.file.filename = result.public_id;
        delete req.file.buffer;
        next();
      } catch (e) { next(e); }
    });
  },
};

// Storage for images
const imageStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'hanlob/images',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 1200, height: 1200, crop: 'limit' }]
  }
});

// Multer upload instances
const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB max
});

// Delete file from Cloudinary
async function deleteFile(publicId, resourceType = 'raw') {
  try {
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    return result;
  } catch (error) {
    console.error('Error deleting file from Cloudinary:', error);
    throw error;
  }
}

module.exports = {
  cloudinary,
  uploadCatalog,
  storeCatalog,
  catalogPublicId,
  uploadImage,
  deleteFile
};
