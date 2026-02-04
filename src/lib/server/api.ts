import { GOOGLE_MAPS_API_KEY } from '$env/static/private';
import { env } from '$env/dynamic/private';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { aiCache, type AIAnalysis } from './cache';

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
	takeout?: boolean; // New (Official)
	reservable?: boolean; // New (Official)
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
	hasTakeout?: boolean; // New
	editorialSummary?: { text: string }; // New
	location?: { latitude: number; longitude: number }; // New: For map integration
}

// In-memory cache for AI analysis: Imported from ./cache

// ========================================
// Helper Functions
// ========================================

async function fetchWithRetry(url: string, options: RequestInit, retries = 2): Promise<Response> {
	for (let i = 0; i <= retries; i++) {
		try {
			// 10s Timeout
			const signal = AbortSignal.timeout(10000);
			const response = await fetch(url, { ...options, signal });

			if (response.ok) return response;

			// Handle 429 (Too Many Requests) - FAIL FAST (No Retry)
			if (response.status === 429) {
				console.warn('Request 429 (Quota Exceeded). Fail fast.');
				// Return a dummy 429 response that caller can handle, or throw.
				// Here we return the response so the caller sees !ok and handles it.
				return response;
			}

			// Other errors: immediately throw/return to avoid infinite wait
			if (i === retries) return response;

		} catch (e: any) {
			if (i === retries) throw e;
			console.warn(`Fetch error (${e.message}). Retrying...`);
		}
	}
	throw new Error('Fetch failed after retries');
}

/**
 * Google Places API - テキスト検索 (New)
 */
async function fetchPlacesByText(lat: number, lng: number, query: string, radius: number = 1500): Promise<PlaceData[]> {
	try {
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
			openNow: true,
		};

		const response = await fetchWithRetry(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
				'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.currentOpeningHours,places.reviews,places.priceLevel,places.types,places.googleMapsUri,places.rating,places.location,places.nationalPhoneNumber,places.websiteUri,places.editorialSummary,places.takeout,places.reservable'
			},
			body: JSON.stringify(requestBody)
		});

		if (!response.ok) {
			console.warn(`Text Search API error for "${query}": ${response.status}`);
			return [];
		}

		const data = await response.json();

		// Memory Optimization: Strip unnecessary data immediately
		if (!data.places) return [];

		return data.places.map((p: any) => ({
			id: p.id,
			displayName: p.displayName,
			formattedAddress: p.formattedAddress,
			currentOpeningHours: p.currentOpeningHours,
			reviews: p.reviews, // AI analysis needs this
			priceLevel: p.priceLevel,
			types: p.types,
			googleMapsUri: p.googleMapsUri,
			rating: p.rating,
			location: p.location,
			nationalPhoneNumber: p.nationalPhoneNumber,
			websiteUri: p.websiteUri,
			editorialSummary: p.editorialSummary,
			takeout: p.takeout,
			reservable: p.reservable,
			// Exclude html_attributions, photos (large metadata), etc if not strictly needed
			// Keep photo name only
			photos: p.photos ? p.photos.map((ph: any) => ({ name: ph.name })) : []
		}));

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

	// console.log(`[Debug] Filtering start. Current JST: ${currentJST.toLocaleString('ja-JP')} (WeekMin: ${currentWeekMinutes})`);

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
				// console.log(`[Debug] Dropping ${name}: Closing soon (${minRemaining} mins < ${threshold} mins threshold). Chain: ${isChain}`);
			}
		} else {
			// openNow=true だが period ロジックで閉まっていると判定された場合
			// Googleのリアルタイム情報を信じて、例外的に通すことも検討できるが、
			// 閉店時間が計算できないと "あと何分" が出せないので、一応除外するか、
			// 閉店時間を "不明" として通すか。
			// 安全のため除外 (閉店ギリギリの可能性が高い)
			// console.log(`[Debug] Dropping ${place.displayName?.text}: OpenNow=true but no closing time calculated.`);
		}
	}

	return filtered;
}

// ========================================
// Gemini AI 分析
// ========================================

/**
 * 複数の店舗情報をまとめてGeminiに送信し、一括で分析を行う
 * (5件ずつのチャンクに分割して順次処理)
 */
export async function analyzeWithGeminiBatch(stores: any[], isDrinkingMode: boolean = false): Promise<Record<string, AIAnalysis>> {
	if (stores.length === 0) return {};

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

	const apiKey = env.GEMINI_API_KEY || GOOGLE_MAPS_API_KEY;
	const genAI = new GoogleGenerativeAI(apiKey);
	const model = genAI.getGenerativeModel({
		model: "gemini-2.5-flash",
		generationConfig: {
			responseMimeType: "application/json",
		}
	});

	// 結果を格納するマップ
	const resultMap: Record<string, AIAnalysis> = {};

	// 5件ずつのチャンクに分割して処理
	const chunkSize = 5;
	for (let i = 0; i < storesToAnalyze.length; i += chunkSize) {
		const chunk = storesToAnalyze.slice(i, i + chunkSize);

		// 統合プロンプト: 通常・飲みモードの両方を一度に判定
		const prompt = `
あなたは「信頼できるグルメ・コンシェルジュ」です。
ユーザーのために、リストのお店が「2軒目利用」や「飲み会」に適しているか、また「一般的な食事」に適しているかを総合的に評価してください。
**必ず日本語で回答してください。**

【評価基準】
1. **飲み適性 (drinking_score 1.0-5.0)**:
   - お酒の種類（ビール、ワイン、日本酒など）が豊富か。
   - "飲み"の雰囲気があるか（カウンター、落ち着いた照明など）。
   - 2軒目として利用しやすいか。
   - チェーン店は低めに設定(3.0以下)。
   - 【地元スコア】レビューに「地元の名店」「隠れ家」「教えたくない」等の記述があれば、drinking_score を 4.5以上に引き上げてください。
2. **総合スコア (score 1.0-5.0)**:
   - 店舗の総合的な魅力、料理の質、接客など。
   - 個人経営店や隠れ家的な店を優遇。
   - 大手チェーン店は原則 3.0-3.5 程度に抑えてください。

【出力フォーマット (JSON配列)】
[
  {
    "id": "店舗ID",
    "alcohol_status": "お酒の特徴 (例: 🍺クラフトビール充実)",
    "alcohol_note": "お酒好きへのアピール点",
    "hero_feature": "店の最大のウリ",
    "ai_insight": "独自の推薦コメント (100文字程度)",
    "best_for": "利用シーン (例: デート / 2軒目 / ファミリー)",
    "mood": "雰囲気",
    "score": 4.5,
    "drinking_score": 4.8, 
    "recommendedMenu": "おすすめメニュー",
    "hasAlcohol": true,
    "tags": ["2軒目向き", "飲み放題", "個室", "静か"]
  }
]

【分析対象店舗リスト】
${JSON.stringify(chunk, null, 2)}
`;

		try {
			const generate = async () => {
				const result = await model.generateContent(prompt);
				return JSON.parse(result.response.text());
			};

			let data;
			try {
				data = await generate();
			} catch (e: any) {
				if (e.toString().includes('429') || e.toString().includes('Quota')) {
					await new Promise(resolve => setTimeout(resolve, 5000));
					data = await generate();
				} else {
					throw e;
				}
			}

			if (Array.isArray(data)) {
				data.forEach((item: any) => {
					resultMap[item.id] = item;
					aiCache.set(item.id, item);
				});
			} else if (data.results) {
				data.results.forEach((item: any) => {
					resultMap[item.id] = item;
					aiCache.set(item.id, item);
				});
			}
		} catch (error: any) {
			// チャンク単位で失敗しても続行
			// エラーログは削除（高負荷防止）
		}

		// 連続リクエストを防ぐための短い待機
		await new Promise(resolve => setTimeout(resolve, 1000));
	}

	return { ...cachedResults, ...resultMap };
}

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

	if (!types || types.length === 0) return 'その他';

	// 2. 詳細なタイプを優先 (1:1 Mapping)
	if (types.includes('ramen_restaurant')) return 'ラーメン';
	if (types.includes('sushi_restaurant')) return '寿司';
	if (types.includes('yakiniku_restaurant')) return '焼肉';
	if (types.includes('italian_restaurant')) return 'イタリアン';
	if (types.includes('french_restaurant')) return 'フレンチ';
	if (types.includes('chinese_restaurant')) return '中華';
	if (types.includes('japanese_restaurant')) return '和食';
	if (types.includes('izakaya_restaurant')) return '居酒屋';
	if (types.includes('bar') || types.includes('night_club') || types.includes('pub')) return 'バー';
	if (types.includes('cafe') || types.includes('coffee_shop')) return 'カフェ';
	if (types.includes('fast_food_restaurant')) return 'ファストフード';
	if (types.includes('hamburger_restaurant')) return 'ハンバーガー';
	if (types.includes('steak_house')) return 'ステーキ';
	if (types.includes('seafood_restaurant')) return '海鮮';
	if (types.includes('bakery')) return 'ベーカリー';
	if (types.includes('meal_takeaway')) return 'テイクアウト';

	// 3. 一般的なカテゴリ
	if (types.includes('restaurant')) return 'レストラン';
	if (types.includes('food')) return 'その他';

	return 'その他';
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

// Server Execution Lock
let isServerBusy = false;

/**
 * 1. 基本的な店舗情報の取得とフィルタリング
 */
export async function getBasicStores(lat: number, lng: number, isDrinkingMode: boolean = false, _unused?: string, locationName?: string): Promise<{ basicStores: RecommendedStore[], originalPlaces: PlaceData[] }> {
	if (isServerBusy) {
		console.warn('Server is busy with another request. Skipping execution.');
		return { basicStores: [], originalPlaces: [] };
	}

	isServerBusy = true;
	try {
		console.log(`Searching stores near (${lat}, ${lng}) [Location: ${locationName}]...`);

		// 1. Places API で周辺の店舗を取得
		// 1. Places API で周辺の店舗を取得
		let queries: string[] = ["飲食店", "レストラン", "ランチ", "ディナー"]; // Base queries

		const searchRadius = 1500; // Strict 1.5km limit for all modes

		// Mode-specific queries
		if (isDrinkingMode) {
			console.log("Drinking Mode: ON - Adding alcohol-related queries");
			queries.push("居酒屋", "バー", "バル", "深夜営業", "Pub", "ダイニングバー");
		} else {
			// Normal mode specific
			queries.push("カフェ", "ラーメン", "定食", "中華", "イタリアン", "焼肉");
		}

		// 地名がある場合は、隠れ家/個人店クエリを追加 (並列検索で名店を拾う)
		if (locationName && !locationName.includes("現在地") && !locationName.includes("見つかりません")) {
			const cleanLoc = locationName.replace("周辺", "").trim();
			if (cleanLoc.length > 0) {
				console.log(`Adding local queries for: ${cleanLoc}`);
				if (isDrinkingMode) {
					queries.push(`${cleanLoc} 居酒屋 個人店`);
					queries.push(`${cleanLoc} バー 隠れ家`);
				} else {
					queries.push(`${cleanLoc} 美味しい店`);
					queries.push(`${cleanLoc} ランチ 人気`);
				}
			}
		}

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
					// console.log(`[Debug] Dropping ${place.displayName?.text}: Distance ${dist}m > ${searchRadius}m`);
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



		console.log(`Found ${places.length} places (after deduplication & distance filter)`);

		// 2. 閉店まで60分以上の店舗をフィルタリング
		const filteredPlaces = filterByClosingTime(places);
		console.log(`After filtering (Closing Time): ${filteredPlaces.length} places`);

		// 3. チェーン店率の調整 (全モード共通で適用)
		// 食事メインの大手チェーン (飲み利用の優先度を下げる・UX向上のため制限)
		const fastFoodChains = /すき家|マクドナルド|マック|吉野家|松屋|やよい軒|大戸屋|サイゼリヤ|ガスト|ココス|モスバーガー|ケンタッキー|ミスタードーナツ|CoCo壱番屋|かつや|てんや|はま寿司|スシロー|くら寿司|かっぱ寿司|丸亀製麺|日高屋|餃子の王将|大阪王将|スターバックス|ドトール|タリーズ/;

		const chains = filteredPlaces.filter(p => fastFoodChains.test(p.place.displayName?.text || ''));
		const independents = filteredPlaces.filter(p => !fastFoodChains.test(p.place.displayName?.text || ''));

		// チェーンは最大 20% (例: 9件)に制限 (より厳格に)


		const maxItems = 45; // AI分析リクエスト数
		const maxChains = Math.floor(maxItems * 0.2);
		const selectedChains = chains.slice(0, maxChains);
		const selectedIndependents = independents.slice(0, maxItems - selectedChains.length);

		// マージして距離順に再ソート
		const targetPlaces = [...selectedIndependents, ...selectedChains].sort((a, b) => {
			const distA = calculateDistance(lat, lng, a.place.location!.latitude, a.place.location!.longitude);
			const distB = calculateDistance(lat, lng, b.place.location!.latitude, b.place.location!.longitude);
			return distA - distB;
		});

		console.log(`Targeting ${targetPlaces.length} places for AI analysis`);

		// Filter out non-food places BEFORE creating RecommendedStore
		const excludedTypes = [
			'pharmacy', 'drugstore', 'convenience_store', 'dentist', 'gym', 'school', 'atm', 'bank', 'post_office',
			'lodging', 'gas_station', 'hospital', 'park', 'police', 'doctor', 'clothing_store', 'electronics_store',
			'shoe_store', 'book_store', 'hair_care', 'hardware_store', 'furniture_store', 'car_dealer'
		];
		const finalPlaces = targetPlaces.filter(({ place }) => {
			if (!place.types) return true;
			return !place.types.some(t => excludedTypes.includes(t));
		});

		// 3. RecommendedStoreの初期構造を作成
		const basicStores: RecommendedStore[] = finalPlaces.map(({ place, remainingMinutes }) => {
			// Calculate distance using the request origin (lat, lng)
			// Note: This is straight-line distance (Haversine).
			// Places API (New) searchNearby does not return routing distance.

			const distance = (place.location)
				? calculateDistance(lat, lng, place.location.latitude, place.location.longitude)
				: 0;

			// Debug for distance (first few)
			if (targetPlaces.indexOf({ place, remainingMinutes }) < 3) {
				// console.log(`[Debug] Distance...`);
			}

			// Format distance
			let formattedDistance = '';
			if (distance >= 1000) {
				formattedDistance = `${(distance / 1000).toFixed(1)}km`;
			} else {
				formattedDistance = `${distance}m`;
			}

			const displayName = place.displayName?.text || 'Unknown';
			const photoName = (place.photos && place.photos.length > 0) ? place.photos[0].name : undefined;

			return {
				id: place.id || '',
				name: displayName,
				address: place.formattedAddress || '',
				category: determineCategory(place.types, displayName),

				alcohol_status: '分析中...',
				alcohol_note: '',
				hero_feature: '...',
				ai_insight: 'AIが分析しています...',
				best_for: '...',
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
				drinking_score: 0, // Init
				hasTakeout: (() => {
					// 0. Exclude Non-Food Places (Strict Filter)
					const excludedTypes = ['pharmacy', 'drugstore', 'convenience_store', 'dentist', 'gym', 'school', 'atm', 'bank', 'post_office'];
					if (place.types && place.types.some(t => excludedTypes.includes(t))) {
						// 1.5km logic handles filtering, but we should mark/exclude here or earlier
						// Since this is mapping RecommendedStore, returning here doesn't remove it from list.
						// We should filter BEFORE mapping.
						// However, getBasicStores structure filters AFTER fetching.
						// I will add a 'deprecated' flag or filter logic in mapping?
						// Better: Filter 'targetPlaces' BEFORE mapping.
					}

					// テイクアウト判定ロジック
					// 1. Official Flag (Priority)
					if (place.takeout === true) return true;

					const name = displayName;
					const reviews = place.reviews?.map(r => r.text?.text || "").join(" ") || "";
					const summary = place.editorialSummary?.text || "";
					const types = place.types || [];

					// 2. 公式属性 (Google Maps Types)
					if (types.includes('meal_takeaway')) return true;

					// 3. キーワード判定 (店名・レビュー・説明)
					const kw = /テイクアウト|持ち帰り|弁当|to go|takeout|お土産/i;
					if (kw.test(name) || kw.test(reviews) || kw.test(summary)) return true;

					// 4. 指定リスト (ユーザー指定の確実な店)
					const whiteList = [
						"桃牛苑",
						"中華ダイニング 結",
						"結⭐︎",
						"ドマーニ",
						"O.G.O",
						"いぶき野びーふ亭",
						"ひまわり"
					];
					if (whiteList.some(w => name.includes(w))) return true;

					return false;
				})()
			};
		});

		// AI分析用にオリジナルのPlaceDataも返す
		const originalPlaces = targetPlaces.map(p => p.place);

		return { basicStores, originalPlaces };
	} catch (error) {
		console.error('Error in getBasicStores:', error);
		throw error;
	} finally {
		isServerBusy = false;
	}
}

/**
 * 2. 店舗リストに対してAI分析を並列実行して埋める
 */
export async function fillAIAnalysis(stores: RecommendedStore[], originalPlaces: PlaceData[], isDrinkingMode: boolean = false): Promise<RecommendedStore[]> {
	if (!stores || stores.length === 0) {
		console.log('No stores to analyze. Skipping AI.');
		return [];
	}

	console.log(`Starting Batch AI analysis for ${stores.length} stores...`);

	// 1. Prepare data for batch processing
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
	}).filter(s => true);

	try {
		// 2. Call Gemini Batch
		const analysisMap = await analyzeWithGeminiBatch(storesToAnalyze, isDrinkingMode);
		console.log(`Batch Analysis Completed. Merging ${Object.keys(analysisMap).length} results...`);

		// 3. Merge results
		return stores.map(store => {
			const analysis = analysisMap[store.id];
			if (analysis) {
				return {
					...store,
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
				// Fallback / No analysis
				return {
					...store,
					hero_feature: 'データ不足',
					ai_insight: '分析できませんでした（レビュー不足など）'
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
