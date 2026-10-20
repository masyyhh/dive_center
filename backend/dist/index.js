"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const security_1 = require("./middleware/security");
const auth_routes_1 = require("./routes/auth.routes");
const properties_routes_1 = require("./routes/properties.routes");
const users_routes_1 = require("./routes/users.routes");
const staff_routes_1 = require("./routes/staff.routes");
const items_routes_1 = require("./routes/items.routes");
const bills_routes_1 = require("./routes/bills.routes");
const presence_routes_1 = require("./routes/presence.routes");
const reports_routes_1 = require("./routes/reports.routes");
const audit_routes_1 = require("./routes/audit.routes");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 5001;
// Setup Security, Helmet, CORS
(0, security_1.configureSecurity)(app);
// JSON and URL-encoded body parser
app.use(express_1.default.json({ limit: '5mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '5mb' }));
// Apply general API rate limiter
app.use('/api', security_1.apiLimiter);
// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'Dive Centre Manager API',
    });
});
// Mount modular API routes
app.use('/api/auth', auth_routes_1.authRouter);
app.use('/api/properties', properties_routes_1.propertiesRouter);
app.use('/api/users', users_routes_1.usersRouter);
app.use('/api/staff', staff_routes_1.staffRouter);
app.use('/api/items', items_routes_1.itemsRouter);
app.use('/api/bills', bills_routes_1.billsRouter);
app.use('/api/presence', presence_routes_1.presenceRouter);
app.use('/api/reports', reports_routes_1.reportsRouter);
app.use('/api/audit', audit_routes_1.auditRouter);
// Global Error Handler
app.use((err, req, res, next) => {
    console.error('Unhandled Server Error:', err);
    const status = err.status || 500;
    const message = err.message || 'An unexpected internal server error occurred.';
    res.status(status).json({
        error: message,
        ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
    });
});
// Start listening
app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`🚀 Dive Centre Manager Backend running on port ${PORT}`);
    console.log(`🔒 Security enabled (Helmet, Rate Limiter, CORS, RBAC)`);
    console.log(`===============================================`);
});
exports.default = app;
