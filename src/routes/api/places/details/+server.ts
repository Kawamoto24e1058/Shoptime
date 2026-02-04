import { json } from '@sveltejs/kit';
import { fetchPlaceDetails } from '$lib/server/api';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
    const placeId = url.searchParams.get('place_id');
    const sessionToken = url.searchParams.get('session_token') || undefined;

    if (!placeId) {
        return json({ error: 'Place ID is required' }, { status: 400 });
    }

    const details = await fetchPlaceDetails(placeId, sessionToken); // Fixed args
    if (!details) {
        return json({ error: 'Place details not found' }, { status: 404 });
    }

    return json(details);
};
