import type { PageServerLoad } from './$types';
import { getBasicStores, fillAIAnalysis, geocodeLocation } from '$lib/server/api';

export const load: PageServerLoad = async ({ url }) => {
    try {
        // デフォルト: 桃山学院大学周辺
        let latitude = 34.4503;
        let longitude = 135.4526;
        let locationName = '桃山学院大学周辺';

        const q = url.searchParams.get('q');
        const latParam = url.searchParams.get('lat');
        const lngParam = url.searchParams.get('lng');
        const isDrinkingMode = url.searchParams.get('drunk') === '1';

        // 1. 座標が直接指定されている場合 (現在地ボタンまたはオートコンプリート)
        if (latParam && lngParam) {
            const lat = parseFloat(latParam);
            const lng = parseFloat(lngParam);
            if (!isNaN(lat) && !isNaN(lng)) {
                latitude = lat;
                longitude = lng;
                // 名前が指定されていればそれを使う、なければ現在地周辺
                const nameParam = url.searchParams.get('name');
                if (nameParam) {
                    locationName = nameParam;
                } else {
                    locationName = '現在地周辺';
                }

            }
        }
        // 2. キーワード検索の場合 (座標なし) -> 場所検索として扱う
        else if (q) {
            console.log(`Searching location for: ${q}`);
            const location = await geocodeLocation(q);
            if (location) {
                latitude = location.lat;
                longitude = location.lng;
                locationName = location.name;
            } else {
                console.warn(`Location not found for: ${q}`);
                locationName = `"${q}" が見つかりませんでした`;
                // Consider setting default lat/lng if geocoding fails, or keep default
            }
        }

        console.log(`Loading stores for: ${locationName} (${latitude}, ${longitude})`);

        // 1. まず基本情報を取得（awaitする）
        const { basicStores, originalPlaces } = await getBasicStores(latitude, longitude, isDrinkingMode, locationName);

        // 2. AI分析はPromiseとして返す（awaitしない）
        return {
            stores: basicStores,
            streamed: {
                aiAnalyses: fillAIAnalysis(basicStores, originalPlaces, isDrinkingMode, locationName)
            },
            location: {
                name: locationName,
                lat: latitude,
                lng: longitude
            },
            isDrinkingMode
        };

    } catch (error) {
        console.error('Error loading stores:', error);

        return {
            stores: [],
            streamed: {
                aiAnalyses: Promise.resolve([])
            },
            location: {
                name: 'エラーが発生しました',
                lat: 34.4503,
                lng: 135.4526
            },
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
    }
};
