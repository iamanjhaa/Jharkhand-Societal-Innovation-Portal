import express from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import {
  cancelEmergencyRequest,
  createEmergencyHelper,
  createEmergencyRequest,
  deleteEmergencyHelper,
  getEmergencyHelpers,
  getMyEmergencyRequests,
  updateEmergencyHelper,
  updateEmergencyMode,
} from '../controllers/emergencyController.js';

const router = express.Router();
router.use(authMiddleware);
router.patch('/mode', updateEmergencyMode);
router.get('/helpers', getEmergencyHelpers);
router.post('/helpers', createEmergencyHelper);
router.patch('/helpers/:id', updateEmergencyHelper);
router.delete('/helpers/:id', deleteEmergencyHelper);
router.post('/request', createEmergencyRequest);
router.post('/trigger', createEmergencyRequest);
router.get('/requests/me', getMyEmergencyRequests);
router.patch('/requests/:id/cancel', cancelEmergencyRequest);
export default router;
