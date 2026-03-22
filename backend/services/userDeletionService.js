/**
 * Shared user-data deletion logic.
 * Used by both self-service consent routes and admin account deletion.
 */

/**
 * Delete all personal data for a user (order matters for FK constraints).
 * Tables with ON DELETE SET NULL (questionnaire_results) must be deleted
 * explicitly before the user row is removed.
 *
 * @param {import('pg').PoolClient} client  — must be inside a transaction
 * @param {string} userId
 */
export async function deleteAllUserData(client, userId) {
    await client.query('DELETE FROM public.chat_messages WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.chat_summaries WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.chat_sessions WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.chatbot_preferences WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.wellbeing_responses WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.srl_annotations WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.srl_responses WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.questionnaire_results WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.sleep_judgments WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.sleep_sessions WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.sleep_baselines WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.screen_time_judgments WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.screen_time_sessions WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.screen_time_baselines WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.lms_judgments WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.lms_sessions WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.lms_baselines WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.concept_scores WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.concept_score_history WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.user_cluster_assignments WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.student_profiles WHERE user_id = $1', [userId]);
}

/**
 * Fully delete a user account: all data + ancillary records + user row.
 * Also clears any active sessions for the user.
 *
 * @param {import('pg').PoolClient} client  — must be inside a transaction
 * @param {string} userId
 */
export async function deleteUserAccount(client, userId) {
    await deleteAllUserData(client, userId);

    // Tables not covered by deleteAllUserData but referencing user_id (CASCADE,
    // but explicit deletion is safer against future schema changes)
    await client.query('DELETE FROM public.chat_message_likes WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.chat_message_flags WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.csv_participant_aliases WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.support_requests WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM public.user_consents WHERE user_id = $1', [userId]);

    // Clear any active sessions so the deleted user can't remain logged in
    await client.query(
        `DELETE FROM public.session WHERE sess::jsonb->'user'->>'id' = $1`,
        [userId]
    );

    // Finally remove the user row itself
    await client.query('DELETE FROM public.users WHERE id = $1', [userId]);
}
