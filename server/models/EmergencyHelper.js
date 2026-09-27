import mongoose from 'mongoose';

const emergencyHelperSchema = new mongoose.Schema(
  {
    citizen: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    priority: { type: Number, required: true, min: 1, max: 20 },
    enabled: { type: Boolean, default: true },
    alertEnabled: { type: Boolean, default: true },
  },
  { timestamps: true },
);

emergencyHelperSchema.index({ citizen: 1, priority: 1 });
emergencyHelperSchema.index({ citizen: 1, phone: 1 }, { unique: true });

export default mongoose.model('EmergencyHelper', emergencyHelperSchema);
