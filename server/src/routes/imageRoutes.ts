import { Router } from 'express';
import * as controller from '../controllers/imageController';
import { uploadImages } from '../middleware/upload';

const router = Router();

// Upload Session endpoints
router.post('/sessions', controller.createSession);
router.get('/sessions/:id', controller.getSession);
router.get('/sessions/:id/events', controller.streamEvents);

// Session Images endpoints
router.post('/sessions/:id/images', uploadImages, controller.uploadImages);
router.get('/sessions/:id/images', controller.getSessionImages);
router.get('/sessions/:id/images/:imageId', controller.getImage);
router.delete('/sessions/:id/images/:imageId', controller.deleteImage);

// Pipeline Status & Variants endpoints (Part 2)
router.get('/images/:id/status', controller.getImageStatus);
router.get('/images/:id', controller.getImageStatus);
router.post('/images/:id/reprocess', controller.reprocess);
router.get('/images/:id/variants/:type', controller.serveVariantFile);

// Image asset file delivery endpoint
router.get('/images/:id/file', controller.serveImageFile);

export default router;
