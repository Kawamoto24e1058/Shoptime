import { env } from '$env/dynamic/private';
const GOOGLE_MAPS_API_KEY = env.GOOGLE_MAPS_API_KEY;
import { batchFetchCachedAnalysis, saveToNotion } from './notionCache';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

interface PlacePhoto {
	name: string;
	heightPx?: number;
	widthPx?: number;
}

// ========================================
// 型定義
// ========================================

export interface StoreReview {
	authorAttribution?: {
		displayName?: string;
	};
	// Cleaned
	rating?: number;
	text?: {
		text?: string;
	};
	relativePublishTimeDescription?: string;
}

export interface OpeningHours {
	openNow?: boolean;
	periods?: Array<{
		open?: {
			day?: number;
			hour?: number;
			minute?: number;
		};
		close?: {
			day?: number;
			hour?: number;
			minute?: number;
		};
	}>;
	weekdayDescriptions?: string[];
}

export interface PlaceData {
	id?: string;
	displayName?: {
		text?: string;
	};
	formattedAddress?: string;
	currentOpeningHours?: OpeningHours;
	reviews?: StoreReview[];
	priceLevel?: string;
	types?: string[];
	googleMapsUri?: string;
	rating?: number; // New
	location?: { // New
		latitude: number;
		longitude: number;
	};
	nationalPhoneNumber?: string; // New
	websiteUri?: string; // New
	photos?: { name: string; widthPx?: number; heightPx?: number; }[]; // New
	editorialSummary?: { text?: string }; // New
}

export interface RecommendedStore {
	id: string;
	name: string;
	address: string;
	category: string;
	alcohol_status: string;
	alcohol_note: string; // New
	hero_feature: string; // New
	ai_insight: string;
	best_for: string;
	lo_risk: string;
	mood: string;
	priceLevel: string;
	reviewCount: number;
	closingTimeMinutes: number;
	googleMapsUri: string;
	score: number; // New
	rating: number; // New (Google Rating)
	distance: number; // New (Meters)
	formattedDistance: string; // New (e.g. "350m", "1.2km")
	recommendedMenu: string; // New
	hasAlcohol: boolean; // New
	tags: string[]; // New
	phoneNumber?: string; // New
	reservationUrl?: string; // New
	photoName?: string; // New
	drinking_score: number; // New: 飲みモード用スコア
	reviewsText?: string; // New: クライアントサイド検索用 (レビュー全文結合)
}

interface AIAnalysis {
	id?: string; // Added for enhanced response tracking
	category?: string; // Added for Notion override
	alcohol_status: string;
	alcohol_note: string; // New
	hero_feature: string; // New
	ai_insight: string;
	best_for: string;
	lo_risk: string;
	mood: string;
	score: number; // New
	recommendedMenu: string; // New
	hasAlcohol: boolean; // New
	tags: string[]; // New
	drinking_score: number; // New
	editorial_summary?: string; // Google公式紹介文（AI節約用）
	recommendation?: string; // Notion手動入力おすすめ（最優先）
}

// In-memory cache for AI analysis
const aiCache = new Map<string, AIAnalysis>();

// ========================================
// Google Places API (New) - 周辺店舗検索
// ========================================

// ========================================
// Google Places API (New) - 周辺店舗検索
// ========================================

/**
 * Text Search API を使用して、指定したキーワード周辺の飲食店を取得
 */
/**
 * Text Search API を使用して、指定したキーワード周辺の飲食店を取得
 */
async function fetchPlacesByText(lat: number, lng: number, query: string, radius: number = 1500): Promise<PlaceData[]> {
	try {
		// Check API Key
		if (!GOOGLE_MAPS_API_KEY) {
			console.error('GOOGLE_MAPS_API_KEY is undefined. Check Vercel Environment Variables.');
			return [];
		}

		const url = 'https://places.googleapis.com/v1/places:searchText';

		const requestBody = {
			textQuery: query,
			maxResultCount: 20,
			languageCode: 'ja',
			locationBias: {
				circle: {
					center: {
						latitude: lat,
						longitude: lng
					},
					radius: radius
				}
			},
			openNow: true, // 営業中のみ取得 (API側でフィルタリング)
		};

		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
				'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.currentOpeningHours,places.types,places.reviews,places.photos,places.editorialSummary,places.priceLevel,places.servesBreakfast,places.servesLunch,places.servesDinner,places.servesBeer,places.servesWine,places.servesVegetarianFood,places.outdoorSeating,places.goodForChildren,places.allowsDogs,places.reservable,places.delivery,places.takeout,places.websiteUri'
			},
			body: JSON.stringify(requestBody)
		});

		if (!response.ok) {
			console.warn(`Text Search API error for "${query}": ${response.status}`);
			return [];
		}

		const data = await response.json();
		return data.places || [];
	} catch (error) {
		console.error(`Error fetching places by text "${query}":`, error);
		return [];
	}
}

/**
 * 複数のキーワードで検索を行い、結果をマージする
 */
// Export this function so it can be used by +page.server.ts
export async function fetchNearbyPlaces(lat: number, lng: number): Promise<PlaceData[]> {
	try {
		// 検索クエリの多様化: 網羅性を高めるため、2軒目利用も意識したキーワードで検索
		// "飲食店" (broad), "居酒屋" (izakaya), "バー" (bar), "深夜" (late night), "カフェ" (cafe/night cafe), "ラーメン" (finishing ramen)
		const queries = ["飲食店", "居酒屋", "バー", "深夜営業", "カフェ", "ラーメン"];

		const promises = queries.map(q => fetchPlacesByText(lat, lng, q));
		const results = await Promise.all(promises);

		// 重複排除 (IDで一意にする)
		const placeMap = new Map<string, PlaceData>();
		results.flat().forEach(place => {
			if (place.id && !placeMap.has(place.id)) {
				placeMap.set(place.id, place);
			}
		});

		return Array.from(placeMap.values());
	} catch (error) {
		console.error('Error in fetchNearbyPlaces (Diversified):', error);
		return [];
	}
}

// ========================================
// Autocomplete API - 予測候補検索
// ========================================

/**
 * Google Places Autocomplete API
 */
export async function fetchPlaceAutocomplete(input: string, sessionToken?: string): Promise<Array<{ description: string; place_id: string }> | null> {
	try {
		if (!GOOGLE_MAPS_API_KEY) {
			console.error('GOOGLE_MAPS_API_KEY is undefined.');
			return null;
		}
		// types=geocode|establishment を指定して広範囲にヒットさせる
		let url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&language=ja&components=country:jp&key=${GOOGLE_MAPS_API_KEY}`;
		if (sessionToken) {
			url += `&sessiontoken=${encodeURIComponent(sessionToken)}`;
		}

		const response = await fetch(url);

		if (!response.ok) {
			throw new Error(`Autocomplete API error: ${response.status}`);
		}

		const data = await response.json();
		if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
			console.warn(`Autocomplete warning for "${input}": ${data.status}`);
			return null;
		}

		return data.predictions?.map((p: any) => ({
			description: p.description,
			place_id: p.place_id
		})) || [];
	} catch (error) {
		console.error('Error in fetchPlaceAutocomplete:', error);
		return null;
	}
}

/**
 * Google Places Details API (特定地点の座標取得)
 */
export async function fetchPlaceDetails(placeId: string, sessionToken?: string): Promise<{ lat: number; lng: number; name: string } | null> {
	try {
		if (!GOOGLE_MAPS_API_KEY) {
			console.error('GOOGLE_MAPS_API_KEY is undefined.');
			return null;
		}
		let url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,geometry&key=${GOOGLE_MAPS_API_KEY}`;
		if (sessionToken) {
			url += `&sessiontoken=${encodeURIComponent(sessionToken)}`;
		}

		const response = await fetch(url);

		if (!response.ok) {
			throw new Error(`Place Details API error: ${response.status}`);
		}

		const data = await response.json();
		if (data.status !== 'OK' || !data.result) {
			console.warn(`Place Details warning for "${placeId}": ${data.status}`);
			return null;
		}

		const result = data.result;
		const location = result.geometry.location;

		return {
			lat: location.lat,
			lng: location.lng,
			name: result.name
		};
	} catch (error) {
		console.error('Error in fetchPlaceDetails:', error);
		return null;
	}
}

// ========================================
// Geocoding API - 場所検索
// ========================================

/**
 * 場所名から座標を取得
 */
export async function geocodeLocation(query: string): Promise<{ lat: number; lng: number; name: string } | null> {
	try {
		const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&language=ja&key=${GOOGLE_MAPS_API_KEY}`;
		const response = await fetch(url);

		if (!response.ok) {
			throw new Error(`Geocoding API error: ${response.status}`);
		}

		const data = await response.json();
		if (data.status !== 'OK' || !data.results || data.results.length === 0) {
			console.warn(`Geocoding failed for "${query}": ${data.status}`);
			return null;
		}

		const result = data.results[0];
		const location = result.geometry.location;

		// result.formatted_address usually contains the full address
		// We might want to use the queried name if it looks like a place name
		const name = result.formatted_address || query;

		return {
			lat: location.lat,
			lng: location.lng,
			name: name
		};
	} catch (error) {
		console.error('Error in geocodeLocation:', error);
		return null;
	}
}

// ========================================
// 閉店時間フィルタリング
// ========================================

/**
 * 現在時刻をJSTで取得
 */
function getCurrentJSTTime(): Date {
	// サーバーのタイムゾーンに関わらず、JST (UTC+9) の時刻オブジェクトを作成
	const now = new Date();
	const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
	return new Date(utc + (3600000 * 9));
}

/**
 * 週の開始（日曜日 00:00）からの経過分数を計算
 */
function getMinutesFromStartOfWeek(day: number, hour: number, minute: number): number {
	return (day * 24 * 60) + (hour * 60) + minute;
}

/**
 * 閉店まで60分以内の店舗を除外
 */
/**
 * 閉店まで60分以内の店舗を厳格に除外
 * @param places PlaceData[]
 * @returns { place: PlaceData; remainingMinutes: number }[]
 */
function filterByClosingTime(places: PlaceData[]): Array<{ place: PlaceData; remainingMinutes: number }> {
	const filtered: Array<{ place: PlaceData; remainingMinutes: number }> = [];

	// 現在時刻 (JST)
	const currentJST = getCurrentJSTTime();

	// 曜日 (0: 日曜, 1: 月曜, ... 6: 土曜)
	const currentDay = currentJST.getDay();

	// 週の開始（日曜00:00）からの経過分数
	const currentWeekMinutes = getMinutesFromStartOfWeek(currentDay, currentJST.getHours(), currentJST.getMinutes());

	console.log(`[Debug] Filtering start. Current JST: ${currentJST.toLocaleString('ja-JP')} (WeekMin: ${currentWeekMinutes})`);

	for (const place of places) {
		const oh = place.currentOpeningHours;

		// 1. "openNow" が false なら即除外 (閉店中)
		// APIで openNow=true を指定しているが、念のためチェック
		if (!oh || oh.openNow !== true) {
			continue;
		}

		// 2. 24時間営業などの処理
		if (!oh.periods || oh.periods.length === 0) {
			filtered.push({ place, remainingMinutes: 1440 });
			continue;
		}

		// 3. 現在の period を探して残り時間を計算
		let minRemaining = -1;

		for (const period of oh.periods) {
			if (!period.open || !period.close) continue;

			const openMin = getMinutesFromStartOfWeek(period.open.day ?? 0, period.open.hour ?? 0, period.open.minute ?? 0);
			const closeMin = getMinutesFromStartOfWeek(period.close.day ?? 0, period.close.hour ?? 0, period.close.minute ?? 0);

			let isOpen = false;
			let remaining = 0;

			if (openMin < closeMin) {
				// 通常営業
				if (currentWeekMinutes >= openMin && currentWeekMinutes < closeMin) {
					isOpen = true;
					remaining = closeMin - currentWeekMinutes;
				}
			} else {
				// 日/週またぎ
				const closeMinAdjusted = closeMin + 10080;

				if (currentWeekMinutes >= openMin) {
					isOpen = true;
					remaining = closeMinAdjusted - currentWeekMinutes;
				}
				else if (currentWeekMinutes < closeMin) {
					isOpen = true;
					remaining = closeMin - currentWeekMinutes;
				}
			}

			if (isOpen) {
				minRemaining = remaining;
				break;
			}
		}

		if (minRemaining > -1) {
			const name = place.displayName?.text || '';
			const isChain = isChainStore(name);

			// ユーザー要望:
			// "22:00閉店の店を21:00に探している場合、秒単位のズレで「1時間を切った」と判定" されるのを防ぐ
			// -> 55分バッファを持たせる
			// "大手チェーン店（王将など）に限っては「閉店30分前まで表示する」"

			const threshold = isChain ? 30 : 55; // 緩和

			if (minRemaining >= threshold) {
				if (minRemaining <= 1440) {
					filtered.push({ place, remainingMinutes: minRemaining });
				}
			} else {
				console.log(`[Debug] Dropping ${name}: Closing soon (${minRemaining} mins < ${threshold} mins threshold). Chain: ${isChain}`);
			}
		} else {
			// openNow=true だが period ロジックで閉まっていると判定された場合
			// Googleのリアルタイム情報を信じて、例外的に通すことも検討できるが、
			// 閉店時間が計算できないと "あと何分" が出せないので、一応除外するか、
			// 閉店時間を "不明" として通すか。
			// 安全のため除外 (閉店ギリギリの可能性が高い)
			console.log(`[Debug] Dropping ${place.displayName?.text}: OpenNow=true but no closing time calculated.`);
		}
	}

	return filtered;
}

// ========================================
// Gemini AI 分析
// ========================================

/**
 * 複数の店舗情報をまとめてGeminiに送信し、一括で分析を行う
 */
// ========================================
// 3. AI Analysis (Notion AI Workflow - Gemini Bypassed)
// ========================================

/**
 * 複数の店舗情報をまとめて処理し、Notion CacheまたはGoogleデータから簡易分析を生成する
 * (Gemini API呼び出しは廃止)
 */
export async function analyzeWithGeminiBatch(stores: any[], isDrinkingMode: boolean = false, locationName?: string): Promise<Record<string, AIAnalysis>> {
	if (stores.length === 0) return {};

	// Level 1: In-memory cache
	const storesToAnalyze = stores.filter(s => !aiCache.has(s.id));
	const cachedResults: Record<string, AIAnalysis> = {};

	stores.forEach(s => {
		if (aiCache.has(s.id)) {
			cachedResults[s.id] = aiCache.get(s.id)!;
		}
	});

	if (storesToAnalyze.length === 0) {
		return cachedResults;
	}

	// Level 2: Notion persistent cache
	const placeIdsToCheck = storesToAnalyze.map(s => s.id);
	const notionResults = await batchFetchCachedAnalysis(placeIdsToCheck);

	// Filter to only truly uncached stores
	const uncachedStores = storesToAnalyze.filter(s => !notionResults.has(s.id));

	// Merge Notion results into cache
	notionResults.forEach((analysis, placeId) => {
		cachedResults[placeId] = analysis;
		aiCache.set(placeId, analysis); // Update memory cache
	});

	if (uncachedStores.length > 0) {
		console.log(`[Google Maps] processing ${uncachedStores.length} new stores (Background Notion Save)`);

		const analysisMap: Record<string, AIAnalysis> = {};
		const validStoresToSave: any[] = [];
		const validAnalysesToSave: any[] = [];

		for (const s of uncachedStores) {
			const storeName = s.displayName?.text || s.name || 'Unknown';
			const googleRating = s.rating || 3.0;
			const editorialSummary = s.editorialSummary?.text || '';
			const types = Array.isArray(s.types) ? s.types : [];
			const locationNameForStore = locationName || s.formattedAddress || 'Unknown Location';

			// Fallback: If no editorial summary, use address for context
			const summaryForNotion = editorialSummary || `住所: ${locationNameForStore}`;

			// Extract Reviews
			const reviews = Array.isArray(s.reviews) ? s.reviews.map((r: any) => r.text?.text || '').filter((t: string) => t.length > 0) : [];

			// Simple Menu Extraction (Regex-based Fallback)
			const menuKeywords = ['ラーメン', 'チャーハン', '餃子', 'カレー', 'パスタ', 'ピザ', 'オムライス', '唐揚げ', '焼き鳥', '刺身', '寿司', 'ハンバーグ', 'ステーキ', 'うどん', 'そば', '天ぷら', '定食', 'パンケーキ', 'タルト', 'コーヒー', 'チーズケーキ', 'アヒージョ', 'ローストビーフ'];
			const foundMenus = new Set<string>();
			const reviewTextCombined = reviews.join(' ');

			menuKeywords.forEach(keyword => {
				if (reviewTextCombined.includes(keyword)) {
					foundMenus.add(keyword);
				}
			});
			const popularMenu = Array.from(foundMenus).slice(0, 3); // Top 3 found

			// Alcohol Availability Logic
			const alcoholFlags = [];
			if (s.servesBeer) alcoholFlags.push('ビール');
			if (s.servesWine) alcoholFlags.push('ワイン');

			let alcoholSummaryInfo = '';
			if (alcoholFlags.length > 0) {
				alcoholSummaryInfo = `【お酒: あり (${alcoholFlags.join(', ')})】`;
			} else if (types.includes('bar') || types.includes('night_club') || types.includes('izakaya_restaurant')) {
				alcoholSummaryInfo = `【お酒: あり (提供店)】`;
			}

			// Combine for Notion Summary
			const finalSummary = (summaryForNotion + (summaryForNotion ? ' ' : '') + alcoholSummaryInfo).trim();

			// Basic categorization
			const isBar = types.includes('bar') || types.includes('night_club') || types.includes('izakaya_restaurant');
			const isCafe = types.includes('cafe') || types.includes('coffee_shop');

			// Map types to Category (Japanese)
			const categoryList: string[] = [];
			if (isBar) categoryList.push('居酒屋/バー');
			if (isCafe) categoryList.push('カフェ');
			if (types.includes('restaurant')) categoryList.push('レストラン');
			if (types.includes('store')) categoryList.push('店舗');
			if (categoryList.length === 0) categoryList.push('その他');

			// AI Insight Logic:
			let aiInsight = editorialSummary;
			if (!aiInsight) {
				aiInsight = "";
			}

			const analysis: AIAnalysis = {
				score: googleRating,
				drinking_score: isBar ? 4.0 : 0,
				ai_insight: aiInsight,
				editorial_summary: editorialSummary,
				alcohol_status: isBar ? "🍺 お酒あり" : "不明",
				alcohol_note: "",
				hero_feature: editorialSummary ? "公式紹介あり" : "評価参照",
				best_for: isBar ? "飲み会" : "食事",
				lo_risk: "標準",
				mood: "不明",
				recommendedMenu: popularMenu.join(', '),
				hasAlcohol: isBar, // Determine based on type
				tags: ["連携待ち"] // Temporary tag
			};

			analysisMap[s.id] = analysis;
			aiCache.set(s.id, analysis); // Cache immediately

			// Prepare for background save
			validStoresToSave.push(s);
			validAnalysesToSave.push({
				storeName,
				locationNameForStore,
				aiInsight,
				googleRating,
				finalSummary,
				categoryList,
				reviews,
				popularMenu
			});
		}

		// FIRE AND FORGET (Background Save)
		// Do not await this. Let it run in background.
		(async () => {
			for (let i = 0; i < validStoresToSave.length; i++) {
				const s = validStoresToSave[i];
				const data = validAnalysesToSave[i];
				try {
					await saveToNotion(
						s.id,
						data.storeName,
						data.locationNameForStore,
						data.aiInsight,
						data.googleRating,
						data.finalSummary,
						data.categoryList,
						data.reviews.slice(0, 5),
						data.popularMenu
					);
				} catch (err: any) {
					console.error(`[Notion Background] Save failed for ${data.storeName}: ${err.message}`);
				}
			}
			console.log(`[Notion Background] Completed saving ${validStoresToSave.length} items.`);
		})();

		return { ...cachedResults, ...analysisMap };
	}

	return cachedResults; // All stores were cached
}


// REMOVED deprecated analyzeWithGemini function to avoid SDK dependency errors.

// ========================================
// カテゴリ判定
// ========================================



/**
 * 店舗タイプと名称からカテゴリを判定
 */
/**
 * チェーン店かどうかを判定
 */
function isChainStore(name: string): boolean {
	const chains = [
		'すき家', '吉野家', '松屋', 'なか卯',
		'マクドナルド', 'モスバーガー', 'バーガーキング', 'ケンタッキー',
		'スターバックス', 'ドトール', 'タリーズ', 'コメダ珈琲',
		'サイゼリヤ', 'ガスト', 'デニーズ', 'ジョイフル', 'ロイヤルホスト',
		'スシロー', 'くら寿司', 'はま寿司', 'かっぱ寿司',
		'ココイチ', '天下一品', '丸亀製麺', '日高屋', '餃子の王将',
		'牛角', '鳥貴族'
	];
	return chains.some(chain => name.includes(chain));
}

/**
 * 店舗タイプと名称からカテゴリを判定
 */
function determineCategory(types: string[] = [], name: string = ''): string {
	// 1. 手動マッピング (チェーン店など)
	if (name.includes('すき家') || name.includes('吉野家') || name.includes('松屋')) return '牛丼/定食';
	if (name.includes('マクドナルド') || name.includes('モスバーガー') || name.includes('バーガーキング')) return 'ハンバーガー';
	if (name.includes('スターバックス') || name.includes('ドトール') || name.includes('タリーズ') || name.includes('コメダ珈琲')) return 'カフェ';
	if (name.includes('サイゼリヤ') || name.includes('ガスト')) return 'ファミレス';
	if (name.includes('スシロー') || name.includes('くら寿司') || name.includes('はま寿司')) return '回転寿司';
	if (name.includes('ラーメン') || name.includes('拉麺')) return 'ラーメン';
	if (name.includes('焼肉') || name.includes('ホルモン')) return '焼肉'; // Name match priority

	if (!types || types.length === 0) return 'その他';

	// 2. 詳細なタイプを優先 (順序重要: 焼肉を和食より先に判定)
	if (types.includes('yakiniku_restaurant') || types.includes('barbecue_restaurant')) return '焼肉';
	if (types.includes('ramen_restaurant')) return 'ラーメン';
	if (types.includes('sushi_restaurant')) return '寿司';
	if (types.includes('italian_restaurant')) return 'イタリアン';
	if (types.includes('french_restaurant')) return 'フレンチ';
	if (types.includes('chinese_restaurant')) return '中華';
	if (types.includes('japanese_restaurant')) return '和食'; // 焼肉が除外された後に判定される
	if (types.includes('izakaya_restaurant')) return '居酒屋';
	if (types.includes('fast_food_restaurant')) return 'ファストフード';
	if (types.includes('hamburger_restaurant')) return 'ハンバーガー';
	if (types.includes('steak_house')) return 'ステーキ';
	if (types.includes('seafood_restaurant')) return '海鮮';

	// 3. 一般的なカテゴリ
	if (types.includes('bar') || types.includes('night_club') || types.includes('pub')) return '居酒屋・バー';
	if (types.includes('cafe') || types.includes('coffee_shop')) return 'カフェ';
	if (types.includes('bakery')) return 'ベーカリー';
	if (types.includes('meal_takeaway')) return 'テイクアウト';
	if (types.includes('restaurant')) return 'レストラン';

	return 'レストラン';
}

/**
 * 2点間の距離を計算 (Haversine formula)
 * @returns 距離 (メートル)
 */
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const R = 6371e3; // 地球の半径 (メートル)
	const φ1 = (lat1 * Math.PI) / 180;
	const φ2 = (lat2 * Math.PI) / 180;
	const Δφ = ((lat2 - lat1) * Math.PI) / 180;
	const Δλ = ((lng2 - lng1) * Math.PI) / 180;

	const a =
		Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
		Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

	return Math.round(R * c);
}

// ========================================
// データ取得と分析の分離
// ========================================

/**
 * 1. 基本的な店舗情報の取得とフィルタリング
 */
export async function getBasicStores(lat: number, lng: number, isDrinkingMode: boolean = false, locationName?: string): Promise<{ basicStores: RecommendedStore[], originalPlaces: PlaceData[] }> {
	try {
		console.log(`Searching stores near(${lat}, ${lng})[Location: ${locationName}]...`);

		// 1. Places API で周辺の店舗を取得
		let queries: string[] = [];
		const searchRadius = 1500;

		// 統合クエリ: 通常・飲みモードの両方をカバー
		queries = ["飲食店", "居酒屋", "バー", "深夜営業", "カフェ", "ラーメン", "中華", "焼肉", "イタリアン", "ダイニング", "バル"];

		// 地名がある場合は、隠れ家/個人店クエリを追加 (並列検索で名店を拾う)
		if (locationName && !locationName.includes("現在地") && !locationName.includes("見つかりません")) {
			const cleanLoc = locationName.replace("周辺", "").trim();
			if (cleanLoc.length > 0) {
				console.log(`Adding local queries for: ${cleanLoc} `);
				queries.push(`${cleanLoc} 居酒屋 個人店`);
				queries.push(`${cleanLoc} バー 隠れ家`);
				queries.push(`${cleanLoc} 焼肉 名店`);
				queries.push(`${cleanLoc} 美味しい店`);
			}
		}

		// 検索半径 (飲みモード: 1500m, 通常: 1000m)
		// ユーザー要望により厳格に1.5kmを適用
		// 検索半径 (飲みモード: 1500m, 通常: 1000m)
		// ユーザー要望により厳格に1.5kmを適用
		// const searchRadius = 1500; // Removed duplicate

		// 並列実行
		const promises = queries.map(q => fetchPlacesByText(lat, lng, q, searchRadius));
		const results = await Promise.all(promises);

		// 重複排除 (IDで一意にする)
		const placeMap = new Map<string, PlaceData>();
		results.flat().forEach(place => {
			// IDがない場合は除外
			if (!place.id) return;

			// 距離チェック (厳格フィルタ)
			// APIのradiusは"bias"なので、範囲外も返る可能性があるため、ここで弾く
			if (place.location) {
				const dist = calculateDistance(lat, lng, place.location.latitude, place.location.longitude);
				if (dist > searchRadius) {
					// console.log(`[Debug] Dropping ${ place.displayName?.text }: Distance ${ dist } m > ${ searchRadius } m`);
					return;
				}
				placeMap.set(place.id, place);
			}
		});

		let places = Array.from(placeMap.values());

		// 距離でソート (近い順)
		places.sort((a, b) => {
			const distA = a.location ? calculateDistance(lat, lng, a.location.latitude, a.location.longitude) : 99999;
			const distB = b.location ? calculateDistance(lat, lng, b.location.latitude, b.location.longitude) : 99999;
			return distA - distB;
		});



		console.log(`Found ${places.length} places(after deduplication & distance filter)`);

		// 2. 閉店まで60分以上の店舗をフィルタリング
		const filteredPlaces = filterByClosingTime(places);
		console.log(`After filtering(Closing Time): ${filteredPlaces.length} places`);

		// 3. チェーン店率の調整 (全モード共通で適用)
		// 食事メインの大手チェーン (飲み利用の優先度を下げる・UX向上のため制限)
		const fastFoodChains = /すき家|マクドナルド|マック|吉野家|松屋|やよい軒|大戸屋|サイゼリヤ|ガスト|ココス|モスバーガー|ケンタッキー|ミスタードーナツ|CoCo壱番屋|かつや|てんや|はま寿司|スシロー|くら寿司|かっぱ寿司|丸亀製麺|日高屋|餃子の王将|大阪王将|スターバックス|ドトール|タリーズ/;

		// 飲みモード時: お酒を提供しないカテゴリを厳格に除外
		let candidatePlaces = filteredPlaces;
		if (isDrinkingMode) {
			const nonAlcoholCategories = /カフェ|ベーカリー|ファストフード|ハンバーガー|牛丼|回転寿司/;
			const beforeCount = candidatePlaces.length;
			candidatePlaces = candidatePlaces.filter(p => {
				const category = determineCategory(p.place.types, p.place.displayName?.text || '');
				return !nonAlcoholCategories.test(category);
			});
			console.log(`[Drinking Mode]Non - alcohol category filter: ${beforeCount} -> ${candidatePlaces.length} places`);
		}

		// チェーン店率の調整 (全モード共通で適用)
		const chains = candidatePlaces.filter(p => fastFoodChains.test(p.place.displayName?.text || ''));
		const independents = candidatePlaces.filter(p => !fastFoodChains.test(p.place.displayName?.text || ''));

		// API負荷対策: 表示は20件
		const maxDisplayItems = 20; // 画面表示用
		// maxAIAnalysisItems removed (No limit)

		// 評価順にソート (高い順)
		const sortByRating = (list: { place: PlaceData, remainingMinutes: number }[]) => {
			return list.sort((a, b) => {
				const ratingA = a.place.rating || 0;
				const ratingB = b.place.rating || 0;
				if (ratingB !== ratingA) return ratingB - ratingA; // 評価が高い順
				// 評価が同じ場合は距離で比較
				const distA = calculateDistance(lat, lng, a.place.location!.latitude, a.place.location!.longitude);
				const distB = calculateDistance(lat, lng, b.place.location!.latitude, b.place.location!.longitude);
				return distA - distB;
			});
		};

		const sortedChains = sortByRating(chains);
		const sortedIndependents = sortByRating(independents);

		// Merge and take top 20
		const combined = [...sortedIndependents, ...sortedChains];
		const targetPlaces = sortByRating(combined).slice(0, maxDisplayItems);

		console.log(`[Google Maps] Returning top ${targetPlaces.length} places for display & analysis.`);


		// 3. RecommendedStoreの初期構造を作成
		const basicStores: RecommendedStore[] = targetPlaces.map(({ place, remainingMinutes }) => {
			// Calculate distance using the request origin (lat, lng)
			// Note: This is straight-line distance (Haversine).
			// Places API (New) searchNearby does not return routing distance.

			const distance = (place.location)
				? calculateDistance(lat, lng, place.location.latitude, place.location.longitude)
				: 0;

			// Debug for distance (first few)
			if (targetPlaces.indexOf({ place, remainingMinutes }) < 3) {
				console.log(`[Debug] Distance for ${place.displayName?.text}: ${distance} m(Origin: ${lat}, ${lng} -> Store: ${place.location?.latitude}, ${place.location?.longitude})`);
			}

			// Format distance
			let formattedDistance = '';
			if (distance >= 1000) {
				formattedDistance = `${(distance / 1000).toFixed(1)} km`;
			} else {
				formattedDistance = `${distance} m`;
			}

			const displayName = place.displayName?.text || 'Unknown';
			const photoName = (place.photos && place.photos.length > 0) ? place.photos[0].name : undefined;

			return {
				id: place.id || '',
				name: displayName,
				address: place.formattedAddress || '',
				category: determineCategory(place.types, displayName),

				alcohol_status: '',
				alcohol_note: '',
				hero_feature: '',
				ai_insight: '',
				best_for: '',
				lo_risk: '',
				mood: '',
				priceLevel: place.priceLevel || 'PRICE_LEVEL_UNSPECIFIED',
				reviewCount: place.reviews?.length || 0,
				closingTimeMinutes: remainingMinutes,
				googleMapsUri: place.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.displayName?.text || '')}`,
				score: 0, // Default
				rating: place.rating || 0,
				distance: distance,
				formattedDistance: formattedDistance,
				reviewsText: place.reviews?.map(r => r.text?.text || "").join(" ") || "", // Add reviews for client search
				recommendedMenu: '', // Default
				hasAlcohol: false, // Default
				tags: [], // Default
				phoneNumber: place.nationalPhoneNumber,
				reservationUrl: place.websiteUri,
				photoName: photoName,
				drinking_score: 0 // Init
			};
		});

		// AI分析用にオリジナルのPlaceDataも返す
		const originalPlaces = targetPlaces.map(p => p.place);

		return { basicStores, originalPlaces };
	} catch (error) {
		console.error('Error in getBasicStores:', error);
		throw error;
	}
}

/**
 * 2. 店舗リストに対してAI分析を並列実行して埋める
 */
export async function fillAIAnalysis(stores: RecommendedStore[], originalPlaces: PlaceData[], isDrinkingMode: boolean = false, locationName?: string): Promise<RecommendedStore[]> {
	console.log('Starting Batch AI analysis...');

	// Limit Removed: Process ALL stores (Legacy limit removed)

	// Map existing structure to AI analysis input
	const storesToAnalyze = stores.map(store => {
		const originalPlace = originalPlaces.find(p => p.id === store.id);
		const recentReviews = (originalPlace?.reviews || []).slice(0, 3);
		const reviewsText = recentReviews
			.map(r => r.text?.text || '')
			.filter(t => t.length > 0)
			.map(t => t.substring(0, 100))
			.join('\n');

		const reservationInfo = store.reservationUrl ? `予約URL: ${store.reservationUrl}` : (store.phoneNumber ? `電話: ${store.phoneNumber}` : "予約情報なし");

		return {
			id: store.id,
			name: store.name,
			category: store.category,
			closingTime: store.closingTimeMinutes,
			distance: store.formattedDistance,
			types: store.tags,
			reviews: `【基本情報】\n${reservationInfo}\n\n【レビュー】\n${reviewsText || "レビューなし"}`
		};
	});

	try {
		// 2. Call Gemini Batch
		const analysisMap = await analyzeWithGeminiBatch(storesToAnalyze, isDrinkingMode, locationName);
		console.log('Batch Analysis Completed. Merging results...');

		// 3. Merge results
		return stores.map(store => {
			const analysis = analysisMap[store.id];
			if (analysis) {
				return {
					...store,
					category: analysis.category || store.category, // Notion overrides Google
					alcohol_status: analysis.alcohol_status,
					alcohol_note: analysis.alcohol_note,
					hero_feature: analysis.hero_feature,
					ai_insight: analysis.ai_insight,
					best_for: analysis.best_for,
					lo_risk: analysis.lo_risk,
					mood: analysis.mood,
					score: analysis.score,
					recommendedMenu: analysis.recommendedMenu,
					drinking_score: analysis.drinking_score, // New
					// Keep original values and new contact info
				};
			} else {
				// Fallback: Top5以外はテンプレート生成
				const templateInsight = `人気の${store.category}です。評価は★${store.rating.toFixed(1)}で、${store.formattedDistance}の場所にあります。`;
				return {
					...store,
					hero_feature: `★${store.rating.toFixed(1)}`,
					ai_insight: templateInsight,
					best_for: '詳細はレビューをご確認ください',
					alcohol_status: '基本情報',
					score: store.rating // Use Google rating as fallback score
				};
			}
		});

	} catch (error) {
		console.error('Batch processing failed:', error);
		return stores;
	}
}

/**
 * 以前の統合関数（後方互換性のため残すが、非推奨）
 */
export async function getRecommendedStores(lat: number, lng: number): Promise<RecommendedStore[]> {
	const { basicStores, originalPlaces } = await getBasicStores(lat, lng);
	return fillAIAnalysis(basicStores, originalPlaces);
}

/** 
 * JSON文字列を抽出するヘルパー関数
 */
function extractJson(text: string): string {
	// マークダウンのコードブロックを除去
	let cleanText = text.replace(/```json/g, '').replace(/```/g, '');

	// 最初に見つかった { から 最後に見つかった } までを抽出
	const start = cleanText.indexOf('{');
	const end = cleanText.lastIndexOf('}');

	if (start !== -1 && end !== -1 && end > start) {
		return cleanText.substring(start, end + 1);
	}

	return cleanText;
}
