import { Client } from '@notionhq/client';
import { NOTION_API_KEY, NOTION_DATABASE_ID } from '$env/static/private';

// ========================================
// 1. Client Initialization & Export
// ========================================

export const notion = new Client({ auth: NOTION_API_KEY });

// Robust ID handling
// Allow both 32-char hex and 36-char UUID.
const rawId = (NOTION_DATABASE_ID || '').trim();
// Remove quotes if present
const cleanRawId = rawId.replace(/^["']|["']$/g, '');

// Helper to format as UUID if simple 32-char string
function formatUuid(id: string): string {
    if (id.includes('-')) return id; // Assuming already UUID
    if (id.length !== 32) return id; // Fallback
    return id.replace(/([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})/i, "$1-$2-$3-$4-$5");
}

export const databaseId = formatUuid(cleanRawId);
export const formattedDatabaseId = databaseId;

console.log('[Notion] Client initialized.');
console.log(`[Notion] Database ID (Source): "${cleanRawId.substring(0, 4)}...${cleanRawId.slice(-4)}"`);
console.log(`[Notion] Database ID (Used): "${formattedDatabaseId}"`);

// ========================================
// 2. Batch Fetch (Cached Analysis)
// ========================================

/**
 * Batch fetch cached analyses using raw request
 */
export async function batchFetchCachedAnalysis(placeIds: string[]): Promise<Map<string, any>> {
    if (!formattedDatabaseId) {
        console.error('[Notion Cache] No database ID configured');
        return new Map();
    }

    try {
        const requestPath = `databases/${formattedDatabaseId}/query`;

        console.log(`[Notion] Batch Fetching for ${placeIds.length} IDs...`);

        const response: any = await notion.request({
            path: requestPath,
            method: 'post',
            body: {
                page_size: 100, // Fetch up to 100
            }
        });

        const results = new Map<string, any>();

        for (const page of response.results) {
            if (!('properties' in page)) continue;

            const props = page.properties;
            let placeId = '';

            // Extract PlaceID
            if (props.PlaceID?.type === 'rich_text' && props.PlaceID.rich_text.length > 0) {
                placeId = props.PlaceID.rich_text[0].plain_text;
            } else if (props.PlaceID?.type === 'title' && props.PlaceID.title.length > 0) {
                placeId = props.PlaceID.title[0].plain_text;
            }

            // If found in our request list (or we just cache everything found)
            if (!placeId) continue;

            // Mapping:
            // Catchphrase -> ai_insight
            // PopularMenu -> recommendedMenu
            const catchphrase = props.Catchphrase?.rich_text?.[0]?.plain_text ||
                props.AIComment?.rich_text?.[0]?.plain_text || ''; // Fallback

            const popularMenu = props.PopularMenu?.rich_text?.[0]?.plain_text || '';
            const score = props.Score?.number || 0;
            const category = props.Category?.select?.name || 'Unknown';
            const drinkingScore = props.DrinkingScore?.number || 0;

            const analysis: any = {
                ai_insight: catchphrase,
                tags: props.AITags?.multi_select?.map((tag: any) => tag.name) || [],
                score: score,
                drinking_score: drinkingScore,
                category: category,
                recommendedMenu: popularMenu,
                // Add hero feature logic if needed
                hero_feature: catchphrase ? "Notion情報あり" : "分析中..."
            };

            results.set(placeId, analysis);
        }

        console.log(`[Notion Cache] Found ${results.size} matches.`);
        return results;
    } catch (error: any) {
        console.error('[Notion Cache] Fetch Error:', error.message);
        // Log basic body info if available to debug "Invalid request URL"
        if (error.status === 404 || error.status === 400) {
            console.error('[Notion Debug] Check Database ID correctness.');
        }
        return new Map();
    }
}

/**
 * Save to Notion using SDK pages.create
 * Saves basic info + Google rich data (Reviews, Genre) so Notion AI can generate descriptions.
 */
// Helper regex for validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveToNotion(
    placeId: string,
    name: string,
    location?: string,
    aiComment?: string,
    rating?: number,
    summary?: string,
    category?: string[],
    reviews?: string[],
    popularMenu?: string[]
): Promise<boolean> {

    // 1. Prepare Target DB ID (Strict 32-char Alphanumeric)
    let targetDbId = formattedDatabaseId;
    if (!targetDbId) {
        console.error('[Notion] ❌ Database ID not configured');
        return false;
    }

    // [USER REQUEST] Strict sanitization: Use 32-char alphanumeric ID ONLY.
    // NO hyphen re-insertion.
    const cleanAlpha = (targetDbId || '').replace(/[^a-zA-Z0-9]/g, '');
    const finalDbId = cleanAlpha; // Use raw 32-char ID directly

    // Log to verify
    console.log(`[Notion Debug] Using Clean 32-char ID: ${finalDbId}`);

    // 2. Duplicate Check (Safety Net)
    try {
        const response: any = await notion.request({
            path: `databases/${finalDbId}/query`,
            method: 'post',
            body: {
                filter: {
                    property: 'PlaceID',
                    rich_text: {
                        equals: placeId
                    }
                }
            }
        });

        const hitCount = response.results ? response.results.length : 0;
        console.log(`[Notion Debug] Duplicate check result for "${name}": ${hitCount} found`);

        if (hitCount > 0) {
            console.log(`[Notion] ℹ️ Skipped (Already exists): ${name}`);
            return true;
        }
    } catch (queryError: any) {
        console.error(`[Notion] ❌ Duplicate check FAILED for ${name}: ${queryError.message}`);
        // [USER REQUEST] If check fails, SKIP SAVE to be safe.
        return true;
    }

    // 3. Construct Payload with Correct Types
    try {
        const payload: any = {
            parent: { database_id: finalDbId },
            properties: {
                Name: {
                    title: [{ text: { content: name || 'Unknown' } }]
                },
                PlaceID: {
                    rich_text: [{ text: { content: placeId } }]
                },
                Location: {
                    rich_text: location ? [{ text: { content: location } }] : []
                },
                // Category (Select)
                Category: {
                    select: (category && category.length > 0) ? { name: category[0] } : null
                },
                // Score (Number)
                Score: {
                    number: rating || 0
                },
                // PopularMenu (RichText)
                PopularMenu: {
                    rich_text: [{ text: { content: (popularMenu || []).join(', ') } }]
                },
                // Summary (RichText)
                Summary: {
                    rich_text: summary ? [{ text: { content: summary } }] : []
                }
            },
            children: [
                {
                    object: 'block',
                    type: 'heading_3',
                    heading_3: {
                        rich_text: [{ text: { content: 'Google Maps Data (Source)' } }]
                    }
                },
                {
                    object: 'block',
                    type: 'paragraph',
                    paragraph: {
                        rich_text: [
                            { text: { content: `Rating: ${rating || 'N/A'}\n` } },
                            { text: { content: `Summary: ${summary || 'No summary provided.'}\n` } }
                        ]
                    }
                }
            ]
        };

        // Append Reviews
        if (reviews && reviews.length > 0) {
            payload.children.push({
                object: 'block',
                type: 'heading_3',
                heading_3: {
                    rich_text: [{ text: { content: 'Recent Reviews' } }]
                }
            });
            reviews.forEach((review, index) => {
                const truncated = review.length > 1000 ? review.substring(0, 1000) + '...' : review;
                payload.children.push({
                    object: 'block',
                    type: 'paragraph',
                    paragraph: {
                        rich_text: [{ text: { content: `Review ${index + 1}: ${truncated}` } }]
                    }
                });
            });
        }

        // Add AI Instruction
        payload.children.push({
            object: 'block',
            type: 'callout',
            callout: {
                rich_text: [{
                    text: {
                        content: `🤖 Notion AIへの指示:\n1. 上記の店名・ジャンル・概要を元に、大学生が明日行きたくなる15文字以内のキャッチコピーを作成してください（数字禁止）。\n2. レビューから人気メニューを3つ抽出し、箇条書きで列挙してください。`
                    }
                }],
                icon: { emoji: '✨' }
            }
        });

        // AIComment (Legacy)
        if (aiComment) {
            payload.properties.AIComment = {
                rich_text: [{ text: { content: aiComment } }]
            };
        }

        await notion.pages.create(payload);

        console.log(`[Notion] ✅ Saved New: ${name}`);
        return true;
    } catch (error: any) {
        console.error(`[Notion] ❌ Save Failed Body:`, JSON.stringify(error.body || error.message));
        return false;
    }
}
