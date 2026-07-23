import { Router } from 'express';
import * as brandProfileController from '../controllers/brandProfile.controller';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { logoUpload } from '../middleware/upload';

const router = Router();
router.use(authenticateToken);

router.get('/', asyncHandler(brandProfileController.listBrandProfiles));
router.get('/:id', asyncHandler(brandProfileController.getBrandProfile));
router.post('/', logoUpload.single('logo'), asyncHandler(brandProfileController.createBrandProfile));
router.put('/:id', logoUpload.single('logo'), asyncHandler(brandProfileController.updateBrandProfile));
router.delete('/:id', asyncHandler(brandProfileController.deleteBrandProfile));

export default router;
