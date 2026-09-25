import User from '../models/User.js';
import generateToken from '../utils/generateToken.js';
import { UNIVERSITY_DEPARTMENTS } from '../constants/universityDepartments.js';
import { UNIVERSITY_CLUBS } from '../constants/universityClubs.js';
import UniversityCoordinatorCode from '../models/UniversityCoordinatorCode.js';
import { createCoordinatorCode, hashCoordinatorCode, normalizeInstitution } from '../utils/universityCoordinatorCodes.js';

export const getUniversityInstitutions = async (req, res, next) => {
  try {
    const institutions = await User.distinct('institution', {
      role: 'university',
      institution: { $exists: true, $ne: '' }
    });
    return res.status(200).json({ success: true, data: institutions.sort((a, b) => a.localeCompare(b)) });
  } catch (error) {
    next(error);
  }
};

export const generateUniversityCoordinatorCode = async (req, res, next) => {
  try {
    const institutionKey = normalizeInstitution(req.body.institution);
    if (!institutionKey) return res.status(400).json({ success: false, message: 'Select a University/Institution' });

    const institution = (await User.findOne({
      role: 'university',
      institution: { $exists: true, $ne: '' },
      $expr: { $eq: [{ $toLower: '$institution' }, institutionKey] }
    }).select('institution'))?.institution;
    if (!institution) return res.status(404).json({ success: false, message: 'University/Institution is not registered' });

    const code = createCoordinatorCode();
    const update = {
      institution,
      institutionKey,
      codeHash: hashCoordinatorCode(code),
      active: true,
      rotatedAt: new Date()
    };
    const existing = await UniversityCoordinatorCode.findOne({ institutionKey }).select('_id');
    if (existing) await UniversityCoordinatorCode.updateOne({ _id: existing._id }, update);
    else await UniversityCoordinatorCode.create(update);

    return res.status(201).json({ success: true, message: 'Authorization code generated. Save it before continuing.', data: { institution, code } });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'An active coordinator code already exists for this University' });
    next(error);
  }
};

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
export const registerUser = async (req, res, next) => {
  try {
    const { name, email, password, role, universityCoordinatorCode, ...roleSpecificData } = req.body;

    // Validation
    if (!name || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: name, email, password, and role'
      });
    }

    // Validate password length
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }

    // Validate email format
    const emailRegex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    // Validate role
    const validRoles = ['citizen', 'government', 'university', 'industry'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Role must be one of: ${validRoles.join(', ')}`
      });
    }
    if (role !== 'university' && roleSpecificData.accountType === 'coordinator') {
      return res.status(400).json({
        success: false,
        message: 'University Coordinator account type is only valid for University accounts'
      });
    }
    if (role === 'government' && !String(roleSpecificData.governmentDistrict || roleSpecificData.district || '').trim()) {
      return res.status(400).json({ success: false, message: 'Government district is required' });
    }

    // Check if user already exists
    let user = await User.findOne({ email: email.toLowerCase() });
    if (user) {
      return res.status(409).json({
        success: false,
        message: 'Email already registered'
      });
    }

    // Create user object
    const userObj = {
      name,
      email: email.toLowerCase(),
      password,
      role,
      ...roleSpecificData
    };
    if (role === 'university') {
      if (roleSpecificData.accountType === 'coordinator') {
        const institutionKey = normalizeInstitution(roleSpecificData.institution);
        const submittedCode = String(universityCoordinatorCode || '').trim();
        if (!institutionKey || !submittedCode) {
          return res.status(400).json({
            success: false,
            message: 'University and coordinator authorization code are required'
          });
        }
        const coordinatorCode = await UniversityCoordinatorCode.findOne({
          institutionKey,
          active: true,
          codeHash: hashCoordinatorCode(submittedCode)
        });
        if (!coordinatorCode || normalizeInstitution(coordinatorCode.institution) !== institutionKey) {
          return res.status(403).json({
            success: false,
            message: 'Invalid or inactive coordinator code for the selected University'
          });
        }
        userObj.universityRole = 'innovation_coordinator';
        userObj.institution = coordinatorCode.institution;
        userObj.universityDepartment = null;
      } else {
        userObj.universityRole = 'member';
      }
    }
    if (role === 'government') {
      userObj.governmentDistrict = String(roleSpecificData.governmentDistrict || roleSpecificData.district).trim();
      userObj.district = userObj.governmentDistrict;
    }

    // Create user
    user = await User.create(userObj);

    // Generate token
    const token = generateToken(user._id, user.role);

    // Return response
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        token,
        user: user.toJSON()
      }
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

    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Email already registered'
      });
    }

    next(error);
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
export const loginUser = async (req, res, next) => {
  try {
    const { email, password, institution, coordinatorCode } = req.body;

    // Validation
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    // Find user and include password field
    const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Check password
    const isPasswordMatch = await user.matchPassword(password);

    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    if (!['citizen', 'government', 'university', 'industry'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'This account role is no longer supported for application login'
      });
    }
    if (user.role === 'university' && user.universityRole === 'innovation_coordinator') {
      const institutionKey = normalizeInstitution(institution);
      if (!institutionKey || institutionKey !== normalizeInstitution(user.institution) || !coordinatorCode) {
        return res.status(401).json({ success: false, message: 'University and active coordinator authorization code are required' });
      }
      const coordinatorRecord = await UniversityCoordinatorCode.findOne({
        institutionKey,
        active: true,
        codeHash: hashCoordinatorCode(coordinatorCode)
      });
      if (!coordinatorRecord) return res.status(401).json({ success: false, message: 'Invalid coordinator authorization code for this University' });
    }

    // Generate token
    const token = generateToken(user._id, user.role);

    // Return response
    res.status(200).json({
      success: true,
      message: 'Logged in successfully',
      data: {
        token,
        user: user.toJSON()
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get current authenticated user
// @route   GET /api/auth/me
// @access  Private
export const getCurrentUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'User retrieved successfully',
      data: {
        user: user.toJSON()
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Complete the authenticated student's University profile
// @route   PATCH /api/auth/university-profile
// @access  Private - University student/research student only
export const updateUniversityProfile = async (req, res, next) => {
  try {
    const { department, accountType, primaryClub } = req.body;
    if (!UNIVERSITY_DEPARTMENTS.includes(department)) {
      return res.status(400).json({ success: false, message: 'Select a valid university department' });
    }
    if (!['student', 'researcher'].includes(accountType)) {
      return res.status(400).json({ success: false, message: 'Select Student or Research Student' });
    }
    if (!UNIVERSITY_CLUBS.includes(primaryClub)) {
      return res.status(400).json({ success: false, message: 'Select a valid University club' });
    }

    const user = await User.findById(req.user.id);
    if (!user || user.role !== 'university') {
      return res.status(403).json({ success: false, message: 'Only University student profiles can be updated here' });
    }
    if (user.accountType && !['student', 'researcher'].includes(user.accountType)) {
      return res.status(403).json({ success: false, message: 'This University account cannot change its academic role here' });
    }

    user.universityDepartment = department;
    user.accountType = accountType;
    user.primaryClub = primaryClub;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'University profile completed successfully',
      data: { user: user.toJSON() }
    });
  } catch (error) {
    next(error);
  }
};
