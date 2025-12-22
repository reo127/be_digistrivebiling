// Tenant Isolation Middleware
// Ensures all queries are automatically filtered by organizationId

export const tenantIsolation = (req, res, next) => {
    // Skip for superadmin - they can access all organizations
    if (req.user && req.user.role === 'superadmin') {
        // Superadmin can optionally specify organizationId in query params
        if (req.query.organizationId) {
            req.organizationId = req.query.organizationId;
        }
        // If no organizationId specified, superadmin sees all (handled in routes)
        return next();
    }

    // For regular users (owner/staff), enforce their organization
    if (req.user && req.user.organizationId) {
        // Extract _id from populated organizationId object
        req.organizationId = req.user.organizationId._id || req.user.organizationId;
        return next();
    }

    // If no user or no organizationId, deny access
    return res.status(403).json({
        message: 'Access denied. No organization context.'
    });
};

// Helper to add organizationId filter to queries
export const addOrgFilter = (req, filter = {}) => {
    if (req.organizationId) {
        return { ...filter, organizationId: req.organizationId };
    }
    // Superadmin without specific org - return filter as is
    return filter;
};

export default tenantIsolation;
