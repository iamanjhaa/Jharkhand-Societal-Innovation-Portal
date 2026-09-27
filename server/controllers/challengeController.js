import Challenge from '../models/Challenge.js';
import User from '../models/User.js';
import Project from '../models/Project.js';
import mongoose from 'mongoose';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isAllowedChallengeType, challengeUploadDirectory } from '../middleware/challengeUpload.js';
import { UNIVERSITY_ASSIGNMENT_DEPARTMENTS, SANKALP_CLUB } from '../constants/universityDepartments.js';
import { normalizeInstitution } from '../utils/universityCoordinatorCodes.js';
import { createNotification } from '../utils/notifications.js';

function deriveCitizenWorkflowStatus(challenge, project) {
  if (challenge.status === 'resolved' || challenge.status === 'completed') return 'PROBLEM SOLVED';
  if (project?.currentStage === 'completed' || project?.status === 'completed') return 'AWAITING GOVERNMENT VERIFICATION';
  if (project?.currentStage === 'deployed' || project?.status === 'deployed') return 'DEPLOYED';
  if (project?.currentStage === 'testing' || project?.status === 'testing') return 'TESTING';
  if (project) return 'IN DEVELOPMENT';
  if (challenge.industryFundingStatus === 'accepted') return 'FUNDING ACCEPTED';
  if (challenge.department === SANKALP_CLUB) {
    if (challenge.status === 'under_review') return 'AWAITING GOVERNMENT VERIFICATION';
    if (challenge.status === 'approved') return 'GOVERNMENT VERIFIED';
    if (challenge.studentsAssigned) return 'IN DEVELOPMENT';
    if (challenge.departmentMentor) return 'SANKALP MENTOR ASSIGNED';
    return 'SANKALP CLUB ASSIGNED';
  }
  if (challenge.department) return 'AWAITING INDUSTRY FUNDING';
  if (challenge.assignmentStatus === 'accepted') return 'UNIVERSITY ACCEPTED';
  if (challenge.assignedUniversity) return 'UNIVERSITY ASSIGNED';
  if (challenge.status === 'approved') return 'GOVERNMENT VERIFIED';
  return 'UNDER GOVERNMENT REVIEW';
}

function serializeCitizenChallenge(challenge, project) {
  if (!challenge) return null;
  return {
    _id: challenge._id,
    title: challenge.title,
    description: challenge.description,
    district: challenge.district,
    status: deriveCitizenWorkflowStatus(challenge, project),
    rawStatus: challenge.status,
    submittedBy: challenge.submittedBy,
    assignmentStatus: challenge.assignmentStatus,
    assignedUniversity: challenge.assignedUniversity,
    acceptedByUniversity: challenge.acceptedByUniversity,
    department: challenge.department,
    departmentMentor: challenge.departmentMentor,
    mentorAssigned: Boolean(challenge.departmentMentor),
    studentsAssigned: Boolean(challenge.studentsAssigned),
    selectedStudents: (challenge.selectedStudents || []).map((selection) => ({
      studentId: selection.studentId,
      organization: selection.organization,
      selectedAt: selection.selectedAt
    })),
    industryFundingStatus: challenge.industryFundingStatus,
    industryFundedBy: challenge.industryFundedBy,
    project: project ? {
      _id: project._id,
      title: project.title,
      progressPercentage: project.progressPercentage,
      currentStage: project.currentStage,
      status: project.status,
      university: project.university,
      universityDepartment: project.universityDepartment,
      facultyMentor: project.facultyMentor,
      teamMembers: project.teamMembers,
    } : null,
  };
}

async function releaseSankalpStudents(challenge) {
  if (!challenge?.selectedStudents?.length) return;
  await User.updateMany({
    _id: { $in: challenge.selectedStudents.map((selection) => selection.studentId?._id || selection.studentId) },
    'sankalpClubProfile.currentAssignment': challenge._id
  }, {
    $set: {
      'sankalpClubProfile.available': true,
      'sankalpClubProfile.currentAssignment': null
    }
  });
}

function governmentDistrict(user) {
  return String(user?.governmentDistrict || user?.district || '').trim();
}

function isGovernmentChallengeAccessAllowed(user, challenge) {
  return user?.role === 'government' && governmentDistrict(user) && challenge?.district === governmentDistrict(user);
}

async function notifySolutionVerified(challenge, actorId) {
  const coordinator = challenge.assignedUniversity
    ? await User.findById(challenge.assignedUniversity).select('institution')
    : null;
  const recipients = new Map();
  if (coordinator?._id) recipients.set(coordinator._id.toString(), 'university');
  if (coordinator?.institution && challenge.department) {
    const departmentMembers = await User.find({
      role: 'university',
      institution: coordinator.institution,
      universityDepartment: challenge.department,
      accountType: { $in: ['faculty', 'student', 'researcher'] },
    }).select('_id').lean();
    departmentMembers.forEach((member) => recipients.set(member._id.toString(), 'university'));
  }
  await Promise.all([...recipients].map(([recipient, recipientRole]) => createNotification({
    recipient,
    recipientRole,
    type: 'solution_verified',
    title: 'Solution Verified',
    message: `The Government has verified the completed solution for '${challenge.title}'.`,
    relatedEntityType: 'challenge',
    relatedEntityId: challenge._id,
    actor: actorId,
    actorRole: 'government',
    eventKey: `solution_verified:${challenge._id}:${recipient}`,
  })));
}

async function verifyChallengeAndReward(challengeId, government) {
  const session = await mongoose.startSession();
  try {
    let verifiedChallenge;
    try {
      await session.withTransaction(async () => {
        const challenge = await Challenge.findOne({
          _id: challengeId,
          status: 'under_review',
          district: governmentDistrict(government),
          rewardProcessed: false
        }).session(session);
        if (!challenge) {
          const error = new Error('Challenge is no longer awaiting verification');
          error.statusCode = 409;
          throw error;
        }
        const citizen = await User.findOne({ _id: challenge.submittedBy, role: 'citizen' }).session(session);
        if (!citizen) {
          const error = new Error('Only Citizen challenges can receive Impact Tokens');
          error.statusCode = 400;
          throw error;
        }
        challenge.status = 'approved';
        challenge.rewardProcessed = true;
        await challenge.save({ session });
        await User.updateOne(
          { _id: citizen._id, role: 'citizen' },
          { $inc: { impactTokens: 1, lifetimeImpactTokens: 1, totalVerifiedProblems: 1 } },
          { session }
        );
        verifiedChallenge = challenge;
      });
      return verifiedChallenge;
    } catch (error) {
      if (error.statusCode || !/transaction|replica set|mongos/i.test(error.message || '')) throw error;
    }

    const challenge = await Challenge.findOneAndUpdate(
      { _id: challengeId, status: 'under_review', district: governmentDistrict(government), rewardProcessed: false },
      { $set: { status: 'approved', rewardProcessed: true } },
      { new: true }
    );
    if (!challenge) {
      const existing = await Challenge.findById(challengeId).select('status');
      if (existing?.status === 'approved') return existing;
      const error = new Error('Challenge is no longer awaiting verification');
      error.statusCode = 409;
      throw error;
    }
    const citizen = await User.findOneAndUpdate(
      { _id: challenge.submittedBy, role: 'citizen' },
      { $inc: { impactTokens: 1, lifetimeImpactTokens: 1, totalVerifiedProblems: 1 } },
      { new: true }
    );
    if (!citizen) {
      await Challenge.updateOne({ _id: challenge._id, status: 'approved', rewardProcessed: true }, { $set: { status: 'under_review', rewardProcessed: false } });
      const error = new Error('Only Citizen challenges can receive Impact Tokens');
      error.statusCode = 400;
      throw error;
    }
    return challenge;
  } finally {
    await session.endSession();
  }
}

async function removeUploadedFiles(files = []) {
  await Promise.all(files.map((file) => fs.unlink(file.path).catch(() => undefined)));
}

function hasValidSignature(file) {
  const bytes = file.buffer;
  const extension = path.extname(file.originalname).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (extension === '.png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (extension === '.pdf') return bytes.subarray(0, 5).toString() === '%PDF-';
  if (extension === '.mp4') return bytes.subarray(4, 8).toString() === 'ftyp';
  return false;
}

// @desc    Create a new challenge
// @route   POST /api/challenges
// @access  Private - Citizen only
export const createChallenge = async (req, res, next) => {
  const files = req.files || [];
  try {
    const {
      title,
      description,
      category,
      district,
      villageOrCity,
      priority,
      urgency,
      urgencySource,
      urgencyReason,
      affected,
      expectedImpact,
      location,
      media,
      citizenContactNumber
    } = req.body;

    // Validation
    if (!title || !description || !category || !district) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: title, description, category, district'
      });
    }

    const validPriorities = ['low', 'medium', 'high', 'critical'];
    if (priority !== undefined && !validPriorities.includes(priority)) {
      return res.status(400).json({
        success: false,
        message: `Priority must be one of: ${validPriorities.join(', ')}`
      });
    }
    const validUrgencies = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    const normalizedUrgency = urgency === undefined ? 'MEDIUM' : String(urgency).trim().toUpperCase();
    if (!validUrgencies.includes(normalizedUrgency)) {
      return res.status(400).json({
        success: false,
        message: `Urgency must be one of: ${validUrgencies.join(', ')}`
      });
    }
    const validUrgencySources = ['ai_detected', 'manually_adjusted', 'fallback'];
    const normalizedUrgencySource = urgencySource === undefined ? 'fallback' : String(urgencySource).trim();
    if (!validUrgencySources.includes(normalizedUrgencySource)) {
      return res.status(400).json({
        success: false,
        message: `Urgency source must be one of: ${validUrgencySources.join(', ')}`
      });
    }
    if (citizenContactNumber !== undefined && !/^[6-9]\d{9}$/.test(String(citizenContactNumber))) {
      return res.status(400).json({
        success: false,
        message: 'Contact number must be a valid 10-digit Indian mobile number'
      });
    }

    // Get user from auth middleware
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Only citizens can submit challenges
    if (user.role !== 'citizen') {
      return res.status(403).json({
        success: false,
        message: 'Only citizens can submit challenges'
      });
    }

    if (files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please upload at least one photo, video, or document as supporting evidence.'
      });
    }

    let parsedLocation = null;
    if (location !== undefined && location !== null && String(location).trim() !== '') {
      try {
        const locationValue = typeof location === 'string' ? JSON.parse(location) : location;
        const latitude = Number(locationValue?.latitude);
        const longitude = Number(locationValue?.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
          || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
          throw new Error('invalid coordinates');
        }
        parsedLocation = { latitude, longitude };
      } catch {
        await removeUploadedFiles(files);
        return res.status(400).json({
          success: false,
          message: 'Location must contain valid coordinates'
        });
      }
    }

    // Create challenge object
    const challengeObj = {
      title,
      description,
      category,
      district,
      villageOrCity,
      ...(priority ? { priority } : {}),
      urgency: normalizedUrgency,
      urgencySource: normalizedUrgencySource,
      urgencyReason: typeof urgencyReason === 'string' ? urgencyReason.trim().slice(0, 500) : '',
      affected: typeof affected === 'string' ? affected.trim().slice(0, 2000) : '',
      expectedImpact: typeof expectedImpact === 'string' ? expectedImpact.trim().slice(0, 2000) : '',
      ...(parsedLocation ? { location: parsedLocation } : {}),
      status: 'under_review',
      submittedBy: userId,
      ...(citizenContactNumber ? { citizenContactNumber: String(citizenContactNumber) } : {}),
      media: media || { images: [], videos: [], documents: [] }
    };

    const attachmentFiles = [];
    for (const file of files) {
      const extension = path.extname(file.originalname).toLowerCase();
      const fileBytes = await fs.readFile(file.path);
      if (!isAllowedChallengeType(extension, file.mimetype) || !hasValidSignature({ ...file, buffer: fileBytes })) {
        await removeUploadedFiles(files);
        return res.status(400).json({ success: false, message: `Unsupported or invalid file: ${file.originalname}` });
      }
      attachmentFiles.push({
        originalName: path.basename(file.originalname).replace(/[^\w.\- ()]/g, '_').slice(0, 180),
        storedName: path.basename(file.filename),
        mimeType: file.mimetype,
        size: file.size,
        uploadedBy: userId,
        uploadedAt: new Date()
      });
    }
    challengeObj.attachments = attachmentFiles;

    // Add location if provided
    if (
      parsedLocation
      && Number.isFinite(Number(parsedLocation.latitude))
      && Number.isFinite(Number(parsedLocation.longitude))
    ) {
      challengeObj.location = {
        latitude: Number(parsedLocation.latitude),
        longitude: Number(parsedLocation.longitude)
      };
    }

    // Create challenge
    const challenge = await Challenge.create(challengeObj);
    void createNotification({
      recipient: userId,
      recipientRole: 'citizen',
      type: 'problem_submitted',
      title: 'Problem Submitted',
      message: `Your problem "${title}" has been successfully submitted and is now under Government review.`,
      relatedEntityType: 'challenge',
      relatedEntityId: challenge._id,
      actor: userId,
      actorRole: 'citizen',
      eventKey: `problem_submitted:${challenge._id}:${userId}`,
    }).catch((error) => console.error(`Notification creation failed: ${error.message}`));
    const governmentUsers = await User.find({
      role: 'government',
      $or: [{ district }, { governmentDistrict: district }],
    }).select('_id role').lean();
    for (const governmentUser of governmentUsers) {
      void createNotification({
        recipient: governmentUser._id,
        recipientRole: governmentUser.role,
        type: 'challenge_submitted',
        title: 'New problem submitted',
        message: `${title} was submitted in ${district}.`,
        relatedEntityType: 'challenge',
        relatedEntityId: challenge._id,
      }).catch((error) => console.error(`Notification creation failed: ${error.message}`));
    }

    // Populate submittedBy user details
    await challenge.populate({
      path: 'submittedBy',
      select: 'name email role district villageOrCity'
    });

    res.status(201).json({
      success: true,
      message: 'Challenge created successfully',
      data: challenge
    });
  } catch (error) {
    await removeUploadedFiles(files);
    // Handle Mongoose validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    next(error);
  }
};

export const downloadChallengeAttachment = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('role district governmentDistrict');
    const challenge = await Challenge.findById(req.params.id).select('+attachments.storedName');
    if (!challenge) return res.status(404).json({ success: false, message: 'Challenge not found' });
    if (user?.role === 'government' && !isGovernmentChallengeAccessAllowed(user, challenge)) {
      return res.status(403).json({ success: false, message: 'You do not have access to challenges outside your district' });
    }

    const canAccess = req.user.role === 'government'
      || (req.user.role === 'citizen' && challenge.submittedBy.toString() === req.user.id)
      || (req.user.role === 'university' && (
        challenge.assignedUniversity?.toString() === req.user.id
        || challenge.departmentMentor?.toString() === req.user.id
        || challenge.selectedStudents?.some((selection) => selection.studentId.toString() === req.user.id)
      ));
    if (!canAccess) return res.status(403).json({ success: false, message: 'You do not have access to this attachment' });

    const attachment = challenge.attachments.id(req.params.attachmentId);
    if (!attachment) return res.status(404).json({ success: false, message: 'Attachment not found' });
    const storedPath = path.resolve(challengeUploadDirectory, attachment.storedName);
    if (!storedPath.startsWith(`${challengeUploadDirectory}${path.sep}`)) {
      return res.status(400).json({ success: false, message: 'Invalid attachment path' });
    }
    res.download(storedPath, attachment.originalName, { headers: { 'Content-Type': attachment.mimeType } }, (error) => {
      if (error && !res.headersSent) next(error);
    });
  } catch (error) {
    if (error.kind === 'ObjectId') return res.status(404).json({ success: false, message: 'Attachment not found' });
    next(error);
  }
};

// @desc    Accept an assigned challenge
// @route   PATCH /api/challenges/:id/accept
// @access  Private - Assigned university only
export const acceptChallenge = async (req, res, next) => {
  try {
    const challenge = await Challenge.findById(req.params.id);

    if (!challenge) {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found'
      });
    }

    const actor = await User.findById(req.user.id).select('role universityRole institution');
    const assignedUniversity = challenge.assignedUniversity
      ? await User.findById(challenge.assignedUniversity).select('role institution')
      : null;
    const isAssignedUniversity = challenge.assignedUniversity?.toString() === req.user.id;
    const isAuthorizedCoordinator = actor?.role === 'university'
      && actor.universityRole === 'innovation_coordinator'
      && assignedUniversity?.role === 'university'
      && actor.institution === assignedUniversity.institution;
    if (!isAssignedUniversity && !isAuthorizedCoordinator) {
      return res.status(403).json({
        success: false,
        message: 'Only the assigned university can accept this challenge'
      });
    }

    if (
      !['assigned', 'funding_approved'].includes(challenge.status)
      || !['pending', 'awaiting_acceptance'].includes(challenge.assignmentStatus)
      || challenge.acceptedByUniversity
    ) {
      return res.status(400).json({
        success: false,
        message: 'This challenge cannot be accepted in its current status'
      });
    }

    challenge.assignmentStatus = 'accepted';
    challenge.acceptedByUniversity = challenge.assignedUniversity;
    challenge.acceptedAt = new Date();
    challenge.status = 'accepted';
    if (!challenge.industryFundingStatus || ['pending', 'eligible', 'not_eligible', 'proposal_pending'].includes(challenge.industryFundingStatus)) {
      challenge.industryFundingStatus = 'proposal_pending';
    }
    // Recover legacy records that were funded before acceptance: funding must
    // be explicitly approved again after this acceptance.
    challenge.fundingStatus = 'pending';
    challenge.fundingAmount = 0;
    challenge.fundingApprovedBy = null;
    challenge.fundingApprovedAt = null;
    await challenge.save();
    const governmentUsers = await User.find({
      role: 'government',
      $or: [{ district: challenge.district }, { governmentDistrict: challenge.district }],
    }).select('_id role').lean();
    for (const governmentUser of governmentUsers) {
      void createNotification({
        recipient: governmentUser._id,
        recipientRole: governmentUser.role,
        type: 'problem_accepted',
        title: 'University Accepted Problem',
        message: `The university accepted the assigned problem "${challenge.title}".`,
        relatedEntityType: 'challenge',
        relatedEntityId: challenge._id,
        actor: req.user.id,
        actorRole: 'university',
        eventKey: `problem_accepted:${challenge._id}:${governmentUser._id}`,
      }).catch((error) => console.error(`Notification creation failed: ${error.message}`));
    }
    if (challenge.submittedBy) {
      void createNotification({
        recipient: challenge.submittedBy,
        recipientRole: 'citizen',
        type: 'challenge_accepted',
        title: 'University accepted your problem',
        message: `Your problem "${challenge.title}" was accepted by the university.`,
        relatedEntityType: 'challenge',
        relatedEntityId: challenge._id,
      }).catch((error) => console.error(`Notification creation failed: ${error.message}`));
    }
    await challenge.populate([
      { path: 'submittedBy', select: 'name email role district villageOrCity' },
      { path: 'assignedUniversity', select: 'name email institution universityDepartment' },
      { path: 'acceptedByUniversity', select: 'name email institution universityDepartment' }
    ]);

    res.status(200).json({
      success: true,
      message: 'Challenge accepted successfully',
      data: challenge
    });
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found'
      });
    }

    next(error);
  }
};

export const assignChallengeDepartment = async (req, res, next) => {
  try {
    const department = String(req.body.department || '').trim();
    if (!UNIVERSITY_ASSIGNMENT_DEPARTMENTS.includes(department)) {
      return res.status(400).json({ success: false, message: 'Select a valid university department' });
    }

    const coordinator = await User.findById(req.user.id).select('role universityRole institution');
    if (!coordinator || coordinator.role !== 'university' || coordinator.universityRole !== 'innovation_coordinator') {
      return res.status(403).json({ success: false, message: 'Only an authorized University Innovation Coordinator can assign departments' });
    }

    const challenge = await Challenge.findById(req.params.id);
    if (!challenge) return res.status(404).json({ success: false, message: 'Challenge not found' });
    if (!challenge.assignedUniversity || challenge.assignmentStatus !== 'accepted' || !challenge.acceptedByUniversity) {
      return res.status(400).json({ success: false, message: 'The university must accept this challenge before department assignment' });
    }
    if (challenge.department) {
      return res.status(409).json({ success: false, message: 'A department has already been assigned to this challenge' });
    }
    if (!['accepted', 'funding_approved', 'in_progress'].includes(challenge.status)) {
      return res.status(400).json({ success: false, message: 'This challenge is not in a valid state for department assignment' });
    }

    const assignedUniversity = await User.findById(challenge.assignedUniversity).select('role institution');
    if (
      !assignedUniversity
      || assignedUniversity.role !== 'university'
      || !coordinator.institution
      || normalizeInstitution(assignedUniversity.institution) !== normalizeInstitution(coordinator.institution)
    ) {
      return res.status(403).json({ success: false, message: 'This challenge is assigned to another university' });
    }

    let sankalpMentor = null;
    if (department === SANKALP_CLUB) {
      if (!mongoose.isValidObjectId(req.body.mentorId)) {
        return res.status(400).json({ success: false, message: 'Select a Sankalp Club mentor before assigning this department' });
      }
      sankalpMentor = await User.findOne({
        _id: req.body.mentorId,
        role: 'university',
        accountType: 'faculty',
        institution: assignedUniversity.institution,
        'sankalpClubProfile.club': SANKALP_CLUB,
        'sankalpClubProfile.role': 'Sankalp Club Mentor',
        'sankalpClubProfile.active': true
      }).select('_id name email institution accountType sankalpClubProfile.club sankalpClubProfile.role');
      if (!sankalpMentor) {
        return res.status(400).json({ success: false, message: 'Select an active Sankalp Club mentor registered at this University' });
      }
      challenge.departmentMentor = sankalpMentor._id;
      challenge.departmentMentorAssignedBy = coordinator._id;
      challenge.departmentMentorAssignedAt = new Date();
      challenge.mentorAssigned = true;
    }
    challenge.department = department;
    challenge.departmentAssignedBy = coordinator._id;
    challenge.departmentAssignedAt = new Date();
    await challenge.save();
    const coordinators = await User.find({
      role: 'university',
      universityRole: 'innovation_coordinator',
      institution: assignedUniversity.institution,
    }).select('_id role').lean();
    for (const coordinator of coordinators) {
      void createNotification({
        recipient: coordinator._id,
        recipientRole: coordinator.role,
        type: 'department_assigned',
        title: 'Department Assigned',
        message: `"${challenge.title}" has been assigned to ${department}.`,
        relatedEntityType: 'challenge',
        relatedEntityId: challenge._id,
        actor: req.user.id,
        actorRole: 'university',
        eventKey: `department_assigned:${challenge._id}:${coordinator._id}`,
      }).catch((error) => console.error(`Notification creation failed: ${error.message}`));
    }
    const departmentUsers = await User.find({
      role: 'university',
      institution: assignedUniversity.institution,
      universityDepartment: department,
    }).select('_id role').lean();
    for (const departmentUser of departmentUsers) {
      void createNotification({
        recipient: departmentUser._id,
        recipientRole: departmentUser.role,
        type: 'department_assigned',
        title: 'Problem assigned to your department',
        message: `"${challenge.title}" was assigned to ${department}.`,
        relatedEntityType: 'challenge',
        relatedEntityId: challenge._id,
      }).catch((error) => console.error(`Notification creation failed: ${error.message}`));
    }
    if (sankalpMentor) {
      void createNotification({
        recipient: sankalpMentor._id,
        recipientRole: 'university',
        type: 'department_assigned',
        title: 'Sankalp Club problem assigned',
        message: `"${challenge.title}" has been assigned to you as a Sankalp Club mentor.`,
        relatedEntityType: 'challenge',
        relatedEntityId: challenge._id,
        actor: req.user.id,
        actorRole: 'university',
        eventKey: `sankalp_mentor_assigned:${challenge._id}:${sankalpMentor._id}`,
      }).catch((error) => console.error(`Notification creation failed: ${error.message}`));
    }
    await challenge.populate([
      { path: 'assignedUniversity', select: 'name email institution universityDepartment' },
      { path: 'departmentAssignedBy', select: 'name email institution universityRole' },
      { path: 'departmentMentor', select: 'name email institution accountType sankalpClubProfile.club sankalpClubProfile.role' }
    ]);
    return res.status(200).json({ success: true, message: 'Challenge department assigned successfully', data: challenge });
  } catch (error) {
    if (error.kind === 'ObjectId') return res.status(404).json({ success: false, message: 'Challenge not found' });
    next(error);
  }
};

const getCoordinatorChallengeContext = async (req, challengeId) => {
  const coordinator = await User.findById(req.user.id).select('role universityRole institution universityDepartment accountType');
  if (!coordinator || coordinator.role !== 'university') {
    return { error: { status: 403, message: 'Only authorized University users can manage department mentors' } };
  }
  const isCoordinator = coordinator.universityRole === 'innovation_coordinator';

  const challenge = await Challenge.findById(challengeId);
  if (!challenge) return { error: { status: 404, message: 'Challenge not found' } };
  if (!challenge.assignedUniversity || challenge.assignmentStatus !== 'accepted' || !challenge.acceptedByUniversity) {
    return { error: { status: 400, message: 'The university must accept this challenge before mentor assignment' } };
  }
  if (!challenge.department) {
    return { error: { status: 400, message: 'Assign a department before assigning a mentor' } };
  }
  if (!['accepted', 'funding_approved', 'in_progress'].includes(challenge.status)) {
    return { error: { status: 400, message: 'This challenge is not in a valid state for mentor assignment' } };
  }

  const assignedUniversity = await User.findById(challenge.assignedUniversity).select('role institution');
  if (
    !assignedUniversity
    || assignedUniversity.role !== 'university'
    || !coordinator.institution
    || assignedUniversity.institution !== coordinator.institution
  ) {
    return { error: { status: 403, message: 'This challenge is assigned to another university' } };
  }
  if (!isCoordinator && (
    !coordinator.universityDepartment
    || coordinator.universityDepartment !== challenge.department
    || !['faculty', 'researcher'].includes(coordinator.accountType)
  )) {
    return { error: { status: 403, message: 'Only an authorized member of the assigned department can manage mentors' } };
  }

  return { coordinator, challenge, isCoordinator };
};

export const getDepartmentMentors = async (req, res, next) => {
  try {
    const context = await getCoordinatorChallengeContext(req, req.params.id);
    if (context.error) return res.status(context.error.status).json({ success: false, message: context.error.message });

    const mentors = await User.find({
      role: 'university',
      institution: context.coordinator.institution,
      universityDepartment: context.challenge.department,
      accountType: 'faculty'
    })
      .select('_id name email institution universityDepartment accountType')
      .sort({ name: 1 })
      .lean();

    return res.status(200).json({ success: true, data: mentors });
  } catch (error) {
    if (error.kind === 'ObjectId') return res.status(404).json({ success: false, message: 'Challenge not found' });
    next(error);
  }
};

export const assignChallengeMentor = async (req, res, next) => {
  try {
    const { departmentMentor } = req.body;
    if (!departmentMentor) {
      return res.status(400).json({ success: false, message: 'Select a department mentor' });
    }

    const context = await getCoordinatorChallengeContext(req, req.params.id);
    if (context.error) return res.status(context.error.status).json({ success: false, message: context.error.message });
    if (context.challenge.departmentMentor) {
      return res.status(409).json({ success: false, message: 'A department mentor has already been assigned to this challenge' });
    }

    const mentor = await User.findOne({
      _id: departmentMentor,
      role: 'university',
      institution: context.coordinator.institution,
      universityDepartment: context.challenge.department,
      accountType: 'faculty'
    }).select('_id name email institution universityDepartment accountType');
    if (!mentor) {
      return res.status(403).json({ success: false, message: 'Selected mentor is not an eligible faculty member for this department' });
    }

    context.challenge.departmentMentor = mentor._id;
    context.challenge.departmentMentorAssignedBy = context.coordinator._id;
    context.challenge.departmentMentorAssignedAt = new Date();
    context.challenge.mentorAssigned = true;
    await context.challenge.save();
    await context.challenge.populate([
      { path: 'assignedUniversity', select: 'name email institution universityDepartment' },
      { path: 'departmentMentor', select: 'name email institution universityDepartment accountType sankalpClubProfile.club sankalpClubProfile.role' },
      { path: 'departmentMentorAssignedBy', select: 'name email institution universityRole' }
    ]);

    return res.status(200).json({ success: true, message: 'Department mentor assigned successfully', data: context.challenge });
  } catch (error) {
    if (error.kind === 'ObjectId') return res.status(404).json({ success: false, message: 'Challenge or mentor not found' });
    next(error);
  }
};

// @desc    Get all challenges with optional filters
// @route   GET /api/challenges
// @access  Private
export const getAllChallenges = async (req, res, next) => {
  try {
    if (req.user.role === 'industry') {
      return res.status(403).json({ success: false, message: 'Use Industry opportunities for eligible projects' });
    }
    const { category, district, status, priority } = req.query;

    // Build filter object
    const filter = {};

    if (category) {
      filter.category = category;
    }
    if (district) {
      filter.district = district;
    }
    if (status) {
      filter.status = status;
    }
    if (priority) {
      filter.priority = priority;
    }
    if (req.user.role === 'university') {
      const user = await User.findById(req.user.id).select('institution universityRole universityDepartment');
      if (user?.universityRole === 'innovation_coordinator') {
        filter.$or = [{ assignedUniversity: { $in: await User.find({ role: 'university', institution: user.institution }).distinct('_id') } }];
      } else if (user?.institution && user.universityDepartment) {
        const universityIds = await User.find({ role: 'university', institution: user.institution }).distinct('_id');
        filter.$or = [
          { assignedUniversity: { $in: universityIds }, department: user.universityDepartment },
          { departmentMentor: req.user.id },
          { 'selectedStudents.studentId': req.user.id }
        ];
      } else {
        filter.$or = [
          { assignedUniversity: req.user.id },
          { departmentMentor: req.user.id },
          { 'selectedStudents.studentId': req.user.id }
        ];
      }
    } else if (req.user.role === 'citizen') {
      filter.submittedBy = req.user.id;
    } else if (req.user.role === 'government') {
      const user = await User.findById(req.user.id).select('role district governmentDistrict');
      const district = governmentDistrict(user);
      if (!district) return res.status(403).json({ success: false, message: 'Government account requires district assignment' });
      filter.district = district;
    }

    // Get challenges sorted by newest first
    const challengeQuery = Challenge.find(filter);
    if (req.user.role === 'government') {
      challengeQuery.select('+citizenContactNumber');
    }
    challengeQuery
      .populate({
        path: 'submittedBy',
        select: 'name email role district villageOrCity'
      })
      .populate({
        path: 'assignedUniversity',
        select: 'name email institution institution universityDepartment'
      })
      .populate({
        path: 'acceptedByUniversity',
        select: 'name email institution universityDepartment'
      });
    challengeQuery.populate({
      path: 'departmentMentor',
      select: 'name email institution universityDepartment accountType sankalpClubProfile.club sankalpClubProfile.role'
    });
    challengeQuery.populate({
      path: 'selectedStudents.studentId',
      select: 'name institution sankalpClubProfile.organization sankalpClubProfile.role'
    });
    if (req.user.role === 'government') {
      challengeQuery.populate({
        path: 'industryFundedBy',
        select: 'name email organizationName organizationType'
      });
    }
    const challenges = await challengeQuery.sort({ createdAt: -1 });
    let serializedChallenges = challenges;
    if (req.user.role === 'citizen') {
      const projects = await Project.find({ challenge: { $in: challenges.map((challenge) => challenge._id) } })
        .select('_id title challenge progressPercentage currentStage status university universityDepartment facultyMentor teamMembers')
        .populate('university', 'name institution')
        .populate('facultyMentor', 'name email accountType')
        .populate('teamMembers', 'name email accountType')
        .lean();
      const projectsByChallenge = new Map(projects.map((project) => [project.challenge.toString(), project]));
      serializedChallenges = challenges.map((challenge) => serializeCitizenChallenge(
        challenge,
        projectsByChallenge.get(challenge._id.toString()),
      ));
    }

    res.status(200).json({
      success: true,
      count: serializedChallenges.length,
      data: serializedChallenges
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get a single challenge by ID
// @route   GET /api/challenges/:id
// @access  Private
export const getChallengeById = async (req, res, next) => {
  try {
    if (req.user.role === 'industry') {
      return res.status(403).json({ success: false, message: 'Use Industry project opportunities for eligible details' });
    }
    const { id } = req.params;

    const challengeQuery = Challenge.findById(id);
    if (req.user.role === 'government') {
      challengeQuery.select('+citizenContactNumber');
    }
    challengeQuery
      .populate({
        path: 'submittedBy',
        select: 'name email role district villageOrCity'
      })
      .populate({
        path: 'assignedUniversity',
        select: 'name email institution universityDepartment'
      })
      .populate({
        path: 'acceptedByUniversity',
        select: 'name email institution universityDepartment'
      });
    challengeQuery.populate({
      path: 'departmentMentor',
      select: 'name email institution universityDepartment accountType sankalpClubProfile.club sankalpClubProfile.role'
    });
    challengeQuery.populate({
      path: 'selectedStudents.studentId',
      select: 'name institution sankalpClubProfile.organization sankalpClubProfile.role'
    });
    if (req.user.role === 'government') {
      challengeQuery.populate({
        path: 'industryFundedBy',
        select: 'name email organizationName organizationType'
      });
    }
    const challenge = await challengeQuery;

    if (!challenge) {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found'
      });
    }

    if (req.user.role === 'university' && (!challenge.assignedUniversity || (
      challenge.assignedUniversity._id.toString() !== req.user.id
      && challenge.departmentMentor?._id?.toString() !== req.user.id
      && !(challenge.selectedStudents || []).some((selection) => (
        selection.studentId?._id?.toString() === req.user.id
        || selection.studentId?.toString() === req.user.id
      ))
    ))) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this challenge'
      });
    }
    if (req.user.role === 'citizen' && challenge.submittedBy._id.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this challenge'
      });
    }
    if (req.user.role === 'government') {
      const user = await User.findById(req.user.id).select('role district governmentDistrict');
      if (!isGovernmentChallengeAccessAllowed(user, challenge)) {
        return res.status(403).json({ success: false, message: 'You do not have access to challenges outside your district' });
      }
    }
    res.status(200).json({
      success: true,
      data: req.user.role === 'citizen' ? serializeCitizenChallenge(challenge) : challenge
    });
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found'
      });
    }

    next(error);
  }
};

// @desc    Update challenge status
// @route   PATCH /api/challenges/:id/status
// @access  Private - Government only
export const updateChallengeStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Validation
    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }

    const validStatuses = ['submitted', 'under_review', 'approved', 'assigned', 'accepted', 'funding_approved', 'cancelled', 'in_progress', 'resolved', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${validStatuses.join(', ')}`
      });
    }

    // Get user from auth middleware
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Only government users can update status
    if (user.role !== 'government') {
      return res.status(403).json({
        success: false,
        message: 'Only government users can update challenge status'
      });
    }

    const existingChallenge = await Challenge.findById(id).select('status district assignedUniversity assignmentStatus acceptedByUniversity rewardProcessed department studentsAssigned');
    if (!existingChallenge) {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found'
      });
    }
    if (!isGovernmentChallengeAccessAllowed(user, existingChallenge)) {
      return res.status(403).json({ success: false, message: 'You cannot manage challenges outside your district' });
    }
    const allowedTransitions = {
      submitted: ['under_review'],
      under_review: ['approved', 'rejected'],
      approved: existingChallenge.department === SANKALP_CLUB && existingChallenge.rewardProcessed
        ? ['approved', 'resolved']
        : ['approved'],
      assigned: ['assigned'],
      accepted: ['accepted', 'funding_approved'],
      funding_approved: ['funding_approved'],
      in_progress: existingChallenge.department === SANKALP_CLUB && existingChallenge.studentsAssigned
        ? ['in_progress', 'under_review']
        : ['in_progress'],
      resolved: ['resolved'],
      rejected: ['rejected']
    };
    if (!allowedTransitions[existingChallenge.status]?.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot change challenge status from ${existingChallenge.status} to ${status}`
      });
    }

    if (status === 'funding_approved' && (
      !existingChallenge.assignedUniversity ||
      existingChallenge.assignmentStatus !== 'accepted' ||
      !existingChallenge.acceptedByUniversity
    )) {
      return res.status(400).json({
        success: false,
        message: 'University acceptance is required before funding approval'
      });
    }

    if (status === 'approved' && existingChallenge.status === 'under_review' && existingChallenge.rewardProcessed) {
      const completedChallenge = await Challenge.findByIdAndUpdate(
        id,
        { status: 'resolved' },
        { new: true, runValidators: true }
      );
      await releaseSankalpStudents(completedChallenge);
      void createNotification({
        recipient: completedChallenge.submittedBy,
        recipientRole: 'citizen',
        type: 'problem_completed',
        title: '🎉 Problem Completed',
        message: `Congratulations! Your reported problem "${completedChallenge.title}" has been completed and verified.`,
        relatedEntityType: 'challenge',
        relatedEntityId: completedChallenge._id,
        actor: user._id,
        actorRole: 'government',
        eventKey: `problem_completed:${completedChallenge._id}`,
      }).catch((error) => console.error(`Notification creation failed: ${error.message}`));
      void notifySolutionVerified(completedChallenge, user._id)
        .catch((error) => console.error(`Solution verification notification failed: ${error.message}`));
      return res.status(200).json({
        success: true,
        message: 'Completed solution verified and problem marked solved',
        data: completedChallenge
      });
    }

    if (status === 'approved' && existingChallenge.status === 'under_review') {
      const verifiedChallenge = await verifyChallengeAndReward(id, user);
      void createNotification({
        recipient: verifiedChallenge.submittedBy,
        recipientRole: 'citizen',
        type: 'problem_verified',
        title: 'Problem Verified',
        message: `Your problem "${verifiedChallenge.title}" has been verified by the District Government.`,
        relatedEntityType: 'challenge',
        relatedEntityId: verifiedChallenge._id,
        actor: user._id,
        actorRole: 'government',
        eventKey: `problem_verified:${verifiedChallenge._id}`,
      }).catch((error) => console.error(`Notification creation failed: ${error.message}`));
      void createNotification({
        recipient: verifiedChallenge.submittedBy,
        recipientRole: 'citizen',
        type: 'impact_token_earned',
        title: 'Impact Token Earned',
        message: 'Your verified problem earned 1 Impact Token.',
        relatedEntityType: 'challenge',
        relatedEntityId: verifiedChallenge._id,
        actor: user._id,
        actorRole: 'government',
        eventKey: `impact_token_earned:${verifiedChallenge._id}`,
      }).catch((error) => console.error(`Notification creation failed: ${error.message}`));
      await verifiedChallenge.populate([
        { path: 'submittedBy', select: 'name email role district villageOrCity' },
        { path: 'assignedUniversity', select: 'name email institution universityDepartment' }
      ]);
      return res.status(200).json({
        success: true,
        message: 'Challenge verified and one Impact Token awarded',
        data: verifiedChallenge
      });
    }

    // Find and update challenge
    const challenge = await Challenge.findByIdAndUpdate(
      id,
      { status },
      { new: true, runValidators: true }
    )
      .populate({
        path: 'submittedBy',
        select: 'name email role district villageOrCity'
      })
      .populate({
        path: 'assignedUniversity',
        select: 'name email institution universityDepartment'
      });

    if (!challenge) {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found'
      });
    }
    if (['resolved', 'completed', 'cancelled', 'rejected'].includes(status)) {
      await releaseSankalpStudents(challenge);
    }

    res.status(200).json({
      success: true,
      message: 'Challenge status updated successfully',
      data: challenge
    });
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found'
      });
    }

    next(error);
  }
};

// @desc    Update challenge priority
// @route   PATCH /api/challenges/:id/priority
// @access  Private - Government only
export const updateChallengePriority = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { priority } = req.body;

    // Validation
    if (!priority) {
      return res.status(400).json({
        success: false,
        message: 'Priority is required'
      });
    }

    const validPriorities = ['low', 'medium', 'high', 'critical'];
    if (!validPriorities.includes(priority)) {
      return res.status(400).json({
        success: false,
        message: `Priority must be one of: ${validPriorities.join(', ')}`
      });
    }

    // Get user from auth middleware
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Only government users can update priority
    if (user.role !== 'government') {
      return res.status(403).json({
        success: false,
        message: 'Only government users can update challenge priority'
      });
    }

    const existingChallenge = await Challenge.findById(id).select('status district');
    if (!existingChallenge) {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found'
      });
    }
    if (!isGovernmentChallengeAccessAllowed(user, existingChallenge)) {
      return res.status(403).json({ success: false, message: 'You cannot manage challenges outside your district' });
    }

    // Find and update challenge
    const challenge = await Challenge.findByIdAndUpdate(
      id,
      { priority },
      { new: true, runValidators: true }
    )
      .populate({
        path: 'submittedBy',
        select: 'name email role district villageOrCity'
      })
      .populate({
        path: 'assignedUniversity',
        select: 'name email institution universityDepartment'
      });

    if (!challenge) {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Challenge priority updated successfully',
      data: challenge
    });
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found'
      });
    }

    next(error);
  }
};

// @desc    Assign challenge to a university
// @route   PATCH /api/challenges/:id/assign
// @access  Private - Government only
export const assignChallenge = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { assignedUniversity } = req.body;

    // Validation
    if (!assignedUniversity) {
      return res.status(400).json({
        success: false,
        message: 'assignedUniversity user ID is required'
      });
    }

    // Get user from auth middleware
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Only government users can assign challenges
    if (user.role !== 'government') {
      return res.status(403).json({
        success: false,
        message: 'Only government users can assign challenges'
      });
    }

    // Verify that the assigned user is a university user
    const universityUser = await User.findById(assignedUniversity);

    if (!universityUser) {
      return res.status(404).json({
        success: false,
        message: 'Assigned university user not found'
      });
    }

    if (universityUser.role !== 'university'
      || universityUser.accountType !== 'coordinator'
      || universityUser.universityRole !== 'innovation_coordinator'
      || !universityUser.institution) {
      return res.status(400).json({
        success: false,
        message: 'Assigned user must be an active university coordinator'
      });
    }

    const existingChallenge = await Challenge.findById(id).select('status district');
    if (!existingChallenge) {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found'
      });
    }
    if (!isGovernmentChallengeAccessAllowed(user, existingChallenge)) {
      return res.status(403).json({ success: false, message: 'You cannot manage challenges outside your district' });
    }
    if (existingChallenge.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Only approved challenges can be assigned to a university'
      });
    }

    // Find and update challenge
    const challenge = await Challenge.findByIdAndUpdate(
      id,
      {
        assignedUniversity,
        status: 'assigned',
        assignmentStatus: 'pending',
        acceptedByUniversity: null,
        acceptedAt: null,
        fundingAmount: 0,
        fundingStatus: 'pending',
        fundingApprovedBy: null,
        fundingApprovedAt: null,
        cancelledBy: null,
        cancelledAt: null,
        cancellationReason: null
      },
      { new: true, runValidators: true }
    )
      .populate({
        path: 'submittedBy',
        select: 'name email role district villageOrCity'
      })
      .populate({
        path: 'assignedUniversity',
        select: 'name email institution universityDepartment'
      });

    if (!challenge) {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found'
      });
    }

    void createNotification({
      recipient: assignedUniversity,
      recipientRole: 'university',
      type: 'university_assigned',
      title: 'New Government Assignment',
      message: `District Government has assigned problem '${challenge.title}' to ${challenge.assignedUniversity?.institution || 'your university'}. Review and acceptance are required.`,
      relatedEntityType: 'challenge',
      relatedEntityId: challenge._id,
      eventKey: `university_assigned:${challenge._id}`,
    }).catch((error) => console.error(`Notification creation failed: ${error.message}`));
    void createNotification({
      recipient: challenge.submittedBy,
      recipientRole: 'citizen',
      type: 'university_assigned',
      title: 'University assigned',
      message: `Your problem "${challenge.title}" was assigned to a university.`,
      relatedEntityType: 'challenge',
      relatedEntityId: challenge._id,
      eventKey: `university_assigned:${challenge._id}:citizen`,
    }).catch((error) => console.error(`Notification creation failed: ${error.message}`));

    res.status(200).json({
      success: true,
      message: 'Challenge assigned successfully',
      data: challenge
    });
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Challenge or user not found'
      });
    }

    next(error);
  }
};

// @desc    Cancel an assigned challenge before funding approval
// @route   PATCH /api/challenges/:id/cancel
// @access  Private - Government only
export const cancelChallenge = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || user.role !== 'government') {
      return res.status(403).json({ success: false, message: 'Only government users can cancel challenges' });
    }

    const challenge = await Challenge.findById(req.params.id);
    if (!challenge) return res.status(404).json({ success: false, message: 'Challenge not found' });
    if (!isGovernmentChallengeAccessAllowed(user, challenge)) {
      return res.status(403).json({ success: false, message: 'You cannot manage challenges outside your district' });
    }
    if (!challenge.assignedUniversity || !['pending', 'awaiting_acceptance', 'accepted'].includes(challenge.assignmentStatus)) {
      return res.status(400).json({ success: false, message: 'Only assigned challenges can be cancelled' });
    }
    if (challenge.fundingStatus === 'approved' || challenge.status === 'funding_approved') {
      return res.status(400).json({ success: false, message: 'Funding-approved challenges cannot be cancelled' });
    }

    challenge.status = 'cancelled';
    challenge.cancelledBy = user._id;
    challenge.cancelledAt = new Date();
    challenge.cancellationReason = typeof req.body?.cancellationReason === 'string'
      ? req.body.cancellationReason.trim() || null
      : null;
    await challenge.save();
    await releaseSankalpStudents(challenge);
    await challenge.populate([
      { path: 'assignedUniversity', select: 'name email institution universityDepartment' },
      { path: 'cancelledBy', select: 'name email role' }
    ]);
    return res.status(200).json({ success: true, message: 'Challenge cancelled successfully', data: challenge });
  } catch (error) {
    if (error.kind === 'ObjectId') return res.status(404).json({ success: false, message: 'Challenge not found' });
    next(error);
  }
};

// @desc    Delete a challenge
// @route   DELETE /api/challenges/:id
// @access  Private - Citizen (own challenge) or Government
export const deleteChallenge = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Get user from auth middleware
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Find challenge
    const challenge = await Challenge.findById(id);

    if (!challenge) {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found'
      });
    }

    // Check authorization
    const isChallengeOwner = challenge.submittedBy.toString() === userId;
    const isGovernment = user.role === 'government';

    if (isGovernment && !isGovernmentChallengeAccessAllowed(user, challenge)) {
      return res.status(403).json({ success: false, message: 'You cannot manage challenges outside your district' });
    }

    if (!isChallengeOwner && !isGovernment) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this challenge'
      });
    }

    // Delete challenge
    await releaseSankalpStudents(challenge);
    await Challenge.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Challenge deleted successfully'
    });
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found'
      });
    }

    next(error);
  }
};
