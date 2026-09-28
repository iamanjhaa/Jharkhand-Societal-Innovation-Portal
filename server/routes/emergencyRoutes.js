import express from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import {
  cancelEmergencyRequest,
  createEmergencyHelper,
  createEmergencyRequest,
  deleteEmergencyHelper,
  getSmsConfigurationDiagnostics,
  getActiveEmergency,
  getEmergencyHelpers,
  getMyEmergencyRequests,
  resolveEmergencyRequest,
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
router.post('/create', createEmergencyRequest);
router.get('/sms-config', getSmsConfigurationDiagnostics);
router.post('/request', createEmergencyRequest);
router.post('/trigger', createEmergencyRequest);
router.get('/active', getActiveEmergency);
router.get('/requests/me', getMyEmergencyRequests);
router.get('/history', getMyEmergencyRequests);
router.post('/resolve/:id', resolveEmergencyRequest);
router.post('/requests/:id/resolve', resolveEmergencyRequest);
router.patch('/requests/:id/cancel', cancelEmergencyRequest);
export default router;
