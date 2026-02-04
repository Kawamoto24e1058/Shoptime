<script lang="ts">
	import { slide } from "svelte/transition"; // New
	import type { PageData } from "./$types";
	import { invalidateAll, goto } from "$app/navigation";
	import {
		Beer,
		Coffee,
		UtensilsCrossed,
		ShoppingBag,
		Cake,
		Trophy,
		Star, // New
		MapPin, // New
	} from "lucide-svelte";

	let { data }: { data: PageData } = $props();

	// 飲みモード
	let isDrinkingMode = $state(data.isDrinkingMode || false);

	// 飲みモード切り替え
	function toggleDrinkingMode() {
		isDrinkingMode = !isDrinkingMode;
		const url = new URL(window.location.href);
		if (isDrinkingMode) {
			url.searchParams.set("drunk", "1");
		} else {
			url.searchParams.delete("drunk");
		}
		// ゼロ秒切り替え (リロードなし)
		window.history.pushState({}, "", url);
	}

	// 選択されたカテゴリ (初期値: すべて)
	let selectedCategory = $state<string>("すべて");
	let isRefreshing = $state(false);

	// ソート状態
	type SortType = "rating" | "distance" | "time";
	let sortType = $state<SortType>("rating");

	// Search States (Hoisted)
	let locationQuery = $state("");

	// アコーディオン展開状態
	let expandedStoreId = $state<string | null>(null);

	function toggleExpand(id: string) {
		if (expandedStoreId === id) {
			expandedStoreId = null;
		} else {
			expandedStoreId = id;
		}
	}

	// 店舗データ（初期値は基本データ、ストリーミング完了後に更新）
	let stores = $state(data.stores);
	let isAnalyzing = $state(true);
	let loadingMessage = $state("AIが最新の口コミを読み込んでいます...");

	const loadingMessages = [
		"AIが最新の口コミを読み込んでいます...",
		"コンシェルジュがおすすめメニューを厳選中...",
		"お店の雰囲氣を分析しています...",
		"隠れた名店を探しています...",
		"アルコール提供状況を確認中...",
		"「必食メニュー」を抽出しています...",
	];

	// ランダムメッセージのローテーション
	$effect(() => {
		if (isAnalyzing) {
			const interval = setInterval(() => {
				const randomIndex = Math.floor(
					Math.random() * loadingMessages.length,
				);
				loadingMessage = loadingMessages[randomIndex];
			}, 2500);
			return () => clearInterval(interval);
		}
	});

	// ストリーミングデータの監視
	$effect(() => {
		// 初期ロードやナビゲーション時にリセット
		isAnalyzing = true;
		stores = data.stores;

		data.streamed.aiAnalyses.then((updatedStores) => {
			stores = updatedStores;
			isAnalyzing = false;
		});
	});

	// カテゴリリスト
	const categories = $derived([
		"すべて",
		"居酒屋・バー",
		"カフェ",
		"レストラン",
		"ベーカリー",
		"テイクアウト",
		"その他",
	]);

	// フィルタリングとソートが適用された店舗リスト
	const filteredStores = $derived.by(() => {
		// 1. Filter
		let result = stores;

		// Category Filter
		if (selectedCategory !== "すべて") {
			result = result.filter(
				(store) => store.category === selectedCategory,
			);
		}

		// Drinking Mode Filter
		if (isDrinkingMode) {
			result = result.filter((store) => {
				// AI分析完了後: スコアやフラグで判定
				if (store.drinking_score && store.drinking_score > 0) {
					return store.drinking_score >= 3.0; // 3.0以上のみ表示
				}
				if (store.hasAlcohol) return true;

				// AI分析前(初期表示): カテゴリや店名で簡易判定
				// 居酒屋、バー、バル、ダイニング等はOK
				const alcoholKeywords = [
					"居酒屋",
					"バー",
					"バル",
					"ダイニング",
					"焼肉",
					"酒",
					"Beer",
					"Wine",
					"Sake",
				];
				const categoryMatch = alcoholKeywords.some((k) =>
					store.category.includes(k),
				);
				const nameMatch = alcoholKeywords.some((k) =>
					store.name.includes(k),
				);
				return categoryMatch || nameMatch;
			});
		}

		// 2. Sort
		return [...result].sort((a, b) => {
			if (sortType === "rating") {
				// 飲みモードなら飲みスコア優先
				const scoreA = isDrinkingMode
					? a.drinking_score || a.rating || 0
					: a.score || a.rating || 0;
				const scoreB = isDrinkingMode
					? b.drinking_score || b.rating || 0
					: b.score || b.rating || 0;
				return scoreB - scoreA;
			} else if (sortType === "distance") {
				// 距離順: 距離が短い順
				return (a.distance || 0) - (b.distance || 0);
			} else if (sortType === "time") {
				// 時間順: 閉店までの時間が長い順
				return b.closingTimeMinutes - a.closingTimeMinutes;
			}
			return 0;
		});
	});

	// 更新ボタンの処理
	async function handleRefresh() {
		isRefreshing = true;
		try {
			await invalidateAll();
		} finally {
			isRefreshing = false;
		}
	}

	// 検索バー処理
	// locationQuery, moodQuery, clientKeyword are hoisted
	let predictions = $state<Array<{ description: string; place_id: string }>>(
		[],
	);
	let showPredictions = $state(false);
	let debounceTimer: ReturnType<typeof setTimeout>;

	// Session Token Management for Google Places API
	let sessionToken = $state("");

	function generateSessionToken() {
		return crypto.randomUUID();
	}

	async function handleInput() {
		if (debounceTimer) clearTimeout(debounceTimer);
		if (!locationQuery.trim()) {
			predictions = [];
			showPredictions = false;
			return;
		}

		// Generate token if not exists
		if (!sessionToken) {
			sessionToken = generateSessionToken();
		}

		debounceTimer = setTimeout(async () => {
			if (locationQuery.length < 2) return;
			try {
				const response = await fetch(
					`/api/places/autocomplete?input=${encodeURIComponent(locationQuery)}&session_token=${encodeURIComponent(sessionToken)}`,
				);
				if (response.ok) {
					const data = await response.json();
					predictions = data.predictions || [];
					showPredictions = predictions.length > 0;
				}
			} catch (error) {
				console.error("Autocomplete error:", error);
			}
		}, 500);
	}

	async function selectPrediction(prediction: {
		description: string;
		place_id: string;
	}) {
		locationQuery = prediction.description;
		showPredictions = false;

		try {
			// 詳細を取得（座標を得る）with Session Token
			const response = await fetch(
				`/api/places/details?place_id=${prediction.place_id}&session_token=${encodeURIComponent(sessionToken)}`,
			);

			// セッショントークンはDetails取得（＝フロー完了）で消費されるため、リセットする
			sessionToken = "";

			if (response.ok) {
				const details = await response.json();
				// 座標で検索実行
				const drunkParam = isDrinkingMode ? "&drunk=1" : "";

				goto(
					`/?lat=${details.lat}&lng=${details.lng}&name=${encodeURIComponent(details.name)}${drunkParam}`,
					{
						invalidateAll: true,
					},
				);
			} else {
				// 失敗したらテキスト検索にフォールバック
				const drunkParam = isDrinkingMode ? "&drunk=1" : "";
				goto(
					`/?q=${encodeURIComponent(prediction.description)}${drunkParam}`,
					{
						invalidateAll: true,
					},
				);
			}
		} catch (error) {
			console.error("Selection error:", error);
			const drunkParam = isDrinkingMode ? "&drunk=1" : "";
			goto(
				`/?q=${encodeURIComponent(prediction.description)}${drunkParam}`,
				{
					invalidateAll: true,
				},
			);
		}
	}

	// フォーカスが外れたら少し遅れて閉じる（クリック判定のため）
	function handleBlur() {
		setTimeout(() => {
			showPredictions = false;
		}, 200);
	}

	function handleCurrentLocation() {
		if (navigator.geolocation) {
			navigator.geolocation.getCurrentPosition(
				(position) => {
					const { latitude, longitude } = position.coords;
					const drunkParam = isDrinkingMode ? "&drunk=1" : "";
					goto(`/?lat=${latitude}&lng=${longitude}${drunkParam}`, {
						invalidateAll: true,
					});
				},
				(error) => {
					alert("現在地を取得できませんでした: " + error.message);
				},
			);
		} else {
			alert("お使いのブラウザは位置情報をサポートしていません。");
		}
	}

	// カテゴリアイコンを取得
	function getCategoryIcon(category: string) {
		switch (category) {
			case "居酒屋・バー":
				return Beer;
			case "カフェ":
				return Coffee;
			case "レストラン":
				return UtensilsCrossed;
			case "ベーカリー":
				return Cake;
			case "テイクアウト":
				return ShoppingBag;
			default:
				return UtensilsCrossed;
		}
	}
</script>

<div class="app">
	<header class="header">
		<div class="header-top">
			<h1>🍽️ Shoptime</h1>
			<p class="location">📍 {data.location.name}</p>
		</div>

		<div class="search-container">
			<!-- Location Search -->
			<div class="search-input-wrapper">
				<span class="search-icon">📍</span>
				<input
					type="text"
					placeholder="場所・駅名を検索"
					class="search-input"
					bind:value={locationQuery}
					oninput={handleInput}
					onkeydown={(e) => {
						// EnterでMoodが空なら場所検索、あれば両方検索
						// ここでは簡易的にLocation確定としてMoodSearchと同じ処理に流すか、Autocompleteを待つ
					}}
					onblur={handleBlur}
				/>
				<!-- Predictions (Same as before) -->
				{#if showPredictions}
					<div class="predictions-list">
						{#each predictions as prediction}
							<button
								class="prediction-item"
								onclick={() => selectPrediction(prediction)}
							>
								<span class="prediction-icon">📍</span>
								<span class="prediction-text"
									>{prediction.description}</span
								>
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<button
				class="location-btn"
				onclick={handleCurrentLocation}
				aria-label="現在地"
			>
				<MapPin size={20} />
			</button>
		</div>
	</header>

	<!-- Drinking Mode Toggle Banner -->
	<div class="mode-banner" class:active={isDrinkingMode}>
		<div class="mode-content">
			<div class="mode-text">
				<span class="mode-icon">{isDrinkingMode ? "🍻" : "🍽️"}</span>
				<div class="mode-info">
					<span class="mode-title"
						>{isDrinkingMode ? "飲みモード ON" : "通常モード"}</span
					>
					<span class="mode-desc"
						>{isDrinkingMode
							? "お酒とつまみが旨い店を厳選中"
							: "オールジャンルで検索中"}</span
					>
				</div>
			</div>
			<button class="mode-toggle-btn" onclick={toggleDrinkingMode}>
				{isDrinkingMode ? "OFFにする" : "飲みモードにする"}
			</button>
		</div>
	</div>

	{#if data.error}
		<div class="error-banner">
			<strong>⚠️ エラー:</strong>
			{data.error}
		</div>
	{/if}

	<div class="container">
		<!-- カテゴリフィルター -->
		<div class="filter-section">
			<h2 class="filter-title">カテゴリで絞り込み</h2>
			<div class="filter-buttons">
				{#each categories as category}
					<button
						class="filter-btn"
						class:active={selectedCategory === category}
						onclick={() => (selectedCategory = category)}
					>
						{category}
					</button>
				{/each}
			</div>
		</div>

		<!-- 統計情報 -->
		<div class="stats">
			<div class="stat-item">
				<span class="stat-label">営業中の店舗</span>
				<span class="stat-value">{data.stores.length}</span>
			</div>
			<div class="stat-item">
				<span class="stat-label">表示中</span>
				<span class="stat-value">{filteredStores.length}</span>
			</div>
		</div>

		<!-- 店舗リスト -->
		<div class="stores-section">
			<h2 class="section-title">現在営業中のおすすめ</h2>

			{#if filteredStores.length === 0}
				<div class="no-results">
					<p>該当する店舗が見つかりませんでした</p>
					<button
						class="reset-btn"
						onclick={() => (selectedCategory = "すべて")}
					>
						フィルターをリセット
					</button>
				</div>
			{:else}
				<!-- Sort Controls -->
				<div class="sort-controls">
					<button
						class="sort-btn"
						class:active={sortType === "rating"}
						onclick={() => (sortType = "rating")}
					>
						評価順
					</button>
					<button
						class="sort-btn"
						class:active={sortType === "distance"}
						onclick={() => (sortType = "distance")}
					>
						距離順
					</button>
					<button
						class="sort-btn"
						class:active={sortType === "time"}
						onclick={() => (sortType = "time")}
					>
						時間順
					</button>
				</div>

				<div class="store-list">
					{#each filteredStores as store, index}
						{@const CategoryIcon = getCategoryIcon(store.category)}
						{@const isExpanded = expandedStoreId === store.id}

						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<article
							class="store-card"
							class:expanded={isExpanded}
							onclick={() => toggleExpand(store.id)}
							style="animation-delay: {index * 100}ms"
						>
							<!-- Hero Image Section -->
							<div class="card-image-container">
								{#if store.photoName}
									<img
										src={`/api/photo?name=${store.photoName}&maxWidthPx=600&maxHeightPx=400`}
										alt={store.name}
										class="store-image"
										loading="lazy"
									/>
									<div class="image-overlay"></div>
								{:else}
									<div class="store-image-placeholder">
										<span class="placeholder-icon">☕️</span>
									</div>
								{/if}

								<!-- Floating Badges -->
								{#if store.formattedDistance}
									<div class="badge-floating badge-distance">
										📍 {store.formattedDistance}
									</div>
								{/if}

								<div class="badge-floating badge-status">
									{#if store.closingTimeMinutes >= 120}
										<span class="status-late"
											>🌙 深夜営業</span
										>
									{:else}
										<span class="status-closing"
											>あと{Math.floor(
												store.closingTimeMinutes / 60,
											)}h {store.closingTimeMinutes %
												60}m</span
										>
									{/if}
								</div>

								<!-- Overlay Content (Bottom of Image) -->
								<div class="card-overlay-content">
									<h3 class="store-name-overlay">
										{store.name}
									</h3>
									<span class="category-pill-overlay"
										>{store.category}</span
									>
								</div>
							</div>

							<!-- Card Body (Below Image) -->
							<div class="card-body">
								<!-- AI Score Row -->
								<div class="score-row">
									<div class="ai-score-container">
										<span class="label">AIスコア</span>
										{#if store.alcohol_status === "分析中..."}
											<div class="waveform small">
												<div class="waveform-bar"></div>
												<div class="waveform-bar"></div>
												<div class="waveform-bar"></div>
											</div>
										{:else}
											<div class="score-display">
												<span class="star">★</span>
												<span class="value"
													>{store.score?.toFixed(1) ||
														"3.0"}</span
												>
											</div>
										{/if}
									</div>

									<!-- Compact Action Buttons -->
									<div class="action-buttons-compact">
										<a
											href={store.phoneNumber
												? `tel:${store.phoneNumber}`
												: undefined}
											class="action-btn-compact call-btn {store.phoneNumber
												? ''
												: 'disabled'}"
											onclick={(e) => e.stopPropagation()}
										>
											<span class="icon">📞</span>
											<span class="btn-text">電話</span>
										</a>
										<a
											href={store.reservationUrl
												? store.reservationUrl
												: undefined}
											target="_blank"
											rel="noopener noreferrer"
											class="action-btn-compact reserve-btn {store.reservationUrl
												? ''
												: 'disabled'}"
											onclick={(e) => e.stopPropagation()}
										>
											<span class="icon">🌐</span>
											<span class="btn-text">予約</span>
										</a>
									</div>
								</div>
							</div>

							<!-- Details: Expanded -->
							{#if isExpanded}
								<div
									class="card-details"
									transition:slide={{ duration: 300 }}
								>
									<div class="details-content">
										<!-- Map Button -->
										<a
											href={store.googleMapsUri}
											target="_blank"
											rel="noopener noreferrer"
											class="map-btn"
											onclick={(e) => e.stopPropagation()}
										>
											<MapPin size={16} />
											Google Mapsで見る
										</a>

										<p class="address">
											📍 {store.address}
										</p>

										<div class="ai-section">
											<div class="ai-badge-row">
												<!-- Hero feature or Loading -->
												{#if isAnalyzing}
													<div
														class="hero-feature-skeleton"
													>
														<div class="waveform">
															<div
																class="waveform-bar"
															></div>
															<div
																class="waveform-bar"
															></div>
															<div
																class="waveform-bar"
															></div>
														</div>
														<span
															class="skeleton-text"
															style="margin-left: 8px;"
															>{loadingMessage}</span
														>
													</div>
												{:else if store.hero_feature}
													<div class="hero-feature">
														<span class="icon"
															>✨</span
														>
														<span
															>{store.hero_feature}</span
														>
													</div>
												{/if}
											</div>

											<div class="ai-content">
												{#if isAnalyzing}
													<div
														class="ai-insight-skeleton"
													>
														<div
															class="line short"
														></div>
														<div
															class="line long"
														></div>
														<div
															class="line medium"
														></div>
													</div>
												{:else}
													{#if store.alcohol_status && store.alcohol_status !== "分析中..."}
														<div
															class="alcohol-highlight"
														>
															<span
																class="highlight-icon"
																>🏷️</span
															>
															<span
																class="highlight-text"
																>{store.alcohol_status}</span
															>
														</div>
													{/if}

													<p class="ai-insight">
														{store.ai_insight ||
															"分析データがありません"}
													</p>

													{#if store.tags && store.tags.length > 0}
														<div class="ai-tags">
															{#each store.tags as tag}
																<span
																	class="ai-tag"
																	>{tag}</span
																>
															{/each}
														</div>
													{/if}

													{#if store.recommendedMenu}
														<div
															class="recommended-menu-box shine-effect"
														>
															<span class="label"
																>必食:</span
															>
															<span
																class="menu-name"
																>{store.recommendedMenu}</span
															>
														</div>
													{/if}

													{#if store.alcohol_note}
														<div
															class="alcohol-note-box"
														>
															<span class="icon"
																>🍷</span
															>
															<span
																>{store.alcohol_note}</span
															>
														</div>
													{/if}
												{/if}
											</div>

											<!-- Action Buttons -->
											<div class="action-buttons">
												{#if store.phoneNumber}
													<a
														href="tel:{store.phoneNumber}"
														class="action-btn phone"
													>
														<span class="icon"
															>📞</span
														>
														電話
													</a>
												{/if}

												{#if store.reservationUrl}
													<a
														href={store.reservationUrl}
														target="_blank"
														rel="noopener noreferrer"
														class="action-btn reserve"
													>
														<span class="icon"
															>📅</span
														>
														予約
													</a>
												{:else}
													<a
														href={store.googleMapsUri}
														target="_blank"
														rel="noopener noreferrer"
														class="action-btn map"
													>
														<span class="icon"
															>🗺️</span
														>
														地図
													</a>
												{/if}
											</div>
										</div>
									</div>
								</div>
							{/if}
						</article>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
```

<style>
	:global(body) {
		margin: 0;
		font-family: "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo,
			sans-serif;
		background-color: #f8f9fb;
		color: #333;
	}

	.app {
		min-height: 100vh;
		padding-bottom: 4rem;
	}

	/* Header */
	.header {
		background: rgba(255, 255, 255, 0.9);
		backdrop-filter: blur(12px);
		padding: 1rem 1.5rem;
		border-bottom: 1px solid #e5e7eb;
		position: sticky;
		top: 0;
		z-index: 50;
	}

	.header-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}

	.header h1 {
		margin: 0;
		font-family: serif; /* Trustworthy feel */
		font-size: 1.5rem;
		color: #005c9b;
		font-weight: 700;
		letter-spacing: 0.05em;
	}

	.location {
		margin: 0;
		color: #666;
		font-size: 0.85rem;
		font-weight: 500;
	}

	/* Search Container */
	.search-container {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 100%;
		max-width: 800px;
		margin: 0 auto;
	}

	@media (min-width: 640px) {
		.search-container {
			flex-direction: row;
		}
	}

	.search-input-wrapper {
		flex: 1;
		position: relative;
		display: flex;
		align-items: center;
	}

	.search-icon {
		position: absolute;
		left: 14px;
		color: #9ca3af;
		font-size: 1rem;
	}

	.search-input {
		width: 100%;
		padding: 12px 16px 12px 42px;
		border-radius: 8px;
		border: 1px solid #e5e7eb; /* Gray-200 */
		background: #ffffff;
		font-size: 0.95rem;
		color: #1f2937;
		outline: none;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); /* shadow-sm */
		transition: all 0.2s ease;
	}

	.search-input:focus {
		border-color: #005c9b;
		box-shadow: 0 0 0 3px rgba(0, 92, 155, 0.1);
	}

	/* Autocomplete Dropdown */
	.predictions-list {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		margin-top: 6px;
		background: white;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
		list-style: none;
		padding: 0;
		overflow: hidden;
		z-index: 100;
		max-height: 300px;
		overflow-y: auto;
	}

	.prediction-item {
		padding: 12px 16px;
		display: flex;
		align-items: center;
		gap: 12px;
		cursor: pointer;
		font-size: 0.9rem;
		color: #374151;
		border-bottom: 1px solid #f3f4f6;
		transition: background 0.2s;
	}

	.prediction-item:last-child {
		border-bottom: none;
	}

	.prediction-item:hover {
		background: #f9fafb;
	}

	input:checked ~ .mode-text {
		color: #ec4899;
	}

	/* Action Buttons */
	.action-buttons {
		display: flex;
		gap: 8px;
		margin-top: 12px;
		width: 100%;
	}

	.action-btn {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 8px 12px;
		border-radius: 6px;
		font-size: 0.9rem;
		font-weight: 600;
		text-decoration: none;
		transition: background-color 0.2s;
	}

	.action-btn.phone {
		background-color: #f3f4f6;
		color: #374151;
		border: 1px solid #d1d5db;
	}

	.action-btn.reserve {
		background-color: #ea580c; /* Orange */
		color: white;
		border: none;
	}

	.action-btn.map {
		background-color: #3b82f6; /* Blue */
		color: white;
		border: none;
	}

	.action-btn:hover {
		opacity: 0.9;
	}

	.action-btn:active {
		transform: scale(0.98);
	}

	.location-btn {
		width: 46px;
		height: 46px;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
		background: #ffffff;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.2rem;
		cursor: pointer;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
		transition: all 0.2s;
	}

	.location-btn:hover {
		background: #f3f4f6;
	}

	.error-banner {
		background: #fee2e2;
		border: 1px solid #fca5a5;
		color: #991b1b;
		padding: 1rem;
		margin: 1rem auto;
		max-width: 1200px;
		border-radius: 8px;
		font-weight: 500;
	}

	.container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem 1.5rem;
	}

	/* Filters */
	.filter-section {
		background: white;
		border-radius: 8px;
		padding: 1.5rem;
		margin-bottom: 1.5rem;
		border: 1px solid #e5e7eb;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); /* shadow-sm */
	}

	.filter-title {
		margin: 0 0 1rem 0;
		font-size: 1.1rem;
		color: #111827;
		font-family: serif;
		font-weight: 600;
	}

	.filter-buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.filter-btn {
		padding: 0.5rem 1.25rem;
		background: #f3f4f6;
		color: #4b5563;
		border: none;
		border-radius: 6px; /* slightly more rigid than pill */
		font-size: 0.9rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.filter-btn:hover {
		background: #e5e7eb;
	}

	.filter-btn.active {
		background: #005c9b;
		color: white;
	}

	/* Stats */
	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.stat-item {
		background: white;
		padding: 1.25rem;
		border-radius: 8px;
		text-align: center;
		border: 1px solid #e5e7eb;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
	}

	.stat-label {
		display: block;
		color: #6b7280;
		font-size: 0.85rem;
		margin-bottom: 0.25rem;
	}

	.section-title {
		font-size: 1.25rem;
		font-weight: 800;
		color: #1f2937;
		margin-bottom: 1rem;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.section-subtitle {
		font-size: 0.85rem;
		color: #6b7280;
		font-weight: normal;
	}

	/* Store Card */
	.section-title {
		font-size: 1.25rem;
		color: #111827;
		margin-bottom: 1.5rem;
		padding-left: 0.5rem;
		border-left: 4px solid #005c9b;
		font-family: serif;
	}

	.no-results {
		text-align: center;
		padding: 3rem;
		background: white;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
		color: #6b7280;
	}

	.reset-btn {
		margin-top: 1rem;
		padding: 0.5rem 1rem;
		background: #005c9b;
		color: white;
		border: none;
		border-radius: 6px;
		cursor: pointer;
	}

	/* Sort */
	/* Mode Banner */
	.mode-banner {
		background: #ffffff;
		border-bottom: 1px solid #e5e7eb;
		padding: 12px 16px;
		transition: all 0.3s ease;
	}

	.mode-banner.active {
		background: #fdf4ff; /* Gentle purple/pink tint for specialized mode */
		border-bottom-color: #d8b4fe;
	}

	.mode-content {
		max-width: 480px; /* Mobile width constraint */
		margin: 0 auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.mode-text {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.mode-icon {
		font-size: 1.5rem;
		animation: bounce 2s infinite;
	}

	.mode-info {
		display: flex;
		flex-direction: column;
	}

	.mode-title {
		font-weight: 700;
		color: #1f2937;
		font-size: 0.95rem;
	}

	.mode-desc {
		font-size: 0.75rem;
		color: #6b7280;
	}

	.mode-toggle-btn {
		background: #1f2937;
		color: white;
		border: none;
		padding: 6px 12px;
		border-radius: 20px;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: transform 0.1s;
	}

	.mode-banner.active .mode-toggle-btn {
		background: #7c3aed; /* Violet */
	}

	.mode-toggle-btn:active {
		transform: scale(0.95);
	}

	@keyframes bounce {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-3px);
		}
	}

	/* Controls */
	.sort-controls {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
		background: white;
		padding: 0.75rem;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
		width: fit-content;
	}

	.sort-btn {
		padding: 0.4rem 1rem;
		border: none;
		background: transparent;
		color: #6b7280;
		font-size: 0.9rem;
		font-weight: 500;
		cursor: pointer;
		border-radius: 4px;
		transition: all 0.2s;
	}

	.sort-btn:hover {
		color: #005c9b;
		background: #f0f9ff;
	}

	.sort-btn.active {
		background: #005c9b;
		color: white;
	}

	/* Store List */
	.store-list {
		display: grid;
		gap: 1.25rem;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
	}

	/* Header */
	.header {
		background: rgba(255, 255, 255, 0.6);
		backdrop-filter: blur(12px);
		padding: 1rem 1.5rem;
		border-bottom: 1px solid rgba(229, 231, 235, 0.5);
		position: sticky;
		top: 0;
		z-index: 50;
	}

	.store-card {
		background: rgba(255, 255, 255, 0.85); /* Slightly more opaque */
		backdrop-filter: blur(16px);
		border-radius: 16px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.6);
		overflow: hidden;
		transition:
			transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
			box-shadow 0.3s ease; /* Bouncy transition */
		cursor: pointer;

		/* Entry Animation */
		opacity: 0;
		animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
	}

	.store-card:hover {
		transform: translateY(-4px) scale(1.01);
		box-shadow: 0 12px 24px rgba(0, 92, 155, 0.12); /* Deep blue shadow */
		border-color: #bfdbfe;
		background: rgba(255, 255, 255, 0.95);
	}

	.store-card.expanded {
		background: rgba(255, 255, 255, 0.95);
		box-shadow: 0 16px 40px rgba(0, 92, 155, 0.15);
		border-color: #005c9b;
		transform: translateY(-2px);
		z-index: 10;
	}

	/* Card Details */
	.card-details {
		background: #f9fafb; /* Slightly darker inside */
		border-top: 1px solid #e5e7eb;
	}

	.details-content {
		padding: 1.25rem;
	}

	.map-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: #005c9b;
		text-decoration: none;
		font-size: 0.9rem;
		font-weight: 500;
		margin-bottom: 0.5rem;
	}

	.map-btn:hover {
		text-decoration: underline;
	}

	.address {
		margin: 0 0 1rem 0;
		font-size: 0.9rem;
		color: #6b7280;
	}

	/* AI Section */
	.ai-section {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		padding: 1rem;
	}

	.ai-badge-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}

	.hero-feature {
		background: linear-gradient(135deg, #005c9b 0%, #0077c8 100%);
		color: white;
		padding: 4px 10px;
		border-radius: 20px;
		font-size: 0.8rem;
		font-weight: 600;
		display: flex;
		align-items: center;
		gap: 4px;
		box-shadow: 0 2px 4px rgba(0, 92, 155, 0.2);
	}

	.ai-content {
		font-size: 0.95rem;
		color: #374151;
		line-height: 1.6;
	}

	.ai-insight {
		margin: 0 0 1rem 0;
		white-space: pre-wrap;
	}

	/* Tags */
	.ai-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 1rem;
	}

	.ai-tag {
		background: #eff6ff; /* blue-50 */
		color: #1d4ed8; /* blue-700 */
		padding: 4px 10px;
		border-radius: 9999px; /* pill */
		font-size: 0.8rem;
		font-weight: 500;
		border: 1px solid #dbeafe;
	}

	.recommended-menu-box,
	.alcohol-note-box {
		background: #f9fafb;
		padding: 0.75rem;
		border-radius: 6px;
		display: flex;
		align-items: flex-start;
		gap: 8px;
		font-size: 0.9rem;
		margin-bottom: 0.5rem;
	}

	.recommended-menu-box .label {
		color: #005c9b;
		font-weight: 700;
		white-space: nowrap;
	}

	.recommended-menu-box .menu-name {
		font-weight: 600;
		color: #111827;
	}

	.alcohol-note-box {
		background: #fef2f2;
		color: #991b1b;
		border: 1px solid #fee2e2;
	}

	.alcohol-note-box .icon {
		font-size: 1rem;
	}

	/* Skeleton Loading Styles */
	.hero-feature-skeleton {
		flex: 1;
		background: #f3f4f6;
		border-radius: 20px;
		padding: 6px 12px;
		display: flex;
		flex-direction: column;
		justify-content: center;
		position: relative;
		overflow: hidden;
		min-height: 32px;
	}

	.skeleton-text {
		font-size: 0.75rem;
		color: #6b7280;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		animation: fadeText 0.5s ease-in-out;
	}

	.progress-bar {
		position: absolute;
		bottom: 0;
		left: 0;
		height: 3px;
		background: #005c9b;
		width: 30%;
		animation: shimmer 1.5s infinite linear;
		opacity: 0.5;
	}

	.ai-insight-skeleton {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 4px 0;
	}

	.line {
		height: 12px;
		background: #e5e7eb;
		border-radius: 6px;
		animation: pulse 1.5s infinite ease-in-out;
	}

	.line.short {
		width: 60%;
	}
	.line.long {
		width: 90%;
	}
	.line.medium {
		width: 75%;
	}

	@keyframes shimmer {
		0% {
			left: -30%;
		}
		100% {
			left: 100%;
		}
	}

	@keyframes pulse {
		0% {
			opacity: 0.6;
		}
		50% {
			opacity: 0.3;
		}
		100% {
			opacity: 0.6;
		}
	}

	/* Waveform Animation */
	.waveform {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 3px;
		height: 20px;
	}

	.waveform-bar {
		width: 3px;
		background: #005c9b;
		border-radius: 99px;
		animation: wave 1s ease-in-out infinite;
	}

	.waveform-bar:nth-child(1) {
		animation-delay: 0s;
		height: 60%;
	}
	.waveform-bar:nth-child(2) {
		animation-delay: 0.1s;
		height: 100%;
	}
	.waveform-bar:nth-child(3) {
		animation-delay: 0.2s;
		height: 80%;
	}
	.waveform-bar:nth-child(4) {
		animation-delay: 0.3s;
		height: 50%;
	}

	@keyframes wave {
		0%,
		100% {
			transform: scaleY(0.5);
			opacity: 0.6;
		}
		50% {
			transform: scaleY(1);
			opacity: 1;
		}
	}

	/* Shine Effect */
	.shine-effect {
		position: relative;
		overflow: hidden;
	}

	.shine-effect::after {
		content: "";
		position: absolute;
		top: 0;
		left: -100%;
		width: 50%;
		height: 100%;
		background: linear-gradient(
			to right,
			rgba(255, 255, 255, 0) 0%,
			rgba(255, 255, 255, 0.6) 50%,
			rgba(255, 255, 255, 0) 100%
		);
		transform: skewX(-25deg);
		animation: shine 3s infinite;
	}

	@keyframes shine {
		0% {
			left: -100%;
		}
		20% {
			left: 200%;
		}
		100% {
			left: 200%;
		}
	}

	/* Card Redesign */
	.store-card {
		background: #ffffff;
		border-radius: 16px;
		box-shadow: 0 4px 6px rgba(0, 0, 0, 0.04);
		overflow: hidden;
		transition:
			transform 0.2s,
			box-shadow 0.2s;
		border: 1px solid #f3f4f6;
		display: flex;
		flex-direction: column;
	}

	.store-card:active {
		transform: scale(0.99);
	}

	.card-image-container {
		position: relative;
		height: 200px;
		width: 100%;
		background-color: #e5e7eb;
	}

	.store-image {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.store-image-placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(135deg, #e0f2fe 0%, #f3e8ff 100%);
	}

	.placeholder-icon {
		font-size: 3rem;
		opacity: 0.5;
	}

	.image-overlay {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		height: 80%;
		background: linear-gradient(
			to top,
			rgba(0, 0, 0, 0.8) 0%,
			rgba(0, 0, 0, 0) 100%
		);
		pointer-events: none;
	}

	/* Floating Badges */
	.badge-floating {
		position: absolute;
		top: 12px;
		z-index: 10;
		background: rgba(255, 255, 255, 0.95);
		backdrop-filter: blur(4px);
		padding: 4px 8px;
		border-radius: 20px;
		font-size: 0.75rem;
		font-weight: 600;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
	}

	.badge-distance {
		left: 12px;
		color: #4b5563;
	}

	.badge-status {
		right: 12px;
	}

	.status-late {
		color: #5b21b6; /* darker violet */
	}

	.status-closing {
		color: #b91c1c; /* red */
	}

	/* Overlay Content */
	.card-overlay-content {
		position: absolute;
		bottom: 16px;
		left: 16px;
		right: 16px;
		z-index: 10;
		color: white;
		text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
	}

	.store-name-overlay {
		margin: 0;
		font-size: 1.25rem;
		font-weight: 700;
		line-height: 1.3;
		margin-bottom: 4px;
	}

	.category-pill-overlay {
		display: inline-block;
		font-size: 0.75rem;
		opacity: 0.9;
		background: rgba(255, 255, 255, 0.2);
		padding: 2px 8px;
		border-radius: 4px;
		backdrop-filter: blur(4px);
	}

	/* Card Body */
	.card-body {
		padding: 16px;
	}

	.score-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.ai-score-container {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
	}

	.ai-score-container .label {
		font-size: 0.7rem;
		color: #6b7280;
		font-weight: 600;
	}

	.ai-score-container .score-display {
		display: flex;
		align-items: center;
		gap: 4px;
		color: #f59e0b;
		font-weight: 700;
		font-size: 1.2rem;
	}

	/* Action Buttons Compact (Already defined but tweaking for new layout) */
	.action-buttons-compact {
		display: flex;
		gap: 0.5rem;
		flex: 1;
		margin-top: 0; /* Reset */
		justify-content: flex-end;
	}

	.action-btn-compact {
		flex: 1; /* Reset to grow properly */
		max-width: 120px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		height: 40px;
		border-radius: 10px;
		font-weight: 600;
		font-size: 0.85rem;
		text-decoration: none;
		transition:
			transform 0.2s,
			background-color 0.2s;
	}

	.action-btn-compact .icon {
		font-size: 1rem;
	}

	.call-btn {
		background: #f0f9ff;
		color: #0284c7;
		border: 1px solid #e0f2fe;
	}

	.reserve-btn {
		background: #005c9b;
		color: white;
		box-shadow: 0 4px 6px rgba(0, 92, 155, 0.2);
	}

	.action-btn:active,
	.action-btn-compact:active {
		transform: scale(0.98);
	}

	/* Action Buttons */
	.action-buttons {
		display: flex;
		gap: 0.75rem;
		margin-top: 1rem;
		margin-bottom: 1rem;
	}

	.action-btn {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		height: 48px; /* Touch friendly */
		border-radius: 12px;
		font-weight: 600;
		font-size: 0.95rem;
		text-decoration: none;
		transition:
			transform 0.2s,
			box-shadow 0.2s;
	}

	.call-btn {
		background: #e0f2fe; /* Light Blue */
		color: #005c9b;
		border: 1px solid #bfdbfe;
	}

	.reserve-btn {
		background: #005c9b; /* Accent Color */
		color: white;
		box-shadow: 0 4px 12px rgba(0, 92, 155, 0.2);
	}

	.action-btn:active {
		transform: scale(0.98);
	}

	.action-btn.disabled,
	.action-btn-compact.disabled {
		background: #f3f4f6;
		color: #9ca3af;
		border-color: #e5e7eb;
		box-shadow: none;
		pointer-events: none;
		opacity: 0.6;
	}

	/* Animations */
	@keyframes fadeInUp {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes fadeText {
		from {
			opacity: 0;
			transform: translateY(2px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
