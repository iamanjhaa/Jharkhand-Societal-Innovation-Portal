import mongoose from 'mongoose';
import Challenge from '../models/Challenge.js';
import Project from '../models/Project.js';
import Sponsorship from '../models/Sponsorship.js';
import { createNotification } from '../utils/notifications.js';
import User from '../models/User.js';

const opportunityFilter = {
  status: { $in: ['approved', 'assigned', 'accepted', 'funding_approved', 'in_progress'] },
  assignmentStatus: 'accepted',
  assignedUniversity: { $ne: null },
  cancelledAt: null,
  $or: [
    { industryFundingStatus: { $in: ['proposal_pending', 'proposal_accepted', 'eligible', 'pending', 'accepted'] } },
    { industryFundingStatus: { $exists: false } }
  ]
};

function validId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function normalizeFundingStatus(status) {
  switch (status) {
    case 'not_eligible':
    case 'not_required':
      return 'not_eligible';
    case 'pending':
    case 'eligible':
    case 'proposal_pending':
      return 'proposal_pending';
    case 'funded_pending_university_acceptance':
    case 'accepted':
    case 'proposal_accepted':
      return 'proposal_accepted';
    case 'rejected':
    case 'proposal_rejected':
      return 'proposal_rejected';
    case 'funded':
      return 'funded';
    default:
      return status || 'not_eligible';
  }
}

function isChallengeEligibleForIndustry(challenge) {
  if (!challenge) return false;
  if (!challenge.assignedUniversity || challenge.assignmentStatus !== 'accepted' || challenge.cancelledAt) return false;
  return ['approved', 'assigned', 'accepted', 'funding_approved', 'in_progress'].includes(challenge.status);
}

export const getOpportunities = async (req, res, next) => {
  try {
    const challenges = await Challenge.find(opportunityFilter)
      .populate('assignedUniversity', 'name institution universityDepartment')
      .populate('acceptedByUniversity', 'name institution universityDepartment')
      .sort({ createdAt: -1 });
    const projects = await Project.find({ challenge: { $in: challenges.map((challenge) => challenge._id) } })
      .populate('university', 'name institution universityDepartment');
    const eligible = challenges.map((challenge) => {
      const project = projects.find((candidate) => candidate.challenge.toString() === challenge._id.toString());
      return {
        _id: challenge._id,
        title: project?.title || challenge.title,
        description: project?.description || challenge.description,
        solutionSummary: project?.solutionSummary || '',
        estimatedBudget: project?.estimatedBudget || 0,
        status: project?.status || 'proposal_pending',
        university: project?.university || challenge.assignedUniversity,
        challenge,
        project
      };
    });
    res.json({ success: true, count: eligible.length, data: eligible });
  } catch (error) { next(error); }
};

export const getIndustryProject = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(404).json({ success: false, message: 'Project not found' });
    const project = await Project.findById(req.params.id)
      .populate({ path: 'challenge', match: opportunityFilter, select: 'title description category district priority status assignmentStatus assignedUniversity cancelledAt industryFundingStatus' })
      .populate('university', 'name institution universityDepartment');
    if (!project || !project.challenge) return res.status(404).json({ success: false, message: 'Opportunity is not eligible' });
    res.json({ success: true, data: project });
  } catch (error) { next(error); }
};

export const createSponsorship = async (req, res, next) => {
  try {
    const { project: projectId, challenge: challengeId, amount, expertise = '', notes = '', contactPerson = '', contactEmail = '', contactPhone = '' } = req.body;
    const numericAmount = Number(amount);
    if ((!validId(projectId) && !validId(challengeId)) || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ success: false, message: 'A valid challenge and positive funding amount are required' });
    }
    if (typeof contactPerson !== 'string' || typeof contactEmail !== 'string' || typeof contactPhone !== 'string'
      || !contactPerson.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail) || !/^[6-9]\d{9}$/.test(contactPhone)) {
      return res.status(400).json({ success: false, message: 'Valid contact person, email, and Indian phone number are required' });
    }

    const industry = await User.findOne({ _id: req.user.id, role: 'industry' }).select('organizationName');
    if (!industry || !industry.organizationName?.trim()) {
      return res.status(403).json({ success: false, message: 'An authenticated Industry organization is required to submit a funding proposal' });
    }

    const project = validId(projectId) ? await Project.findById(projectId).populate('challenge') : null;
    const challenge = project?.challenge || await Challenge.findById(challengeId);
    if (!challenge) return res.status(404).json({ success: false, message: 'Eligible problem not found' });

    if (!isChallengeEligibleForIndustry(challenge)) {
      return res.status(400).json({ success: false, message: 'Only verified, university-accepted, non-cancelled problems can receive industry funding proposals' });
    }

    const currentStatus = normalizeFundingStatus(challenge.industryFundingStatus);
    const activeProposal = await Sponsorship.findOne({
      challenge: challenge._id,
      status: { $in: ['pending', 'approved', 'accepted', 'funded'] }
    }).sort({ createdAt: -1 });
    if (activeProposal) {
      return res.status(409).json({ success: false, message: 'A funding proposal or funding record is already active for this problem' });
    }

    if (currentStatus === 'proposal_accepted' || currentStatus === 'funded') {
      return res.status(409).json({ success: false, message: 'This funding proposal has already been accepted by the University' });
    }

    const sponsorship = await Sponsorship.create({
      industry: req.user.id,
      project: project?._id || null,
      challenge: challenge._id,
      amount: numericAmount,
      expertise,
      notes,
      contactPerson,
      contactEmail,
      contactPhone,
      status: 'pending'
    });
    void createNotification({
      recipient: req.user.id,
      recipientRole: 'industry',
      type: 'funding_proposal_submitted',
      title: 'Funding Proposal Submitted',
      message: `Your funding proposal of ₹${numericAmount} for "${challenge.title}" has been submitted.`,
      relatedEntityType: 'challenge',
      relatedEntityId: challenge._id,
      actor: req.user.id,
      actorRole: 'industry',
      eventKey: `funding_proposal_submitted:${sponsorship._id}:industry`,
    }).catch((error) => console.error(`Notification creation failed: ${error.message}`));
    const assignedUser = await User.findById(challenge.assignedUniversity).select('institution');
    const coordinators = assignedUser?.institution
      ? await User.find({ role: 'university', universityRole: 'innovation_coordinator', institution: assignedUser.institution }).select('_id role').lean()
      : [];
    for (const coordinator of coordinators) {
      void createNotification({
        recipient: coordinator._id,
        recipientRole: coordinator.role,
        type: 'funding_proposal_submitted',
        title: 'New Industry Funding Proposal',
        message: `An industry organization submitted a funding proposal of ₹${numericAmount} for "${challenge.title}".`,
        relatedEntityType: 'challenge',
        relatedEntityId: challenge._id,
        actor: req.user.id,
        actorRole: 'industry',
        eventKey: `funding_proposal_submitted:${sponsorship._id}:${coordinator._id}`,
      }).catch((error) => console.error(`Notification creation failed: ${error.message}`));
    }

    const now = new Date();
    challenge.industryFundingStatus = 'proposal_pending';
    challenge.industryFundedBy = req.user.id;
    challenge.industryFundingAmount = numericAmount;
    challenge.industryFundingAt = now;
    challenge.industryFundingContactPerson = contactPerson;
    challenge.industryFundingContactEmail = contactEmail;
    challenge.industryFundingContactPhone = contactPhone;
    challenge.industryFundingMessage = notes;
    await challenge.save();
    if (project) await Project.findByIdAndUpdate(project._id, { $addToSet: { industryPartners: req.user.id } });
    await sponsorship.populate([
      { path: 'project', select: 'title description status estimatedBudget university universityDepartment' },
      { path: 'challenge', select: 'title category district priority status' }
    ]);

    res.status(201).json({ success: true, message: 'Funding proposal sent to the university for review', data: sponsorship });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'This problem already has an active funding proposal' });
    next(error);
  }
};

export const acceptSponsorship = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(404).json({ success: false, message: 'Challenge not found' });
    const challenge = await Challenge.findById(req.params.id);
    const actor = await User.findById(req.user.id).select('role universityRole institution');
    const assignedUniversity = challenge?.assignedUniversity
      ? await User.findById(challenge.assignedUniversity).select('role institution')
      : null;
    const authorized = challenge
      && challenge.assignmentStatus === 'accepted'
      && assignedUniversity?.role === 'university'
      && (challenge.assignedUniversity.toString() === req.user.id
        || (actor?.universityRole === 'innovation_coordinator' && actor.institution === assignedUniversity.institution));
    if (!authorized) {
      return res.status(403).json({ success: false, message: 'Only the assigned university can accept this funding proposal' });
    }

    const sponsorship = await Sponsorship.findOne({ challenge: challenge._id, status: { $in: ['pending', 'approved'] } }).sort({ createdAt: -1 });
    if (!sponsorship) return res.status(404).json({ success: false, message: 'No pending funding proposal found' });

    sponsorship.status = 'accepted';
    sponsorship.approvedAt = new Date();
    await sponsorship.save();

    challenge.industryFundingStatus = 'proposal_accepted';
    challenge.industryFundingAcceptedBy = challenge.assignedUniversity;
    challenge.industryFundingAcceptedAt = sponsorship.approvedAt;
    challenge.fundingStatus = 'pending';
    challenge.fundingAmount = sponsorship.amount;
    challenge.fundingApprovedAt = null;
    challenge.status = 'accepted';
    await challenge.save();
    await challenge.populate({
      path: 'industryFundedBy',
      select: 'name organizationName organizationType'
    });
    void createNotification({
      recipient: sponsorship.industry,
      recipientRole: 'industry',
      type: 'funding_accepted',
      title: 'Funding Proposal Accepted',
      message: `Your funding proposal for "${challenge.title}" has been accepted by the university.`,
      relatedEntityType: 'challenge',
      relatedEntityId: challenge._id,
      actor: req.user.id,
      actorRole: 'university',
      eventKey: `funding_accepted:${sponsorship._id}:industry`,
    }).catch((error) => console.error(`Notification creation failed: ${error.message}`));
    const university = await User.findById(challenge.assignedUniversity).select('institution');
    const departmentUsers = challenge.department && university?.institution
      ? await User.find({ role: 'university', institution: university.institution, universityDepartment: challenge.department }).select('_id role').lean()
      : [];
    for (const departmentUser of departmentUsers) {
      void createNotification({
        recipient: departmentUser._id,
        recipientRole: departmentUser.role,
        type: 'funding_accepted',
        title: 'Industry Funding Accepted',
        message: `Industry funding for "${challenge.title}" has been accepted. You can now create the project.`,
        relatedEntityType: 'challenge',
        relatedEntityId: challenge._id,
        actor: req.user.id,
        actorRole: 'university',
        eventKey: `funding_accepted:${sponsorship._id}:department:${departmentUser._id}`,
      }).catch((error) => console.error(`Notification creation failed: ${error.message}`));
    }
    if (sponsorship.project) await Project.findByIdAndUpdate(sponsorship.project, { $addToSet: { industryPartners: sponsorship.industry } });
    res.json({ success: true, message: 'Funding proposal accepted', data: challenge });
  } catch (error) { next(error); }
};

export const rejectSponsorship = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(404).json({ success: false, message: 'Challenge not found' });
    const challenge = await Challenge.findById(req.params.id);
    const actor = await User.findById(req.user.id).select('role universityRole institution');
    const assignedUniversity = challenge?.assignedUniversity
      ? await User.findById(challenge.assignedUniversity).select('role institution')
      : null;
    const authorized = challenge
      && challenge.assignmentStatus === 'accepted'
      && assignedUniversity?.role === 'university'
      && (challenge.assignedUniversity.toString() === req.user.id
        || (actor?.universityRole === 'innovation_coordinator' && actor.institution === assignedUniversity.institution));
    if (!authorized) {
      return res.status(403).json({ success: false, message: 'Only the assigned university can reject this funding proposal' });
    }

    const sponsorship = await Sponsorship.findOne({ challenge: challenge._id, status: { $in: ['pending', 'approved'] } }).sort({ createdAt: -1 });
    if (!sponsorship) return res.status(404).json({ success: false, message: 'No pending funding proposal found' });

    sponsorship.status = 'rejected';
    sponsorship.approvedAt = new Date();
    await sponsorship.save();

    challenge.industryFundingStatus = 'proposal_rejected';
    challenge.fundingStatus = 'pending';
    challenge.fundingAmount = 0;
    challenge.fundingApprovedBy = null;
    challenge.fundingApprovedAt = null;
    challenge.status = 'accepted';
    await challenge.save();
    void createNotification({
      recipient: sponsorship.industry,
      recipientRole: 'industry',
      type: 'funding_rejected',
      title: 'Funding Proposal Update',
      message: `Your funding proposal for "${challenge.title}" was rejected by the university.`,
      relatedEntityType: 'challenge',
      relatedEntityId: challenge._id,
      actor: req.user.id,
      actorRole: 'university',
      eventKey: `funding_rejected:${sponsorship._id}:industry`,
    }).catch((error) => console.error(`Notification creation failed: ${error.message}`));

    res.json({ success: true, message: 'Funding proposal rejected', data: challenge });
  } catch (error) { next(error); }
};

export const getUniversitySponsorships = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('role universityRole institution');
    const universityIds = user?.universityRole === 'innovation_coordinator'
      ? await User.find({ role: 'university', institution: user.institution }).distinct('_id')
      : [req.user.id];
    const projects = await Project.find({ university: { $in: universityIds } }).select('_id challenge');
    const challenges = await Challenge.find({ assignedUniversity: { $in: universityIds } }).select('_id');
    const sponsorships = await Sponsorship.find({ $or: [{ project: { $in: projects.map((p) => p._id) } }, { challenge: { $in: challenges.map((c) => c._id) } }] })
      .populate('industry', 'organizationName organizationType expertise name email')
      .populate('project', 'title status')
      .populate('challenge', 'title industryFundingStatus industryFundingContactPerson industryFundingContactEmail industryFundingContactPhone industryFundingAmount industryFundingMessage');
    res.json({ success: true, data: sponsorships });
  } catch (error) { next(error); }
};

export const getSponsorships = async (req, res, next) => {
  try {
    const sponsorships = await Sponsorship.find({ industry: req.user.id })
      .populate('project', 'title status university universityDepartment')
      .populate('challenge', 'title category district status priority')
      .sort({ createdAt: -1 });
    res.json({ success: true, count: sponsorships.length, data: sponsorships });
  } catch (error) { next(error); }
};

export const getSponsorship = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(404).json({ success: false, message: 'Sponsorship not found' });
    const sponsorship = await Sponsorship.findOne({ _id: req.params.id, industry: req.user.id })
      .populate('project', 'title description status university universityDepartment timeline')
      .populate('challenge', 'title category district status priority');
    if (!sponsorship) return res.status(404).json({ success: false, message: 'Sponsorship not found' });
    res.json({ success: true, data: sponsorship });
  } catch (error) { next(error); }
};

export const updateSponsorship = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(404).json({ success: false, message: 'Sponsorship not found' });
    const sponsorship = await Sponsorship.findOne({ _id: req.params.id, industry: req.user.id });
    if (!sponsorship) return res.status(404).json({ success: false, message: 'Sponsorship not found' });
    const nextStatus = req.body.status;
    if (nextStatus && !(sponsorship.status === 'pending' && nextStatus === 'rejected')) {
      return res.status(400).json({ success: false, message: 'Invalid sponsorship status transition' });
    }
    if (nextStatus) sponsorship.status = nextStatus;
    if (typeof req.body.expertise === 'string') sponsorship.expertise = req.body.expertise;
    if (typeof req.body.notes === 'string') sponsorship.notes = req.body.notes;
    await sponsorship.save();
    res.json({ success: true, data: sponsorship });
  } catch (error) { next(error); }
};
