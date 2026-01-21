const mongoose = require('mongoose');

const apiHealthSchema = new mongoose.Schema({
  service: {
    type: String,
    required: true,
    enum: ['openai', 'mercadolibre', 'facebook', 'mongodb']
  },
  status: {
    type: String,
    required: true,
    enum: ['ok', 'error', 'warning']
  },
  errorCode: { type: String, default: null },      // e.g., "429", "500", "quota_exceeded"
  errorMessage: { type: String, default: null },
  lastSuccess: { type: Date, default: null },
  lastError: { type: Date, default: null },
  errorCount: { type: Number, default: 0 },        // Consecutive errors
  totalErrors24h: { type: Number, default: 0 },    // Errors in last 24 hours
  resolved: { type: Boolean, default: false },
  resolvedAt: { type: Date, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed }  // Additional context
}, { timestamps: true });

// Index for quick lookups
apiHealthSchema.index({ service: 1, status: 1 });
apiHealthSchema.index({ createdAt: -1 });

// Static method to log an API error
apiHealthSchema.statics.logError = async function(service, errorCode, errorMessage, metadata = {}) {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);

  // Count errors in last 24h for this service
  const recentErrors = await this.countDocuments({
    service,
    status: 'error',
    createdAt: { $gte: twentyFourHoursAgo }
  });

  // Get the latest record for this service to track consecutive errors
  const latest = await this.findOne({ service }).sort({ createdAt: -1 });
  const consecutiveErrors = (latest?.status === 'error') ? (latest.errorCount || 0) + 1 : 1;

  return this.create({
    service,
    status: 'error',
    errorCode,
    errorMessage,
    lastError: now,
    errorCount: consecutiveErrors,
    totalErrors24h: recentErrors + 1,
    metadata
  });
};

// Static method to log success (clears error state)
apiHealthSchema.statics.logSuccess = async function(service) {
  return this.create({
    service,
    status: 'ok',
    lastSuccess: new Date(),
    errorCount: 0,
    resolved: true,
    resolvedAt: new Date()
  });
};

// Static method to get current health status for all services
apiHealthSchema.statics.getCurrentStatus = async function() {
  const services = ['openai', 'mercadolibre', 'facebook', 'mongodb'];
  const status = {};

  for (const service of services) {
    const latest = await this.findOne({ service }).sort({ createdAt: -1 });
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const errorsLast24h = await this.countDocuments({
      service,
      status: 'error',
      createdAt: { $gte: twentyFourHoursAgo }
    });

    status[service] = {
      status: latest?.status || 'ok',
      lastError: latest?.status === 'error' ? latest.createdAt : null,
      lastSuccess: latest?.lastSuccess || null,
      errorCode: latest?.status === 'error' ? latest.errorCode : null,
      errorMessage: latest?.status === 'error' ? latest.errorMessage : null,
      consecutiveErrors: latest?.status === 'error' ? latest.errorCount : 0,
      errorsLast24h
    };
  }

  return status;
};

// Static method to get active alerts (unresolved errors)
apiHealthSchema.statics.getActiveAlerts = async function() {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Get the latest status for each service
  const services = ['openai', 'mercadolibre', 'facebook', 'mongodb'];
  const alerts = [];

  for (const service of services) {
    const latest = await this.findOne({ service }).sort({ createdAt: -1 });

    if (latest?.status === 'error') {
      const errorsLast24h = await this.countDocuments({
        service,
        status: 'error',
        createdAt: { $gte: twentyFourHoursAgo }
      });

      alerts.push({
        service,
        errorCode: latest.errorCode,
        errorMessage: latest.errorMessage,
        since: latest.createdAt,
        consecutiveErrors: latest.errorCount,
        errorsLast24h
      });
    }
  }

  return alerts;
};

module.exports = mongoose.model('ApiHealth', apiHealthSchema);
