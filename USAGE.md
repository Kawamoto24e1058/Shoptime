# Shoptime バックエンドAPI 使用例

このドキュメントでは、実装されたバックエンドAPIの使用方法を説明します。

## セットアップ

### 1. 環境変数の設定

`.env` ファイルを作成し、必要なAPIキーを設定してください：

```env
GROQ_API_KEY=your_groq_api_key_here
GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
NOTION_API_KEY=your_notion_api_key_here
NOTION_DATABASE_ID=your_notion_database_id_here
```

**APIキーの取得方法:**
- **Groq API**: https://console.groq.com/keys
- **Google Maps API**: https://console.cloud.google.com/apis/credentials (Places API を有効化)
- **Notion API**: https://www.notion.so/my-integrations

### 2. Notionデータベースの作成

Notionで新しいデータベースを作成し、以下のプロパティを追加してください：

| プロパティ名 | タイプ |
|------------|--------|
| Name | タイトル |
| 住所 | テキスト |
| 営業時間 | テキスト |
| お酒あり | チェックボックス |
| 雰囲気 | セレクト |
| AIおすすめ | テキスト |
| ラストオーダーリスク | チェックボックス |
| Place ID | テキスト |

**セレクトの選択肢（雰囲気）**: カジュアル、高級感、アットホーム、モダン、不明

## 使用例

### SvelteKit ルートでの使用

`src/routes/api/stores/+server.ts` を作成：

```typescript
import type { RequestHandler } from './$types';
import { 
  fetchNearbyStores, 
  analyzeStoreWithGroq, 
  saveToNotion, 
  filterStoresByClosingTime 
} from '$lib/server/api';
import { json } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url }) => {
  try {
    // クエリパラメータから緯度・経度を取得
    const lat = parseFloat(url.searchParams.get('lat') || '35.6812');
    const lng = parseFloat(url.searchParams.get('lng') || '139.7671');
    const radius = parseInt(url.searchParams.get('radius') || '500');

    // 1. 周辺の営業中店舗を取得
    console.log('Fetching nearby stores...');
    const stores = await fetchNearbyStores(lat, lng, radius);
    console.log(`Found ${stores.length} stores`);

    // 2. 閉店時間でフィルタリング（60分未満を除外）
    const filteredStores = filterStoresByClosingTime(stores);
    console.log(`After filtering: ${filteredStores.length} stores`);

    // 3. 各店舗をAIで分析してNotionに保存
    const results = [];
    for (const store of filteredStores.slice(0, 5)) { // 最大5件
      try {
        // レビューテキストを抽出
        const reviewTexts = store.reviews?.map(r => r.text) || [];
        
        // AIで分析
        console.log(`Analyzing store: ${store.name}`);
        const analysis = await analyzeStoreWithGroq(reviewTexts, store.name);

        // Notionに保存
        const notionData = {
          place_id: store.place_id,
          name: store.name,
          address: store.address,
          opening_hours_text: store.opening_hours?.weekday_text?.join(', ') || '情報なし',
          ...analysis
        };
        
        await saveToNotion(notionData);
        console.log(`Saved to Notion: ${store.name}`);
        
        results.push({
          store: store.name,
          analysis,
          saved: true
        });
      } catch (error) {
        console.error(`Error processing store ${store.name}:`, error);
        results.push({
          store: store.name,
          error: error instanceof Error ? error.message : 'Unknown error',
          saved: false
        });
      }
    }

    return json({
      success: true,
      total_found: stores.length,
      after_filter: filteredStores.length,
      processed: results.length,
      results
    });
  } catch (error) {
    console.error('Error in stores endpoint:', error);
    return json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
};
```

### フロントエンドでの呼び出し

`src/routes/+page.svelte`:

```svelte
<script lang="ts">
  let loading = $state(false);
  let result = $state<any>(null);
  let error = $state<string | null>(null);

  // 東京駅の座標
  let latitude = $state(35.6812);
  let longitude = $state(139.7671);
  let radius = $state(500);

  async function searchStores() {
    loading = true;
    error = null;
    result = null;

    try {
      const response = await fetch(
        `/api/stores?lat=${latitude}&lng=${longitude}&radius=${radius}`
      );
      const data = await response.json();

      if (data.success) {
        result = data;
      } else {
        error = data.error || 'Unknown error';
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Network error';
    } finally {
      loading = false;
    }
  }

  // 現在地を取得
  function getCurrentLocation() {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          latitude = position.coords.latitude;
          longitude = position.coords.longitude;
        },
        (err) => {
          error = `位置情報の取得に失敗: ${err.message}`;
        }
      );
    } else {
      error = 'このブラウザは位置情報に対応していません';
    }
  }
</script>

<div class="container">
  <h1>Shoptime - 店舗検索</h1>
  
  <div class="controls">
    <button onclick={getCurrentLocation}>現在地を取得</button>
    <input type="number" bind:value={latitude} placeholder="緯度" step="0.0001" />
    <input type="number" bind:value={longitude} placeholder="経度" step="0.0001" />
    <input type="number" bind:value={radius} placeholder="半径（m）" />
    <button onclick={searchStores} disabled={loading}>
      {loading ? '検索中...' : '検索'}
    </button>
  </div>

  {#if error}
    <div class="error">エラー: {error}</div>
  {/if}

  {#if result}
    <div class="result">
      <h2>検索結果</h2>
      <p>見つかった店舗: {result.total_found}件</p>
      <p>フィルタリング後: {result.after_filter}件</p>
      <p>処理済み: {result.processed}件</p>
      
      <div class="stores">
        {#each result.results as item}
          <div class="store">
            <h3>{item.store}</h3>
            {#if item.saved}
              <p>✅ Notionに保存済み</p>
              <ul>
                <li>お酒: {item.analysis.alcohol_available ? 'あり' : 'なし'}</li>
                <li>雰囲気: {item.analysis.mood}</li>
                <li>おすすめ: {item.analysis.ai_recommendation}</li>
                <li>ラストオーダーリスク: {item.analysis.is_last_order_risk ? 'あり' : 'なし'}</li>
              </ul>
            {:else}
              <p>❌ エラー: {item.error}</p>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .container {
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem;
  }

  .controls {
    display: flex;
    gap: 1rem;
    margin: 2rem 0;
    flex-wrap: wrap;
  }

  .error {
    color: red;
    padding: 1rem;
    background: #ffe0e0;
    border-radius: 4px;
  }

  .stores {
    display: grid;
    gap: 1rem;
    margin-top: 2rem;
  }

  .store {
    border: 1px solid #ddd;
    padding: 1rem;
    border-radius: 8px;
  }

  .store h3 {
    margin-top: 0;
  }

  input {
    padding: 0.5rem;
    border: 1px solid #ddd;
    border-radius: 4px;
  }

  button {
    padding: 0.5rem 1rem;
    background: #0066cc;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  button:disabled {
    background: #ccc;
    cursor: not-allowed;
  }
</style>
```

## API関数の詳細

### `fetchNearbyStores(lat, lng, radius?)`

指定された位置の周辺にある営業中のレストランを取得します。

**パラメータ:**
- `lat`: 緯度（必須）
- `lng`: 経度（必須）
- `radius`: 検索半径（メートル、デフォルト: 500）

**戻り値:** `Promise<StoreInfo[]>`

### `analyzeStoreWithGroq(reviews, storeName)`

レビューをAIで分析し、判定結果を返します。

**パラメータ:**
- `reviews`: レビューテキストの配列
- `storeName`: 店舗名

**戻り値:** `Promise<AIAnalysisResult>`

### `saveToNotion(storeData)`

店舗情報をNotionデータベースに保存します。

**パラメータ:**
- `storeData`: `NotionStoreData` 型のオブジェクト

**戻り値:** `Promise<void>`

### `filterStoresByClosingTime(stores, currentTime?)`

閉店まで60分未満の店舗を除外します。

**パラメータ:**
- `stores`: 店舗情報の配列
- `currentTime`: 現在時刻（デフォルト: `new Date()`）

**戻り値:** `StoreInfo[]`

## 注意事項

1. **API使用料**: Google Places APIは従量課金制です。大量のリクエストには注意してください。
2. **レート制限**: Groq APIには無料プランのレート制限がある可能性があります。
3. **エラーハンドリング**: 本番環境では適切なエラーハンドリングとログ記録を実装してください。
4. **セキュリティ**: `.env` ファイルは必ず `.gitignore` に含めてください。
