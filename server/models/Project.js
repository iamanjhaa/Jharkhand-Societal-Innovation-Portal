import mongoose from 'mongoose';

const projectSchema = new mongoose.Schema(
  {
    // Basic information
    title: {
      type: String,
      required: [true, 'Project title is required'],
      trim: true
    },
    description: {
      type: String,
      required: [true, 'Project description is required']
    },

    // Challenge reference
    challenge: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Challenge',
      required: [true, 'Challenge reference is required']
    },

    // Creator and university
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Project creator is required']
    },
    university: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'University is required']
    },
    universityDepartment: {
      type: String,
      required: [true, 'University department is required']
    },
    facultyMentor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },

    // Project type
    projectType: {
      type: String,
      enum: {
        values: ['student_project', 'faculty_research', 'multidisciplinary_project', 'startup_prototype', 'research_project'],
        message: 'Project type must be one of: student_project, faculty_research, multidisciplinary_project, startup_prototype, research_project'
      },
      required: [true, 'Project type is required']
    },

    // Status tracking
    status: {
      type: String,
      enum: {
        values: ['proposed', 'under_review', 'approved', 'prototype', 'testing', 'deployed', 'completed', 'rejected'],
        message: 'Status must be one of the predefined values'
      },
      default: 'proposed'
    },
    progressPercentage: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    currentStage: {
      type: String,
      enum: ['proposed', 'prototype', 'testing', 'deployed', 'completed'],
      default: 'proposed'
    },
    completedWork: { type: String, trim: true, default: '' },
    remainingWork: { type: String, trim: true, default: '' },
    nextTask: { type: String, trim: true, default: '' },
    progressUpdates: [
      {
        stage: {
          type: String,
          enum: ['proposed', 'prototype', 'testing', 'deployed', 'completed'],
          required: true
        },
        percentage: { type: Number, min: 0, max: 100, required: true },
        description: { type: String, trim: true, default: '' },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        updatedAt: { type: Date, default: Date.now }
      }
    ],

    // Team members
    teamMembers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    ],

    // Solution details
    solutionSummary: {
      type: String,
      required: [true, 'Solution summary is required']
    },
    objectives: [
      {
        type: String
      }
    ],

    // Impact and budget
    expectedImpact: {
      type: String,
      required: [true, 'Expected impact is required']
    },
    solutionTitle: { type: String, trim: true, default: '' },
    solutionDescription: { type: String, trim: true, default: '' },
    solutionApproach: { type: String, trim: true, default: '' },
    technology: { type: String, trim: true, default: '' },
    implementationDetails: { type: String, trim: true, default: '' },
    expectedOutcome: { type: String, trim: true, default: '' },
    solutionStatus: {
      type: String,
      enum: ['draft', 'submitted'],
      default: 'draft'
    },
    estimatedBudget: {
      type: Number,
      default: 0
    },

    // Timeline
    timeline: {
      startDate: {
        type: Date,
        required: [true, 'Start date is required']
      },
      expectedCompletionDate: {
        type: Date,
        required: [true, 'Expected completion date is required']
      }
    },

    // Industry partners
    industryPartners: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    ]
  },
  {
    timestamps: true
  }
);

// Indexes for common queries
projectSchema.index({ challenge: 1 });
projectSchema.index({ university: 1 });
projectSchema.index({ status: 1 });
projectSchema.index({ createdBy: 1 });
projectSchema.index({ createdAt: -1 });

const Project = mongoose.model('Project', projectSchema);

export default Project;
