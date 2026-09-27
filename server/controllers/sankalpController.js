import mongoose from 'mongoose';
import Challenge from '../models/Challenge.js';
import User from '../models/User.js';
import { SANKALP_CLUB } from '../constants/universityDepartments.js';
import { createNotification } from '../utils/notifications.js';

const organizationRoles = { NCC: 'cadet', NSS: 'volunteer' };

async function getCoordinator(userId) {
  const user = await User.findById(userId).select('role universityRole institution');
  if (!user || user.role !== 'university' || user.universityRole !== 'innovation_coordinator' || !user.institution) {
    return null;
  }
  return user;
}

async function getSankalpMentor(userId) {
  return User.findOne({
    _id: userId,
    role: 'university',
    accountType: 'faculty',
    'sankalpClubProfile.club': SANKALP_CLUB,
    'sankalpClubProfile.role': 'Sankalp Club Mentor',
    'sankalpClubProfile.active': true
  }).select('_id institution name email mobile sankalpClubProfile');
}

export const getSankalpMentors = async (req, res, next) => {
  try {
    const coordinator = await getCoordinator(req.user.id);
    if (!coordinator) {
      return res.status(403).json({ success: false, message: 'Only a University Innovation Coordinator can view Sankalp Club mentors' });
    }
    const mentors = await User.find({
      role: 'university',
      accountType: 'faculty',
      institution: coordinator.institution,
      'sankalpClubProfile.club': SANKALP_CLUB,
      'sankalpClubProfile.role': 'Sankalp Club Mentor',
      'sankalpClubProfile.active': true
    })
      .select('_id name email mobile institution accountType sankalpClubProfile.club sankalpClubProfile.role')
      .sort({ name: 1 })
      .lean();
    return res.status(200).json({
      success: true,
      data: mentors.map((mentor) => ({
        _id: mentor._id,
        name: mentor.name,
        email: mentor.email,
        mobile: mentor.mobile,
        institution: mentor.institution,
        role: 'Sankalp Club Mentor',
        club: SANKALP_CLUB,
        active: true
      }))
    });
  } catch (error) {
    next(error);
  }
};

export const registerSankalpMentor = async (req, res, next) => {
  try {
    const coordinator = await getCoordinator(req.user.id);
    if (!coordinator) {
      return res.status(403).json({ success: false, message: 'Only a University Innovation Coordinator can assign Sankalp Club mentors' });
    }
    if (!mongoose.isValidObjectId(req.body.mentorId)) {
      return res.status(400).json({ success: false, message: 'Select a valid faculty account' });
    }
    const mentor = await User.findOne({
      _id: req.body.mentorId,
      role: 'university',
      accountType: 'faculty',
      institution: coordinator.institution
    });
    if (!mentor) {
      return res.status(404).json({ success: false, message: 'The selected faculty account is not registered at this University' });
    }
    if (mentor.sankalpClubProfile?.role === 'Sankalp Club Mentor' && mentor.sankalpClubProfile.active) {
      return res.status(409).json({ success: false, message: 'This faculty member is already an active Sankalp Club mentor' });
    }
    mentor.sankalpClubProfile = {
      club: SANKALP_CLUB,
      role: 'Sankalp Club Mentor',
      active: true,
      available: true,
      currentAssignment: null
    };
    await mentor.save();
    return res.status(200).json({
      success: true,
      message: 'Sankalp Club mentor assigned successfully',
      data: {
        _id: mentor._id,
        name: mentor.name,
        email: mentor.email,
        mobile: mentor.mobile,
        institution: mentor.institution,
        role: 'Sankalp Club Mentor',
        club: SANKALP_CLUB,
        active: true
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getSankalpStudents = async (req, res, next) => {
  try {
    const mentor = await getSankalpMentor(req.user.id);
    if (!mentor) {
      return res.status(403).json({ success: false, message: 'An active Sankalp Club Mentor profile is required' });
    }
    const organization = String(req.query.organization || '').trim().toUpperCase();
    if (!Object.hasOwn(organizationRoles, organization)) {
      return res.status(400).json({ success: false, message: 'Organization must be NCC or NSS' });
    }
    const students = await User.find({
      role: 'university',
      accountType: 'student',
      institution: mentor.institution,
      primaryClub: organization,
      'sankalpClubProfile.club': SANKALP_CLUB,
      'sankalpClubProfile.organization': organization,
      'sankalpClubProfile.role': organizationRoles[organization],
      'sankalpClubProfile.active': true,
      'sankalpClubProfile.available': true,
      'sankalpClubProfile.currentAssignment': null
    })
      .select('_id name institution universityDepartment accountType sankalpClubProfile.organization sankalpClubProfile.role sankalpClubProfile.studentId sankalpClubProfile.course sankalpClubProfile.yearSemester sankalpClubProfile.skillsInterests sankalpClubProfile.currentAssignment')
      .sort({ name: 1 })
      .lean();
    return res.status(200).json({
      success: true,
      data: students.map((student) => ({
        _id: student._id,
        name: student.name,
        studentId: student.sankalpClubProfile.studentId,
        institution: student.institution,
        course: student.sankalpClubProfile.course,
        yearSemester: student.sankalpClubProfile.yearSemester,
        organization: student.sankalpClubProfile.organization,
        role: student.sankalpClubProfile.role,
        skillsInterests: student.sankalpClubProfile.skillsInterests || '',
        availability: 'Available',
        currentAssignments: 0
      }))
    });
  } catch (error) {
    next(error);
  }
};

export const assignSankalpStudents = async (req, res, next) => {
  const reservedStudentIds = [];
  let challengeId;
  let studentsCommitted = false;
  try {
    const mentor = await getSankalpMentor(req.user.id);
    if (!mentor) {
      return res.status(403).json({ success: false, message: 'An active Sankalp Club Mentor profile is required' });
    }
    challengeId = req.body.challengeId;
    const studentIds = req.body.studentIds;
    if (!mongoose.isValidObjectId(challengeId) || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ success: false, message: 'A valid challenge and at least one student are required' });
    }
    if (studentIds.length > 50 || studentIds.some((id) => !mongoose.isValidObjectId(id))) {
      return res.status(400).json({ success: false, message: 'Student selection contains an invalid ID or exceeds the team limit' });
    }
    const uniqueStudentIds = [...new Set(studentIds.map(String))];
    if (uniqueStudentIds.length !== studentIds.length) {
      return res.status(400).json({ success: false, message: 'A student can only be selected once' });
    }

    const challenge = await Challenge.findOne({
      _id: challengeId,
      department: SANKALP_CLUB,
      departmentMentor: mentor._id,
      assignedUniversity: { $ne: null },
      status: { $in: ['accepted', 'funding_approved', 'in_progress'] },
      studentsAssigned: { $ne: true },
      $or: [
        { selectedStudents: { $exists: false } },
        { selectedStudents: { $size: 0 } }
      ]
    });
    if (!challenge) {
      return res.status(404).json({ success: false, message: 'Sankalp Club problem not found, not assigned to this mentor, or already has a team' });
    }
    const university = await User.findOne({ _id: challenge.assignedUniversity, role: 'university' }).select('institution');
    if (!university || university.institution !== mentor.institution) {
      return res.status(403).json({ success: false, message: 'This problem is assigned to another University' });
    }

    const students = await User.find({
      _id: { $in: uniqueStudentIds },
      role: 'university',
      accountType: 'student',
      institution: mentor.institution,
      'sankalpClubProfile.club': SANKALP_CLUB,
      'sankalpClubProfile.active': true,
      'sankalpClubProfile.available': true,
      'sankalpClubProfile.currentAssignment': null,
      $or: [
        { 'sankalpClubProfile.organization': 'NCC', 'sankalpClubProfile.role': 'cadet', primaryClub: 'NCC' },
        { 'sankalpClubProfile.organization': 'NSS', 'sankalpClubProfile.role': 'volunteer', primaryClub: 'NSS' }
      ]
    }).select('_id sankalpClubProfile.organization sankalpClubProfile.role');
    if (students.length !== uniqueStudentIds.length) {
      return res.status(400).json({ success: false, message: 'Every selected student must be an active, available NCC cadet or NSS volunteer at this University' });
    }

    for (const student of students) {
      const organization = student.sankalpClubProfile.organization;
      const reservation = await User.updateOne({
        _id: student._id,
        'sankalpClubProfile.active': true,
        'sankalpClubProfile.available': true,
        'sankalpClubProfile.currentAssignment': null,
        'sankalpClubProfile.club': SANKALP_CLUB,
        'sankalpClubProfile.organization': organization,
        'sankalpClubProfile.role': organizationRoles[organization],
        primaryClub: organization
      }, {
        $set: {
          'sankalpClubProfile.available': false,
          'sankalpClubProfile.currentAssignment': challenge._id
        }
      });
      if (reservation.modifiedCount !== 1) {
        await User.updateMany(
          { _id: { $in: reservedStudentIds }, 'sankalpClubProfile.currentAssignment': challenge._id },
          { $set: { 'sankalpClubProfile.available': true, 'sankalpClubProfile.currentAssignment': null } }
        );
        return res.status(409).json({ success: false, message: 'A selected student is no longer available. Refresh the student list and try again.' });
      }
      reservedStudentIds.push(student._id);
    }

    const selectedStudents = students.map((student) => ({
      studentId: student._id,
      organization: student.sankalpClubProfile.organization,
      selectedAt: new Date()
    }));
    const updated = await Challenge.updateOne({
      _id: challenge._id,
      departmentMentor: mentor._id,
      department: SANKALP_CLUB,
      studentsAssigned: { $ne: true },
      $or: [
        { selectedStudents: { $exists: false } },
        { selectedStudents: { $size: 0 } }
      ]
    }, {
      $set: { selectedStudents, studentsAssigned: true, status: 'in_progress' }
    }, { runValidators: true });
    if (updated.modifiedCount !== 1) {
      await User.updateMany(
        { _id: { $in: reservedStudentIds }, 'sankalpClubProfile.currentAssignment': challenge._id },
        { $set: { 'sankalpClubProfile.available': true, 'sankalpClubProfile.currentAssignment': null } }
      );
      return res.status(409).json({ success: false, message: 'This problem was assigned to a team at the same time. Refresh and try again.' });
    }
    studentsCommitted = true;

    const assignedChallenge = await Challenge.findById(challenge._id)
      .populate('departmentMentor', 'name email institution accountType sankalpClubProfile.club sankalpClubProfile.role')
      .populate('selectedStudents.studentId', 'name institution sankalpClubProfile.organization sankalpClubProfile.role');
    return res.status(200).json({ success: true, message: 'Cadets and volunteers assigned successfully', data: assignedChallenge });
  } catch (error) {
    if (reservedStudentIds.length && challengeId && !studentsCommitted) {
      await User.updateMany(
        { _id: { $in: reservedStudentIds }, 'sankalpClubProfile.currentAssignment': challengeId },
        { $set: { 'sankalpClubProfile.available': true, 'sankalpClubProfile.currentAssignment': null } }
      );
    }
    next(error);
  }
};

export const submitSankalpChallengeForVerification = async (req, res, next) => {
  try {
    const mentor = await getSankalpMentor(req.user.id);
    if (!mentor) {
      return res.status(403).json({ success: false, message: 'An active Sankalp Club Mentor profile is required' });
    }
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, message: 'Sankalp Club problem not found' });
    }
    const challenge = await Challenge.findOneAndUpdate({
      _id: req.params.id,
      department: SANKALP_CLUB,
      departmentMentor: mentor._id,
      studentsAssigned: true,
      status: 'in_progress'
    }, {
      $set: { status: 'under_review' }
    }, { new: true, runValidators: true });
    if (!challenge) {
      return res.status(409).json({ success: false, message: 'Only your in-progress Sankalp Club problems with an assigned team can be submitted for verification' });
    }

    const governments = await User.find({
      role: 'government',
      $or: [{ governmentDistrict: challenge.district }, { district: challenge.district }]
    }).select('_id role').lean();
    for (const government of governments) {
      void createNotification({
        recipient: government._id,
        recipientRole: government.role,
        type: 'sankalp_verification_submitted',
        title: 'Sankalp Club solution submitted',
        message: `"${challenge.title}" is ready for Government verification.`,
        relatedEntityType: 'challenge',
        relatedEntityId: challenge._id,
        actor: mentor._id,
        actorRole: 'university',
        eventKey: `sankalp_verification_submitted:${challenge._id}:${government._id}`
      }).catch((error) => console.error(`Sankalp verification notification failed: ${error.message}`));
    }
    return res.status(200).json({ success: true, message: 'Problem submitted for Government verification', data: challenge });
  } catch (error) {
    next(error);
  }
};
