import { Router } from 'express';
import pool from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';
import logger from '../utils/logger.js';
import { deleteAllUserData } from '../services/userDeletionService.js';

const router = Router();

// GET /consent — check if user has given consent
router.get('/', requireAuth, async (req, res, next) => {
    try {
        const userId = req.session.user.id;
        const { rows } = await pool.query(
            'SELECT consent_given, consent_version, consent_given_at FROM public.user_consents WHERE user_id = $1',
            [userId]
        );
        if (rows.length === 0) {
            return res.json({ consentGiven: false });
        }
        return res.json({
            consentGiven: rows[0].consent_given,
            consentVersion: rows[0].consent_version,
            consentGivenAt: rows[0].consent_given_at
        });
    } catch (err) {
        next(err);
    }
});

// POST /consent — record consent
router.post('/', requireAuth, async (req, res, next) => {
    try {
        const userId = req.session.user.id;
        const { consentGiven } = req.body;
        if (consentGiven !== true) {
            return res.status(400).json({ error: 'Consent must be explicitly given' });
        }
        await pool.query(
            `INSERT INTO public.user_consents (user_id, consent_given, consent_given_at)
             VALUES ($1, true, NOW())
             ON CONFLICT (user_id)
             DO UPDATE SET consent_given = true, consent_given_at = NOW(), revoked_at = NULL`,
            [userId]
        );
        logger.info(`User ${userId} gave consent`);
        return res.json({ success: true });
    } catch (err) {
        next(err);
    }
});

// POST /consent/revoke — revoke consent and delete all user data (keep account)
router.post('/revoke', requireAuth, async (req, res, next) => {
    const client = await pool.connect();
    try {
        const userId = req.session.user.id;
        await client.query('BEGIN');

        await deleteAllUserData(client, userId);

        // Mark consent as revoked (keep record for audit)
        await client.query(
            'UPDATE public.user_consents SET consent_given = false, revoked_at = NOW() WHERE user_id = $1',
            [userId]
        );

        await client.query('COMMIT');

        // Destroy session
        req.session.destroy(() => {
            res.clearCookie('connect.sid');
            logger.info(`User ${userId} revoked consent — all data deleted`);
            return res.json({ success: true, message: 'All data deleted and consent revoked' });
        });
    } catch (err) {
        await client.query('ROLLBACK');
        next(err);
    } finally {
        client.release();
    }
});

// POST /consent/delete-account — permanently delete account and all data
router.post('/delete-account', requireAuth, async (req, res, next) => {
    const client = await pool.connect();
    try {
        const userId = req.session.user.id;
        await client.query('BEGIN');

        await deleteAllUserData(client, userId);

        // Remove consent record and user account entirely
        await client.query('DELETE FROM public.user_consents WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM public.users WHERE id = $1', [userId]);

        await client.query('COMMIT');

        // Destroy session
        req.session.destroy(() => {
            res.clearCookie('connect.sid');
            logger.info(`User ${userId} deleted account — all data and account removed`);
            return res.json({ success: true, message: 'Account and all data permanently deleted' });
        });
    } catch (err) {
        await client.query('ROLLBACK');
        next(err);
    } finally {
        client.release();
    }
});

export default router;
