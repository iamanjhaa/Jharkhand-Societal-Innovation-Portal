import mongoose from 'mongoose';

const smsResultSchema = new mongoose.Schema(
  {
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'EmergencyHelper', required: true },
    contactName: { type: String, required: true, trim: true, maxlength: 80 },
    phone: { type: String, trim: true, maxlength: 20, default: null },
    status: { type: String, enum: ['pending', 'sent', 'failed'], required: true, default: 'pending' },
    provider: { type: String, default: 'twilio' },
    providerMessageId: { type: String, default: null },
    sentAt: { type: Date, default: null },
    errorCode: { type: String, default: null, maxlength: 40 },
  },
  { _id: false },
);

const emergencyRequestSchema = new mongoose.Schema(
  {
    publicId: { type: String, unique: true, sparse: true, index: true },
    activeForCitizen: { type: mongoose.Schema.Types.ObjectId, unique: true, sparse: true, index: true },
    citizen: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: ['ACCIDENT', 'INJURY', 'MEDICAL_EMERGENCY', 'DANGER', 'OTHER_CRITICAL_EMERGENCY', 'FIRE', 'FLOOD_DISASTER', 'GENERAL_EMERGENCY', 'CALL_EMERGENCY_HELPER', 'NORMAL'],
      required: true,
    },
    command: { type: String, required: true, trim: true, maxlength: 500 },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    status: {
      type: String,
      enum: ['TRIGGERED', 'ALERTING', 'HELPER_CONTACTED', 'HELPER_RESPONDED', 'RESOLVED', 'CANCELLED', 'FAILED', 'EXPIRED'],
      default: 'TRIGGERED',
      index: true,
    },
    latitude: { type: Number, min: -90, max: 90, default: null },
    longitude: { type: Number, min: -180, max: 180, default: null },
    locationAccuracy: { type: Number, min: 0, default: null },
    locationTimestamp: { type: Date, default: null },
    triggeredAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: true },
    contactsAlerted: { type: Number, min: 0, max: 5, default: 0 },
    smsResults: {
      type: [smsResultSchema],
      default: [],
      validate: [(results) => results.length <= 5, 'An emergency can alert at most 5 contacts'],
    },
    resolvedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    source: { type: String, enum: ['WEB', 'ANDROID'], required: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

emergencyRequestSchema.index({ citizen: 1, createdAt: -1 });

export default mongoose.model('EmergencyRequest', emergencyRequestSchema);
