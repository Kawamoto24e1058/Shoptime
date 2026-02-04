import { json } from '@sveltejs/kit';
import { fetchPlaceAutocomplete } from '$lib/server/api';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
    const input = url.searchParams.get('input');
    const sessionToken = url.searchParams.get('session_token') || undefined;

    if (!input) {
        return json({ predictions: [] });
    }

    const predictions = await fetchPlaceAutocomplete(input, sessionToken); // Fixed args
    return json({ predictions: predictions || [] });
};
