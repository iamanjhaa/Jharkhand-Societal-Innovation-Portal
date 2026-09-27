import express from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { authorizeRoles } from '../middleware/roleMiddleware.js';
import {
  assignSankalpStudents,
  getSankalpMentors,
  getSankalpStudents,
  registerSankalpMentor,
  submitSankalpChallengeForVerification
} from '../controllers/sankalpController.js';

const router = express.Router();

router.use(authMiddleware, authorizeRoles('university'));
router.get('/mentors', getSankalpMentors);
router.post('/mentors', registerSankalpMentor);
router.get('/students', getSankalpStudents);
router.post('/assign-students', assignSankalpStudents);
router.post('/challenges/:id/submit-for-verification', submitSankalpChallengeForVerification);

export default router;
