const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection with Retry
const connectDB = async (retries = 3) => {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hft-cloud');
        console.log('✓ Connected to MongoDB');
    } catch (err) {
        console.error('MongoDB connection error:', err.message);
        if (retries > 0) {
            console.log(`Retrying connection in 5s... (${retries} left)`);
            setTimeout(() => connectDB(retries - 1), 5000);
        } else {
            console.error('Max retries exceeded. Server will run without DB (endpoints will fail).');
            // Optionally: process.exit(1); to stop server
        }
    }
};
connectDB();

// Email Schema
const waitlistSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    source: {
        type: String,
        default: 'landing-page'
    },
    ipAddress: String,
    userAgent: String
}, {
    timestamps: true
});

const Waitlist = mongoose.model('Waitlist', waitlistSchema);

// API Routes

// Add email to waitlist
app.post('/api/waitlist', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email is required' 
            });
        }

        // Check if email already exists
        const existingEmail = await Waitlist.findOne({ email: email.toLowerCase() });
        
        if (existingEmail) {
            return res.status(409).json({ 
                success: false, 
                message: 'This email is already registered' 
            });
        }

        // Create new waitlist entry
        const waitlistEntry = new Waitlist({
            email: email.toLowerCase(),
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        });

        await waitlistEntry.save();

        // Get total count
        const totalCount = await Waitlist.countDocuments();

        res.status(201).json({
            success: true,
            message: 'Successfully added to waitlist',
            count: totalCount
        });

    } catch (error) {
        console.error('Error adding to waitlist:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error. Please try again.' 
        });
    }
});

// Get waitlist count
app.get('/api/waitlist/count', async (req, res) => {
    try {
        const count = await Waitlist.countDocuments();
        res.json({ success: true, count });
    } catch (error) {
        console.error('Error getting count:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get all waitlist emails (Admin only - add authentication in production)
app.get('/api/waitlist/all', async (req, res) => {
    try {
        // In production, add authentication middleware here
        const apiKey = req.headers['x-api-key'];
        if (apiKey !== process.env.ADMIN_API_KEY) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const emails = await Waitlist.find()
            .sort({ timestamp: -1 })
            .select('email timestamp source');
        
        res.json({ success: true, count: emails.length, data: emails });
    } catch (error) {
        console.error('Error fetching emails:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Export waitlist to CSV (Admin only)
app.get('/api/waitlist/export', async (req, res) => {
    try {
        const apiKey = req.headers['x-api-key'];
        if (apiKey !== process.env.ADMIN_API_KEY) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const emails = await Waitlist.find().sort({ timestamp: -1 });
        
        // Create CSV
        let csv = 'Email,Signup Date,Source,IP Address\n';
        emails.forEach(entry => {
            const date = new Date(entry.timestamp).toLocaleString();
            csv += `${entry.email},${date},${entry.source},${entry.ipAddress}\n`;
        });

        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', 'attachment; filename=waitlist.csv');
        res.send(csv);
    } catch (error) {
        console.error('Error exporting:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Server is running' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✓ Server running on port ${PORT}`);
    console.log(`✓ API endpoint: http://localhost:${PORT}/api/waitlist`);
});