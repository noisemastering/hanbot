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

// Storage for catalogs (PDFs and AI files saved as PDF)
const catalogStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'hanlob/catalogs',
    resource_type: 'raw', // Required for PDFs
    allowed_formats: ['pdf', 'ai'],  // AI files created in Illustrator but saved as PDF
    public_id: (req, file) => {
      const timestamp = Date.now();
      const name = file.originalname.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9]/g, '_');
      return `${name}_${timestamp}`;
    }
  }
});

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
const uploadCatalog = multer({
  storage: catalogStorage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

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
  uploadImage,
  deleteFile
};
