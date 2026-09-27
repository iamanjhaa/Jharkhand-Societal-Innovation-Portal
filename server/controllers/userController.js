import User from '../models/User.js';
import Challenge from '../models/Challenge.js';
import Project from '../models/Project.js';

// @desc    Get registered university users
// @route   GET /api/users/universities
// @access  Private - Government only
export const getUniversities = async (req, res, next) => {
  try {
    const universities = await User.find({
      role: 'university',
      accountType: 'coordinator',
      universityRole: 'innovation_coordinator',
    })
      .select('_id name email institution accountType universityRole')
      .sort({ institution: 1, name: 1 })
      .lean();

    res.status(200).json({
      success: true,
      data: universities
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get registered universities with current participation counts
// @route   GET /api/users/university-participation
// @access  Private - Government only
export const getUniversityParticipation = async (req, res, next) => {
  try {
    const government = await User.findById(req.user.id).select('role district governmentDistrict').lean();
    const governmentDistrict = String(government?.governmentDistrict || government?.district || '').trim();
    if (government?.role !== 'government' || !governmentDistrict) {
      return res.status(403).json({ success: false, message: 'Government account requires district assignment' });
    }
    const universities = await User.find({ role: 'university' })
      .select('_id name institution')
      .sort({ institution: 1, name: 1 })
      .lean();
    const universityIds = universities.map((university) => university._id);
    const districtChallengeIds = await Challenge.find({ district: governmentDistrict }).distinct('_id');

    const [assignedCounts, projectCounts] = await Promise.all([
      Challenge.aggregate([
        { $match: { _id: { $in: districtChallengeIds }, assignedUniversity: { $in: universityIds } } },
        { $group: { _id: '$assignedUniversity', assigned: { $sum: 1 } } }
      ]),
      Project.aggregate([
        { $match: { challenge: { $in: districtChallengeIds }, university: { $in: universityIds } } },
        {
          $group: {
            _id: '$university',
            active: {
              $sum: {
              $cond: [{ $in: ['$status', ['prototype', 'testing', 'deployed', 'in_progress']] }, 1, 0]
              }
            },
            completed: {
              $sum: {
                $cond: [{ $eq: ['$status', 'completed'] }, 1, 0]
              }
            }
          }
        }
      ])
    ]);

    const assignedByUniversity = new Map(assignedCounts.map((item) => [item._id.toString(), item.assigned]));
    const projectsByUniversity = new Map(projectCounts.map((item) => [item._id.toString(), item]));
    const participation = universities.map((university) => {
      const assigned = assignedByUniversity.get(university._id.toString()) || 0;
      const projects = projectsByUniversity.get(university._id.toString());
      const active = projects?.active || 0;
      const completed = projects?.completed || 0;
      return {
        universityId: university._id,
        universityName: university.institution || university.name,
        assigned,
        active,
        completed,
        status: assigned > 0 || active > 0 || completed > 0 ? 'Active' : 'Registered'
      };
    });

    res.status(200).json({ success: true, data: participation });
  } catch (error) {
    next(error);
  }
};

// @desc    Get university members from the authenticated user's institution
// @route   GET /api/users/university-members
// @access  Private - University only
export const getUniversityMembers = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('role institution');
    if (!user || user.role !== 'university') {
      return res.status(403).json({ success: false, message: 'Only university users can view university members' });
    }

    const members = await User.find({ role: 'university', institution: user.institution })
      .select('_id name email mobile institution universityDepartment accountType sankalpClubProfile.club sankalpClubProfile.role sankalpClubProfile.active')
      .sort({ name: 1 })
      .lean();

    res.status(200).json({ success: true, data: members });
  } catch (error) {
    next(error);
  }
};

export const getDepartmentMembers = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('role institution universityDepartment universityRole');
    if (!user || user.role !== 'university' || !user.institution || !user.universityDepartment) {
      return res.status(403).json({ success: false, message: 'A university department profile is required' });
    }

    const members = await User.find({
      role: 'university',
      institution: user.institution,
      universityDepartment: user.universityDepartment,
      accountType: { $in: ['student', 'researcher', 'faculty'] }
    })
      .select('_id name email institution universityDepartment accountType primaryClub')
      .sort({ accountType: 1, name: 1 })
      .lean();

    res.status(200).json({ success: true, data: members });
  } catch (error) {
    next(error);
  }
};
