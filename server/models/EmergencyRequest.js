import mongoose from 'mongoose';

const emergencyRequestSchema = new mongoose.Schema(
  {
    citizen: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: ['ACCIDENT', 'MEDICAL_EMERGENCY', 'FIRE', 'FLOOD_DISASTER', 'GENERAL_EMERGENCY', 'CALL_EMERGENCY_HELPER', 'NORMAL'],
      required: true,
    },
    command: { type: String, required: true, trim: true, maxlength: 500 },
    status: {
      type: String,
      enum: ['TRIGGERED', 'ALERTING', 'HELPER_CONTACTED', 'HELPER_RESPONDED', 'RESOLVED', 'CANCELLED', 'FAILED'],
      default: 'TRIGGERED',
      index: true,
    },
    latitude: { type: Number, min: -90, max: 90, default: null },
    longitude: { type: Number, min: -180, max: 180, default: null },
    locationAccuracy: { type: Number, min: 0, default: null },
    locationTimestamp: { type: Date, default: null },
    triggeredAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    source: { type: String, enum: ['WEB', 'ANDROID'], required: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

emergencyRequestSchema.index({ citizen: 1, createdAt: -1 });

export default mongoose.model('EmergencyRequest', emergencyRequestSchema);
