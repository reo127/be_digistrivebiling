// Super Admin Middleware
// Restricts access to super admin only routes

export const requireSuperAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            message: 'Authentication required'
        });
    }

    if (req.user.role !== 'superadmin') {
        return res.status(403).json({
            message: 'Access denied. Super admin privileges required.'
        });
    }

    next();
};

// Middleware to check if user is owner of their organization
export const requireOwner = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            message: 'Authentication required'
        });
    }

    if (req.user.role === 'superadmin') {
        // Superadmin has all permissions
        return next();
    }

    if (req.user.role !== 'owner') {
        return res.status(403).json({
            message: 'Access denied. Organization owner privileges required.'
        });
    }

    next();
};

// Middleware to check specific permission for staff users
export const requirePermission = (permission) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                message: 'Authentication required'
            });
        }

        // Superadmin and owner have all permissions
        if (req.user.role === 'superadmin' || req.user.role === 'owner') {
            return next();
        }

        // Check staff user's specific permission
        if (req.user.permissions && req.user.permissions[permission]) {
            return next();
        }

        return res.status(403).json({
            message: `Access denied. Required permission: ${permission}`
        });
    };
};

export default requireSuperAdmin;
