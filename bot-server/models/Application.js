const mongoose = require("mongoose");

const applicationSchema = new mongoose.Schema({
  name: { type: String, required: true },                    // e.g., "Industrial", "Agrícola", "Invernaderos"
  slug: { type: String, required: true, unique: true },      // e.g., "industrial-agricola-invernaderos"
  parentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Application",
    default: null
  },                                                          // null for root nodes (Industrial, Hogar)
  level: { type: Number, default: 0 },                       // 0 for root, 1 for children, 2 for grandchildren, etc.
  order: { type: Number, default: 0 },                       // For sorting siblings under same parent
  description: { type: String },                             // Optional description of the application
  active: { type: Boolean, default: true },

  // Metadata
  icon: { type: String },                                    // Optional icon name or emoji
  color: { type: String },                                   // Optional color for UI representation
}, { timestamps: true });

// Index for efficient queries
applicationSchema.index({ parentId: 1, order: 1 });
applicationSchema.index({ slug: 1 });
applicationSchema.index({ level: 1 });

// Virtual for getting full path (breadcrumb)
applicationSchema.virtual('path').get(async function() {
  const path = [this.name];
  let current = this;

  while (current.parentId) {
    current = await mongoose.model('Application').findById(current.parentId);
    if (current) path.unshift(current.name);
  }

  return path.join(' > ');
});

// Method to get all children (recursive)
applicationSchema.methods.getDescendants = async function() {
  const children = await mongoose.model('Application').find({ parentId: this._id });
  let descendants = [...children];

  for (const child of children) {
    const childDescendants = await child.getDescendants();
    descendants = descendants.concat(childDescendants);
  }

  return descendants;
};

// Static method to get tree structure
applicationSchema.statics.getTree = async function(parentId = null) {
  const nodes = await this.find({ parentId }).sort({ order: 1 });

  const tree = [];
  for (const node of nodes) {
    const nodeObj = node.toObject();
    nodeObj.children = await this.getTree(node._id);
    tree.push(nodeObj);
  }

  return tree;
};

module.exports = mongoose.model("Application", applicationSchema);
