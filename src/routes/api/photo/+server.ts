import { GOOGLE_MAPS_API_KEY } from '$env/static/private';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
    const name = url.searchParams.get('name');
    const maxWidthPx = url.searchParams.get('maxWidthPx') || '400';
    const maxHeightPx = url.searchParams.get('maxHeightPx') || '400';

    if (!name) {
        return new Response('Missing name parameter', { status: 400 });
    }

    // Construct the Google Places Media API URL
    // Format: https://places.googleapis.com/v1/{name}/media?key=API_KEY&maxWidthPx=...&maxHeightPx=...
    const googleUrl = `https://places.googleapis.com/v1/${name}/media?key=${GOOGLE_MAPS_API_KEY}&maxWidthPx=${maxWidthPx}&maxHeightPx=${maxHeightPx}`;

    try {
        const response = await fetch(googleUrl);

        if (!response.ok) {
            console.error(`Failed to fetch photo ${name}: ${response.status}`);
            return new Response('Failed to fetch photo', { status: response.status });
        }

        // Forward the image response
        const headers = new Headers(response.headers);
        // Ensure we cache this for performance
        headers.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours

        return new Response(response.body, {
            status: 200,
            headers: headers
        });
    } catch (error) {
        console.error('Error in photo proxy:', error);
        return new Response('Internal Server Error', { status: 500 });
    }
};
