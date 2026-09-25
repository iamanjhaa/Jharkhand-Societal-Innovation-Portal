import mongoose from 'mongoose';
import bcryptjs from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    // Common fields
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false
    },
    role: {
      type: String,
      enum: {
        values: ['citizen', 'government', 'university', 'industry'],
        message: 'Role must be one of: citizen, government, university, industry'
      },
      required: [true, 'Role is required']
    },

    // Citizen-specific fields
    mobile: {
      type: String,
      required: function() { return this.role === 'citizen'; }
    },
    district: {
      type: String,
      required: function() { return this.role === 'citizen' || this.role === 'government'; }
    },
    governmentDistrict: {
      type: String,
      trim: true,
      required: function() { return this.role === 'government'; }
    },
    impactTokens: { type: Number, min: 0, default: 0 },
    lifetimeImpactTokens: { type: Number, min: 0, default: 0 },
    totalVerifiedProblems: { type: Number, min: 0, default: 0 },
    totalRewardsRedeemed: { type: Number, min: 0, default: 0 },
    totalRewardAmountRedeemed: { type: Number, min: 0, default: 0 },
    virtualCashBalance: {
      type: Number,
      min: 0,
      default: 0,
      validate: { validator: Number.isInteger, message: 'Virtual cash balance must be a whole number' }
    },
    villageOrCity: {
      type: String,
      required: function() { return this.role === 'citizen'; }
    },

    // Government-specific fields
    department: {
      type: String,
      required: function() { return this.role === 'government'; }
    },
    designation: {
      type: String,
      required: function() { return this.role === 'government'; }
    },

    // University-specific fields
    institution: {
      type: String,
      required: function() { return this.role === 'university'; }
    },
    universityDepartment: {
      type: String,
      trim: true
    },
    primaryClub: {
      type: String,
      enum: ['NCC', 'NSS', 'Rovers & Rangers', 'Red Ribbon Club', 'Eco Club', 'Innovation & Entrepreneurship Club'],
      default: null
    },
    clubRole: {
      type: String,
      enum: ['member', 'coordinator'],
      default: 'member'
    },
    clubCoordinatorClub: {
      type: String,
      enum: ['NCC', 'NSS', 'Rovers & Rangers', 'Red Ribbon Club', 'Eco Club', 'Innovation & Entrepreneurship Club'],
      default: null
    },
    accountType: {
      type: String,
      enum: {
        values: ['student', 'faculty', 'researcher', 'coordinator'],
        message: 'accountType must be one of: student, faculty, researcher, coordinator'
      },
      required: false
    },
    universityRole: {
      type: String,
      enum: ['member', 'innovation_coordinator'],
      default: 'member',
      required: function() { return this.role === 'university'; }
    },

    // Industry-specific fields
    organizationName: {
      type: String,
      required: function() { return this.role === 'industry'; }
    },
    organizationType: {
      type: String,
      enum: {
        values: ['industry', 'startup', 'msme', 'csr', 'research-lab', 'innovation-hub'],
        message: 'organizationType must be one of: industry, startup, msme, csr, research-lab, innovation-hub'
      },
      required: function() { return this.role === 'industry'; }
    },
    expertise: {
      type: String,
      required: function() { return this.role === 'industry'; }
    }
  },
  {
    timestamps: true
  }
);

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }

  try {
    const salt = await bcryptjs.genSalt(10);
    this.password = await bcryptjs.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password
userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcryptjs.compare(enteredPassword, this.password);
};

// Return user object without password
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  return user;
};

userSchema.index({ role: 1, institution: 1, accountType: 1 });
userSchema.index({ role: 1, institution: 1, universityDepartment: 1 });
userSchema.index({ role: 1, governmentDistrict: 1 });

const User = mongoose.model('User', userSchema);

export default User;
