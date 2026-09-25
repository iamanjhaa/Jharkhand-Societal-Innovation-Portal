import Project from '../models/Project.js';
import Challenge from '../models/Challenge.js';
import User from '../models/User.js';
import { createNotification } from '../utils/notifications.js';

function governmentDistrict(user) {
  return String(user?.governmentDistrict || user?.district || '').trim();
}

// @desc    Create a new project proposal
// @route   POST /api/projects
// @access  Private - University only
export const createProject = async (req, res, next) => {
  try {
    const {
      title,
      description,
      challenge,
      universityDepartment,
      facultyMentor,
      projectType,
      solutionSummary,
      objectives,
      expectedImpact,
      estimatedBudget,
      timeline
      , teamMembers = []
    } = req.body;

    // Validation
    if (!title || !description || !challenge || !universityDepartment || !projectType || !solutionSummary || !expectedImpact || !timeline) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: title, description, challenge, universityDepartment, projectType, solutionSummary, expectedImpact, timeline'
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

    // Only university users can create projects
    if (user.role !== 'university') {
      return res.status(403).json({
        success: false,
        message: 'Only university users can create projects'
      });
    }

    if (facultyMentor) {
      const mentor = await User.findOne({
        _id: facultyMentor,
        role: 'university',
        accountType: 'faculty',
        institution: user.institution
      });
      if (!mentor) {
        return res.status(400).json({
          success: false,
          message: 'Faculty mentor must be a registered faculty member of your university'
        });
      }
    }

    // Validate challenge exists
    const challengeDoc = await Challenge.findById(challenge);
    if (!challengeDoc) {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found'
      });
    }

    const isAssignedUniversity = challengeDoc.assignedUniversity?.toString() === userId;
    const isAssignedDepartmentMentor = challengeDoc.departmentMentor?.toString() === userId;
    const isDepartmentUser = user.universityDepartment && user.universityDepartment === challengeDoc.department
      && ['faculty', 'researcher'].includes(user.accountType);
    if (!isAssignedUniversity && !isAssignedDepartmentMentor && !isDepartmentUser) {
      return res.status(403).json({
        success: false,
        message: 'Only the assigned University or Department Mentor can create a project for this challenge'
      });
    }
    if (
      challengeDoc.assignmentStatus !== 'accepted'
      || !challengeDoc.acceptedByUniversity
      || challengeDoc.acceptedByUniversity.toString() !== challengeDoc.assignedUniversity?.toString()
    ) {
      return res.status(400).json({
        success: false,
        message: 'The assigned university must accept the challenge before project creation'
      });
    }
    if (challengeDoc.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Cancelled challenges cannot have projects created'
      });
    }
    if (isAssignedDepartmentMentor && !challengeDoc.department) {
      return res.status(400).json({ success: false, message: 'A department must be assigned before mentor project creation' });
    }
    if (!challengeDoc.department || !challengeDoc.departmentMentor) {
      return res.status(400).json({ success: false, message: 'A department and faculty mentor must be assigned before project creation' });
    }
    if (facultyMentor?.toString() !== challengeDoc.departmentMentor.toString()) {
      return res.status(400).json({ success: false, message: 'Project mentor must match the assigned faculty mentor' });
    }
    if (
      !['proposal_accepted', 'funded', 'accepted'].includes(challengeDoc.industryFundingStatus)
      || !challengeDoc.industryFundingAcceptedBy
    ) {
      return res.status(400).json({ success: false, message: 'University must accept the funding proposal and the actual funding must be recorded before project creation' });
    }

    // Validate project type
    const validProjectTypes = ['student_project', 'faculty_research', 'multidisciplinary_project', 'startup_prototype', 'research_project'];
    if (!validProjectTypes.includes(projectType)) {
      return res.status(400).json({
        success: false,
        message: `Project type must be one of: ${validProjectTypes.join(', ')}`
      });
    }

    // Validate timeline
    if (!timeline.startDate || !timeline.expectedCompletionDate) {
      return res.status(400).json({
        success: false,
        message: 'Both startDate and expectedCompletionDate are required in timeline'
      });
    }

    const startDate = new Date(timeline.startDate);
    const endDate = new Date(timeline.expectedCompletionDate);

    if (endDate <= startDate) {
      return res.status(400).json({
        success: false,
        message: 'Expected completion date must be after start date'
      });
    }
    if (!Array.isArray(teamMembers)) {
      return res.status(400).json({ success: false, message: 'Project team members must be an array' });
    }
    const selectedMembers = await User.find({
      _id: { $in: teamMembers },
      role: 'university',
      institution: user.institution,
      accountType: { $in: ['student', 'researcher'] }
    }).select('_id accountType');
    if (selectedMembers.length !== new Set(teamMembers.map(String)).size) {
      return res.status(400).json({ success: false, message: 'All selected students and researchers must belong to the same university' });
    }
    const selectedAccountTypes = new Set(selectedMembers.map((member) => member.accountType));
    if (!selectedAccountTypes.has('student') || !selectedAccountTypes.has('researcher')) {
      return res.status(400).json({
        success: false,
        message: 'At least one Student and one Researcher are required to create a project'
      });
    }

    const existingProject = await Project.findOne({ challenge: challengeDoc._id }).select('_id');
    if (existingProject) {
      return res.status(409).json({
        success: false,
        message: 'This challenge already has a project.'
      });
    }

    // Create project object
    if (universityDepartment !== challengeDoc.department) {
      return res.status(400).json({ success: false, message: 'Project department must match the assigned challenge department' });
    }
    const projectUniversity = challengeDoc.assignedUniversity;
    const projectObj = {
      title,
      description,
      challenge,
      createdBy: userId,
      university: projectUniversity,
      universityDepartment: isAssignedDepartmentMentor ? challengeDoc.department : universityDepartment,
      facultyMentor: challengeDoc.departmentMentor,
      projectType,
      solutionSummary,
      expectedImpact,
      objectives: objectives || [],
      estimatedBudget: estimatedBudget || 0,
      timeline: {
        startDate,
        expectedCompletionDate: endDate
      },
      teamMembers: selectedMembers.map((member) => member._id),
      status: 'proposed'
    };

    // Create project
    const project = await Project.create(projectObj);
    const projectRecipients = [...new Set([
      ...selectedMembers.map((member) => member._id.toString()),
      challengeDoc.departmentMentor?.toString(),
    ].filter(Boolean))];
    for (const recipient of projectRecipients) {
      void createNotification({
        recipient,
        recipientRole: 'university',
        type: 'project_created',
        title: 'Project Created',
        message: `You are part of the project "${title}".`,
        relatedEntityType: 'project',
        relatedEntityId: project._id,
        actor: req.user.id,
        actorRole: 'university',
        eventKey: `project_created:${project._id}:${recipient}`,
      }).catch((error) => console.error(`Notification creation failed: ${error.message}`));
    }

    // Populate references
    await project.populate([
      { path: 'createdBy', select: 'name email institution universityDepartment' },
      { path: 'university', select: 'name email institution universityDepartment' },
      { path: 'challenge', select: 'title category district status industryFundingStatus industryFundingAmount industryFundingAcceptedAt' },
      { path: 'teamMembers', select: 'name email institution universityDepartment accountType' },
      { path: 'facultyMentor', select: 'name email institution universityDepartment accountType' },
      { path: 'industryPartners', select: 'name email organizationName organizationType' }
    ]);

    res.status(201).json({
      success: true,
      message: 'Project created successfully',
      data: project
    });
  } catch (error) {
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

// @desc    Get all projects with optional filters
// @route   GET /api/projects
// @access  Private
export const getAllProjects = async (req, res, next) => {
  try {
    if (req.user.role !== 'government' && req.user.role !== 'university') {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to project management data'
      });
    }

    const { status, projectType, university, challenge } = req.query;

    // Build filter object
    const filter = {};
    let governmentChallengeIds = null;
    if (req.user.role === 'government') {
      const government = await User.findById(req.user.id).select('role district governmentDistrict');
      const district = governmentDistrict(government);
      if (!district) return res.status(403).json({ success: false, message: 'Government account requires district assignment' });
      governmentChallengeIds = await Challenge.find({ district }).distinct('_id');
      filter.challenge = { $in: governmentChallengeIds };
    }

    if (status) {
      filter.status = status;
    }
    if (projectType) {
      filter.projectType = projectType;
    }
    if (university) {
      filter.university = university;
    }
    if (challenge) {
      if (req.user.role === 'government' && !governmentChallengeIds.some((value) => value.toString() === challenge)) {
        return res.status(403).json({ success: false, message: 'You do not have access to projects outside your district' });
      }
      filter.challenge = challenge;
    }
    if (req.user.role === 'university') {
      const user = await User.findById(req.user.id).select('universityRole institution universityDepartment');
      if (user?.universityRole === 'innovation_coordinator') {
        const universityIds = await User.find({ role: 'university', institution: user.institution }).distinct('_id');
        filter.university = { $in: universityIds };
      } else if (user?.institution && user.universityDepartment) {
        const universityIds = await User.find({ role: 'university', institution: user.institution }).distinct('_id');
        filter.$or = [
          { university: { $in: universityIds }, universityDepartment: user.universityDepartment },
          { facultyMentor: req.user.id },
          { teamMembers: req.user.id }
        ];
      } else {
        filter.$or = [
          { university: req.user.id },
          { facultyMentor: req.user.id },
          { teamMembers: req.user.id }
        ];
      }
    }

    // Get projects sorted by newest first
    const projects = await Project.find(filter)
      .populate([
        { path: 'createdBy', select: 'name email institution universityDepartment' },
        { path: 'university', select: 'name email institution universityDepartment' },
        { path: 'challenge', select: 'title category district status' },
        { path: 'teamMembers', select: 'name email institution universityDepartment accountType' },
        { path: 'facultyMentor', select: 'name email institution universityDepartment accountType' },
        { path: 'industryPartners', select: 'name email organizationName organizationType' }
      ])
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: projects.length,
      data: projects
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get a single project by ID
// @route   GET /api/projects/:id
// @access  Private
export const getProjectById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const project = await Project.findById(id)
      .populate([
        { path: 'createdBy', select: 'name email institution universityDepartment' },
        { path: 'university', select: 'name email institution universityDepartment' },
        { path: 'challenge', select: 'title category district status description industryFundingStatus industryFundingAmount industryFundingAcceptedAt' },
        { path: 'teamMembers', select: 'name email institution universityDepartment accountType' },
        { path: 'facultyMentor', select: 'name email institution universityDepartment accountType' },
        { path: 'industryPartners', select: 'name email organizationName organizationType expertise' }
      ]);

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    if (req.user.role === 'citizen') {
      return res.status(403).json({
        success: false,
        message: 'Citizens cannot access university project details'
      });
    }

    const projectUniversityId = typeof project.university === 'string'
      ? project.university
      : project.university?._id?.toString?.() || project.university?.toString?.();

    const isProjectMentor = req.user.role === 'university'
      && (
        project.facultyMentor?._id?.toString?.() === req.user.id
        || project.facultyMentor?.toString?.() === req.user.id
        || project.teamMembers?.some((member) => member?._id?.toString?.() === req.user.id || member?.toString?.() === req.user.id)
      );
    const departmentUser = req.user.role === 'university'
      ? await User.findById(req.user.id).select('institution universityDepartment universityRole')
      : null;
    const isDepartmentProject = departmentUser
      && departmentUser.universityRole !== 'innovation_coordinator'
      && departmentUser.institution === project.university?.institution
      && departmentUser.universityDepartment === project.universityDepartment;
    if (req.user.role === 'university' && projectUniversityId !== req.user.id && !isProjectMentor && !isDepartmentProject) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this project'
      });
    }

    if (req.user.role === 'government') {
      const government = await User.findById(req.user.id).select('role district governmentDistrict');
      const district = governmentDistrict(government);
      if (!district || project.challenge?.district !== district) {
        return res.status(403).json({ success: false, message: 'You do not have access to projects outside your district' });
      }
    }

    if (req.user.role !== 'government' && req.user.role !== 'university') {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this project'
      });
    }

    res.status(200).json({
      success: true,
      data: project
    });
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    next(error);
  }
};

// @desc    Update project status
// @route   PATCH /api/projects/:id/status
// @access  Private - Government or project-owning university
export const updateProjectStatus = async (req, res, next) => {
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

    const validStatuses = ['proposed', 'under_review', 'approved', 'prototype', 'testing', 'deployed', 'completed', 'rejected'];
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

    // Find project
    const project = await Project.findById(id);

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    if (user.role === 'government') {
      const government = await User.findById(userId).select('role district governmentDistrict');
      const district = governmentDistrict(government);
      const challenge = await Challenge.findById(project.challenge).select('district');
      if (!district || challenge?.district !== district) {
        return res.status(403).json({ success: false, message: 'You cannot manage projects outside your district' });
      }
    }

    // Authorization check
    const isProjectOwner = project.university.toString() === userId;
    const isGovernment = user.role === 'government';

    // Government can change any status
    // University can only update progress-related statuses for their own projects
    if (!isGovernment && !isProjectOwner) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this project status'
      });
    }

    // If university is updating, restrict to progress-related statuses
    if (isProjectOwner && !isGovernment) {
      if (['prototype', 'testing', 'deployed', 'completed'].includes(status)) {
        const challenge = await Challenge.findById(project.challenge).select('assignedUniversity assignmentStatus acceptedByUniversity cancelledAt industryFundingStatus industryFundingAcceptedBy');
        const executionAuthorized = challenge
          && challenge.assignedUniversity?.toString() === userId
          && challenge.assignmentStatus === 'accepted'
          && challenge.acceptedByUniversity?.toString() === userId
          && !challenge.cancelledAt
          && challenge.industryFundingStatus === 'accepted'
          && challenge.industryFundingAcceptedBy?.toString() === userId;
        if (!executionAuthorized) {
          return res.status(403).json({ success: false, message: 'Industry funding must be accepted by the University before project execution starts' });
        }
      }
      const progressStatuses = ['prototype', 'testing', 'deployed', 'completed'];
      if (!progressStatuses.includes(status)) {
        return res.status(403).json({
          success: false,
          message: 'Universities can only update to: prototype, testing, deployed, or completed'
        });
      }
      const allowedTransitions = {
        proposed: ['prototype'],
        prototype: ['testing'],
        testing: ['deployed', 'completed'],
        deployed: ['completed'],
        completed: ['completed']
      };

      if (!allowedTransitions[project.status]?.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Cannot change project status from ${project.status} to ${status}`
        });
      }
    }

    // Update project
    const updatedProject = await Project.findByIdAndUpdate(
      id,
      { status },
      { new: true, runValidators: true }
    )
      .populate([
        { path: 'createdBy', select: 'name email institution universityDepartment' },
        { path: 'university', select: 'name email institution universityDepartment' },
        { path: 'challenge', select: 'title category district status' },
        { path: 'teamMembers', select: 'name email' },
        { path: 'industryPartners', select: 'name email organizationName' }
      ]);

    if (status === 'completed') {
      await Challenge.findByIdAndUpdate(project.challenge, { status: 'resolved' });
    }

    res.status(200).json({
      success: true,
      message: 'Project status updated successfully',
      data: updatedProject
    });

  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    next(error);
  }
};

// @desc    Update project team members
// @route   PATCH /api/projects/:id/team
// @access  Private - Project-owning university only
export const updateProjectProgress = async (req, res, next) => {
  try {
    const { currentStage } = req.body;
    const stageProgress = {
      proposed: 0,
      prototype: 25,
      testing: 50,
      deployed: 75,
      completed: 100
    };
    if (!Object.prototype.hasOwnProperty.call(stageProgress, currentStage)) {
      return res.status(400).json({ success: false, message: 'Current stage must be one of: proposed, prototype, testing, deployed, completed' });
    }
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    const challenge = await Challenge.findById(project.challenge).select('title district departmentMentor cancelledAt industryFundingStatus industryFundedBy');
    const user = await User.findById(req.user.id).select('role institution universityDepartment universityRole');
    const university = await User.findById(project.university).select('institution');
    const isMentor = challenge?.departmentMentor?.toString() === req.user.id && project.facultyMentor?.toString() === req.user.id;
    const isTeamMember = project.teamMembers.some((member) => member.toString() === req.user.id);
    const isOwner = project.university.toString() === req.user.id;
    const isAuthorizedDepartment = user?.role === 'university'
      && user.universityRole !== 'innovation_coordinator'
      && user.institution === university?.institution
      && user.universityDepartment === project.universityDepartment;
    if (!user || user.role !== 'university' || (!isOwner && !isMentor && !isTeamMember && !isAuthorizedDepartment)) {
      return res.status(403).json({ success: false, message: 'Only authorized project users can update progress' });
    }
    if (challenge?.cancelledAt || !['accepted', 'proposal_accepted', 'funded'].includes(challenge?.industryFundingStatus)) {
      return res.status(400).json({ success: false, message: 'Industry funding must be accepted before progress can be updated' });
    }
    const stageOrder = ['proposed', 'prototype', 'testing', 'deployed', 'completed'];
    const currentIndex = stageOrder.indexOf(project.currentStage || 'proposed');
    const nextIndex = stageOrder.indexOf(currentStage);
    if (nextIndex !== currentIndex + 1) {
      const nextStage = stageOrder[currentIndex + 1];
      return res.status(400).json({
        success: false,
        message: nextStage
          ? `Invalid stage transition. Project must move from ${project.currentStage || 'proposed'} to ${nextStage} first.`
          : 'Project is already completed and has no next stage.'
      });
    }
    if (!project.progressUpdates) project.progressUpdates = [];
    const existingUpdate = project.progressUpdates.find((update) => update.stage === currentStage);
    if (existingUpdate) {
      existingUpdate.percentage = stageProgress[currentStage];
      existingUpdate.updatedBy = req.user.id;
      existingUpdate.updatedAt = new Date();
    } else {
      project.progressUpdates.push({
        stage: currentStage,
        percentage: stageProgress[currentStage],
        updatedBy: req.user.id,
        updatedAt: new Date()
      });
    }
    project.progressPercentage = stageProgress[currentStage];
    project.currentStage = currentStage;
    project.status = currentStage;
    await project.save();
    if (currentStage === 'completed') {
      await Challenge.findByIdAndUpdate(project.challenge, { status: 'under_review' });
    }
    const universityOwner = await User.findById(project.university).select('_id institution');
    const coordinators = universityOwner
      ? await User.find({ role: 'university', universityRole: 'innovation_coordinator', institution: universityOwner.institution }).select('_id role').lean()
      : [];
    const recipients = [
      ...project.industryPartners.map((partner) => partner.toString()),
      ...(challenge?.industryFundedBy ? [challenge.industryFundedBy.toString()] : []),
      project.university.toString(),
      ...coordinators.map((coordinator) => coordinator._id.toString()),
    ];
    for (const recipient of [...new Set(recipients)]) {
      const isDeployment = currentStage === 'deployed';
      const recipientRole = recipient === project.university.toString()
        || coordinators.some((coordinator) => coordinator._id.toString() === recipient)
        ? 'university'
        : 'industry';
      void createNotification({
        recipient,
        recipientRole,
        type: currentStage === 'completed' ? 'solution_verification_required' : isDeployment ? 'solution_deployed' : 'project_progress_updated',
        title: currentStage === 'completed'
          ? 'Solution Ready for Verification'
          : isDeployment
            ? 'Solution Deployed'
            : recipientRole === 'industry' ? 'Project Progress Update' : 'Project Progress Updated',
        message: currentStage === 'completed'
          ? `Project "${project.title}" has been completed and is awaiting Government verification.`
          : recipientRole === 'industry'
            ? `Project "${project.title}" is now ${stageProgress[currentStage]}% complete and currently in ${currentStage}.`
            : `Project "${project.title}" is now at ${stageProgress[currentStage]}% — ${currentStage}.`,
        relatedEntityType: 'project',
        relatedEntityId: project._id,
        actor: req.user.id,
        actorRole: 'university',
        eventKey: `project_progress:${project._id}:${currentStage}:${recipient}`,
      }).catch((error) => console.error(`Notification creation failed: ${error.message}`));
    }
    if (currentStage === 'completed') {
      const governments = await User.find({
        role: 'government',
        $or: [{ district: challenge.district }, { governmentDistrict: challenge.district }],
      }).select('_id role').lean();
      for (const government of governments) {
        void createNotification({
          recipient: government._id,
          recipientRole: government.role,
          type: 'solution_verification_required',
          title: 'Solution Ready for Verification',
          message: `The university has completed the solution for "${challenge.title}". Government verification is required.`,
          relatedEntityType: 'project',
          relatedEntityId: project._id,
          actor: req.user.id,
          actorRole: 'university',
          eventKey: `solution_verification_required:${project._id}:${government._id}`,
        }).catch((error) => console.error(`Notification creation failed: ${error.message}`));
      }
    }
    return res.status(200).json({ success: true, message: 'Project progress updated successfully', data: project });
  } catch (error) {
    if (error.kind === 'ObjectId') return res.status(404).json({ success: false, message: 'Project not found' });
    next(error);
  }
};

export const updateProjectTeam = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { teamMembers } = req.body;

    // Validation
    if (!Array.isArray(teamMembers)) {
      return res.status(400).json({
        success: false,
        message: 'teamMembers must be an array of user IDs'
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

    // Find project
    const project = await Project.findById(id);

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    const challenge = await Challenge.findById(project.challenge).select('departmentMentor department departmentMentor');
    const isProjectOwner = project.university.toString() === userId;
    const isAssignedMentor = challenge?.departmentMentor?.toString() === userId
      && project.facultyMentor?.toString() === userId
      && project.universityDepartment === challenge.department;
    if (!isProjectOwner && !isAssignedMentor) {
      return res.status(403).json({
        success: false,
        message: 'Only the project-owning University or assigned Department Mentor can manage team members'
      });
    }
    // Verify all users exist
    const owner = await User.findById(userId).select('institution role');
    const users = await User.find({
      _id: { $in: teamMembers },
      role: 'university',
      institution: owner.institution,
      accountType: { $in: ['student', 'researcher'] }
    });
    if (users.length !== teamMembers.length) {
      return res.status(400).json({
        success: false,
        message: 'One or more team member IDs are invalid'
      });
    }
    const teamAccountTypes = new Set(users.map((member) => member.accountType));
    if (!teamAccountTypes.has('student') || !teamAccountTypes.has('researcher')) {
      return res.status(400).json({
        success: false,
        message: 'At least one Student and one Researcher are required on the project team'
      });
    }

    // Update project team
    const updatedProject = await Project.findByIdAndUpdate(
      id,
      { teamMembers },
      { new: true, runValidators: true }
    )
      .populate([
        { path: 'createdBy', select: 'name email institution' },
        { path: 'university', select: 'name email institution' },
        { path: 'challenge', select: 'title category' },
        { path: 'teamMembers', select: 'name email institution accountType' },
        { path: 'industryPartners', select: 'name email organizationName' }
      ]);

    res.status(200).json({
      success: true,
      message: 'Project team updated successfully',
      data: updatedProject
    });
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    next(error);
  }
};

export const updateProjectSolution = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('role institution universityDepartment');
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    const challenge = await Challenge.findById(project.challenge).select('departmentMentor department assignedUniversity assignmentStatus industryFundingStatus');
    const isMentor = user?.role === 'university'
      && challenge?.departmentMentor?.toString() === req.user.id
      && project.facultyMentor?.toString() === req.user.id
      && project.universityDepartment === challenge.department;
    const isTeamMember = user?.role === 'university'
      && project.teamMembers.some((member) => member.toString() === req.user.id)
      && user.institution === (await User.findById(project.university).select('institution'))?.institution;
    if (!isMentor && !isTeamMember) {
      return res.status(403).json({ success: false, message: 'Only the assigned mentor or project team can update the solution' });
    }
    const fields = ['solutionTitle', 'solutionDescription', 'solutionApproach', 'technology', 'implementationDetails', 'expectedOutcome'];
    const update = {};
    for (const field of fields) {
      if (req.body[field] !== undefined) {
        if (typeof req.body[field] !== 'string') return res.status(400).json({ success: false, message: `${field} must be text` });
        update[field] = req.body[field].trim();
      }
    }
    if (req.body.solutionStatus !== undefined) {
      if (!['draft', 'submitted'].includes(req.body.solutionStatus)) return res.status(400).json({ success: false, message: 'Invalid solution status' });
      if (req.body.solutionStatus === 'submitted' && !isMentor) return res.status(403).json({ success: false, message: 'Only the assigned mentor can submit a solution' });
      update.solutionStatus = req.body.solutionStatus;
    }
    if (update.solutionStatus === 'submitted') {
      const requiredFields = ['solutionTitle', 'solutionDescription', 'solutionApproach', 'expectedOutcome'];
      const missingField = requiredFields.find((field) => !update[field] && !project[field]);
      if (missingField) {
        return res.status(400).json({
          success: false,
          message: `${missingField} is required before submitting a solution`
        });
      }
    }
    const updatedProject = await Project.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true })
      .populate([
        { path: 'challenge', select: 'title category district status industryFundingStatus industryFundingAmount' },
        { path: 'facultyMentor', select: 'name email institution universityDepartment accountType' },
        { path: 'teamMembers', select: 'name email institution universityDepartment accountType' }
      ]);
    if (update.solutionStatus === 'submitted') {
      void createNotification({
        recipient: updatedProject.university,
        recipientRole: 'university',
        type: 'solution_submitted',
        title: 'Solution Submitted',
        message: `The solution for "${updatedProject.challenge.title}" is ready for review.`,
        relatedEntityType: 'project',
        relatedEntityId: updatedProject._id,
        actor: req.user.id,
        actorRole: 'university',
        eventKey: `solution_submitted:${updatedProject._id}`,
      }).catch((error) => console.error(`Notification creation failed: ${error.message}`));
    }
    res.status(200).json({ success: true, message: 'Solution updated successfully', data: updatedProject });
  } catch (error) {
    if (error.kind === 'ObjectId') return res.status(404).json({ success: false, message: 'Project not found' });
    next(error);
  }
};

// @desc    Update the faculty mentor for a project
// @route   PATCH /api/projects/:id/faculty
// @access  Private - Project-owning university only
export const updateProjectFaculty = async (req, res, next) => {
  try {
    const { facultyMentor } = req.body;
    const user = await User.findById(req.user.id);
    if (!user || user.role !== 'university') {
      return res.status(403).json({
        success: false,
        message: 'Only university users can assign a faculty mentor'
      });
    }

    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }
    if (project.university.toString() !== user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only the project-owning university can assign a faculty mentor'
      });
    }

    const mentor = await User.findOne({
      _id: facultyMentor,
      role: 'university',
      accountType: 'faculty',
      institution: user.institution
    });
    if (!mentor) {
      return res.status(400).json({
        success: false,
        message: 'Faculty mentor must be a registered faculty member of your university'
      });
    }

    const updatedProject = await Project.findByIdAndUpdate(
      project._id,
      { facultyMentor: mentor._id },
      { new: true, runValidators: true }
    ).populate('facultyMentor', 'name email institution universityDepartment accountType');

    res.status(200).json({
      success: true,
      message: 'Faculty mentor assigned successfully',
      data: updatedProject
    });
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Project or faculty mentor not found'
      });
    }
    next(error);
  }
};

// @desc    Update project industry partners
// @route   PATCH /api/projects/:id/partners
// @access  Private - Project-owning university or government
export const updateProjectPartners = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { industryPartners } = req.body;

    // Validation
    if (!Array.isArray(industryPartners)) {
      return res.status(400).json({
        success: false,
        message: 'industryPartners must be an array of user IDs'
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

    // Find project
    const project = await Project.findById(id);

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // Authorization check
    const isProjectOwner = project.university.toString() === userId;
    const isGovernment = user.role === 'government';

    if (!isProjectOwner && !isGovernment) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to manage project partners'
      });
    }

    // Verify all partners exist and have industry role
    const partners = await User.find({ _id: { $in: industryPartners } });
    if (partners.length !== industryPartners.length) {
      return res.status(400).json({
        success: false,
        message: 'One or more partner IDs are invalid'
      });
    }

    // Verify all partners have industry role
    const allIndustry = partners.every(p => p.role === 'industry');
    if (!allIndustry) {
      return res.status(400).json({
        success: false,
        message: 'All partners must have industry role'
      });
    }

    // Update project partners
    const updatedProject = await Project.findByIdAndUpdate(
      id,
      { industryPartners },
      { new: true, runValidators: true }
    )
      .populate([
        { path: 'createdBy', select: 'name email institution' },
        { path: 'university', select: 'name email institution' },
        { path: 'challenge', select: 'title category' },
        { path: 'teamMembers', select: 'name email' },
        { path: 'industryPartners', select: 'name email organizationName organizationType' }
      ]);

    res.status(200).json({
      success: true,
      message: 'Project partners updated successfully',
      data: updatedProject
    });
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    next(error);
  }
};

// @desc    Delete a project
// @route   DELETE /api/projects/:id
// @access  Private - Project-owning university or government
export const deleteProject = async (req, res, next) => {
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

    // Find project
    const project = await Project.findById(id);

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // Authorization check
    const isProjectOwner = project.university.toString() === userId;
    const isGovernment = user.role === 'government';

    if (!isProjectOwner && !isGovernment) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this project'
      });
    }

    // Delete project
    await Project.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Project deleted successfully'
    });
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    next(error);
  }
};
