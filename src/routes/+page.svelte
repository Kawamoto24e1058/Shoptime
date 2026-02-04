<script lang="ts">
	import { fade, fly, slide } from "svelte/transition";
	import { cubicOut } from "svelte/easing";
	import type { PageData } from "./$types";
	import { invalidateAll, goto } from "$app/navigation";
	import { navigating } from "$app/stores"; // Import navigating store
	import {
		Search,
		Beer,
		Coffee,
		Utensils,
		Croissant,
		ShoppingBag,
		MoreHorizontal,
		Star,
		MapPin,
		Phone,
		CalendarDays,
		Wine,
		Pizza,
		Soup,
		Sandwich,
		Activity,
		Clock,
		ListFilter,
	} from "lucide-svelte";

	let { data }: { data: PageData } = $props();

	// 飲みモード (保持)
	// 飲みモード (Reactive derived)
	// 飲みモード (Reactive derived from props)
	let isDrinkingMode = $derived(data.isDrinkingMode || false);

	// Streamed Data (Reactive derived from props)
	let storesPromise = $derived(data.streamed.stores);
	let aiPromise = $derived(data.streamed.aiAnalyses);

	let stores = $state<any[]>([]); // Resolved stores for filtering
	let aiDataMap = $state<Record<string, any>>({});

	// isSearching removed (handled by await block)
	let isAnalyzing = $state(true); // Default true to prevent flash
	let loadingMessage = $state("AIがお店を分析中...");
	let selectedCategory = $state("すべて");
	let sortType = $state("rating"); // 'rating', 'distance', 'time'
	let expandedStoreId = $state<string | null>(null);

	// Location Search
	let showLocationSearch = $state(false);
	let locationQuery = $state("");
	let predictions: any[] = $state([]);
	let showPredictions = $state(false);

	// Pagination
	let visibleCount = $state(10);
	function loadMore() {
		visibleCount += 10;
	}

	// Loading Messages
	const loadingMessages = [
		"AIがレビューを分析中...",
		"最適な一杯を探しています...",
		"お店の雰囲気をチェック中...",
		"混雑状況を予測中...",
		"最高の体験を検索中...",
	];

	// ストリーミングデータの監視
	// ストリーミングデータの監視
	$effect(() => {
		// Sync Resolved Stores
		if (storesPromise) {
			storesPromise.then((loaded) => {
				stores = loaded;
				isAnalyzing = true;
			});
		}

		// Handle AI Analysis
		if (aiPromise) {
			aiPromise.then((updatedStores) => {
				if (!updatedStores || updatedStores.length === 0) {
					isAnalyzing = false;
					return;
				}

				// AI Data Map Update
				const newMap = { ...aiDataMap };
				updatedStores.forEach((s: any) => {
					newMap[s.id] = s;
				});
				aiDataMap = newMap;
				isAnalyzing = false;
			});
		}
	});

	// Loading Message Interval
	$effect(() => {
		let interval: any;
		if (isAnalyzing) {
			interval = setInterval(() => {
				const randomIndex = Math.floor(
					Math.random() * loadingMessages.length,
				);
				loadingMessage = loadingMessages[randomIndex];
			}, 2500);
		}
		return () => {
			if (interval) clearInterval(interval);
		};
	});

	// カテゴリリスト
	const categories = $derived([
		"すべて",
		"居酒屋",
		"バー",
		"カフェ",
		"ラーメン",
		"和食",
		"中華",
		"焼肉",
		"寿司",
		"イタリアン",
		"フレンチ",
		"ハンバーガー",
		"ファストフード",
		"レストラン",
		"ベーカリー",
		"テイクアウト",
		"その他",
	]);

	// Icon Mapping
	const categoryIcons: Record<string, any> = {
		居酒屋: Beer,
		バー: Wine,
		カフェ: Coffee,
		ラーメン: Soup,
		和食: Utensils,
		中華: Utensils,
		焼肉: Utensils,
		寿司: Utensils,
		イタリアン: Pizza,
		フレンチ: Wine,
		ハンバーガー: Sandwich,
		ファストフード: Sandwich,
		レストラン: Utensils,
		ベーカリー: Croissant,
		テイクアウト: ShoppingBag,
		その他: MoreHorizontal,
		すべて: ListFilter,
	};

	function getCategoryIcon(cat: string) {
		return categoryIcons[cat] || Utensils;
	}

	// フィルタリングとソートが適用された店舗リスト
	const filteredStores = $derived.by(() => {
		let result = stores;

		// Category Filter
		if (selectedCategory !== "すべて") {
			if (selectedCategory === "テイクアウト") {
				result = result.filter(
					(store) =>
						store.category === "テイクアウト" || store.hasTakeout,
				);
			} else {
				result = result.filter(
					(store) => store.category === selectedCategory,
				);
			}
		}

		// Drinking Mode Filter
		if (isDrinkingMode) {
			result = result.filter((store) => {
				if (store.drinking_score && store.drinking_score > 0) {
					return store.drinking_score >= 3.0; // 3.0以上のみ表示
				}
				if (store.hasAlcohol) return true;
				const alcoholKeywords = [
					"居酒屋",
					"バー",
					"バル",
					"ダイニング",
					"焼肉",
					"酒",
					"ビア",
					"pub",
					"izakaya",
				];
				if (
					alcoholKeywords.some(
						(kw) =>
							store.category.includes(kw) ||
							store.name.includes(kw),
					)
				) {
					return true;
				}
				return true;
			});
		}

		// Sort
		const sorted = result.sort((a, b) => {
			if (sortType === "rating") return (b.score || 0) - (a.score || 0);
			if (sortType === "distance")
				return (a.distance || 0) - (b.distance || 0);
			if (sortType === "time")
				return (a.distance || 0) - (b.distance || 0); // Fallback
			return 0;
		});

		return sorted;
	});

	// Displayed Stores (Paginated)
	const displayedStores = $derived(filteredStores.slice(0, visibleCount));

	// Handlers
	function toggleDrinkingMode() {
		// isDrinkingMode = !isDrinkingMode; // Cannot assign to derived
		// URLパラメータ更新
		const url = new URL(window.location.href);
		// Toggle based on current value
		if (!isDrinkingMode) {
			url.searchParams.set("drunk", "1");
		} else {
			url.searchParams.delete("drunk");
		}
		goto(url.toString(), { invalidateAll: true });
	}

	function handleCategorySelect(cat: string) {
		selectedCategory = cat;
	}

	function toggleExpand(id: string) {
		expandedStoreId = expandedStoreId === id ? null : id;
	}

	// Sort Handler
	function handleSort(type: string) {
		sortType = type;
	}

	// Autocomplete & Navigation (Same Logic)
	// Autocomplete & Navigation (Optimized)
	let debounceTimer: ReturnType<typeof setTimeout>;
	let abortController: AbortController | null = null;
	let isFetching = $state(false); // Client Execution Lock

	async function handleInput() {
		clearTimeout(debounceTimer);

		// Execution Lock Check
		if (isFetching) return;

		// Cancel previous request
		if (abortController) {
			abortController.abort();
		}

		debounceTimer = setTimeout(async () => {
			if (locationQuery.length > 1) {
				isFetching = true;
				abortController = new AbortController();
				try {
					const response = await fetch(
						`/api/places/autocomplete?input=${encodeURIComponent(locationQuery)}`,
						{
							signal: abortController.signal,
						},
					);
					const data = await response.json();
					predictions = data.predictions;
					showPredictions = true;
				} catch (e: any) {
					if (e.name !== "AbortError") {
						console.error("Autocomplete error:", e);
					}
				} finally {
					isFetching = false;
				}
			} else {
				predictions = [];
				showPredictions = false;
			}
		}, 500); // 500ms Debounce
	}

	async function selectPrediction(prediction: any) {
		try {
			showLocationSearch = false;
			locationQuery = prediction.description;
			const drunkParam = isDrinkingMode ? "&drunk=1" : "";
			goto(
				`/?q=${encodeURIComponent(prediction.description)}${drunkParam}`,
				{ invalidateAll: true },
			);
		} catch (error) {
			console.error("Selection error:", error);
			const drunkParam = isDrinkingMode ? "&drunk=1" : "";
			goto(`/?q=${encodeURIComponent(locationQuery)}${drunkParam}`, {
				invalidateAll: true,
			});
		}
	}

	function handleBlur() {
		// Close predictions on blur (delay to allow click)
		setTimeout(() => {
			showPredictions = false;
		}, 200);
	}

	// Client-side Search Handler
	function handleSearch(event: Event) {
		event.preventDefault(); // Stop form submission
		debounceTimer && clearTimeout(debounceTimer);
		showPredictions = false;

		// Physical Block: Prevent multiple submissions
		if (isFetching || $navigating) return;

		if (!locationQuery.trim()) return;

		isFetching = true; // Show spinner if you have one linked to this
		// Use goto for client-side navigation (triggers server load without full reload)
		const drunkParam = isDrinkingMode ? "&drunk=1" : "";
		goto(`/?q=${encodeURIComponent(locationQuery)}${drunkParam}`, {
			invalidateAll: true,
			keepFocus: true, // Keep focus on input
		});
		// Note: isFetching will not auto-reset here because navigation is async.
		// The page transition (navigating state) usually handles visual loading feedback.
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
					showLocationSearch = false;
				},
				(error) => {
					alert("現在地を取得できませんでした: " + error.message);
				},
			);
		} else {
			alert("お使いのブラウザは位置情報をサポートしていません。");
		}
	}

	function autofocus(node: HTMLElement) {
		node.focus();
	}
</script>

<div
	class="min-h-screen font-sans transition-colors duration-500"
	style="background: {isDrinkingMode
		? '#1a1a1a'
		: '#f8f9fa'}; color: {isDrinkingMode ? '#f0f0f0' : '#333333'};"
>
	<!-- 1. Header & Navigation -->
	<header
		class="sticky top-0 z-50 w-full px-4 py-3 shadow-md transition-all duration-300 backdrop-blur-md"
		style="background: {isDrinkingMode
			? 'rgba(26, 26, 26, 0.95)'
			: 'rgba(255, 255, 255, 0.95)'}; border-bottom: 1px solid {isDrinkingMode
			? '#333'
			: '#e5e7eb'};"
	>
		<div class="max-w-xl mx-auto flex flex-col gap-4">
			<!-- Top Row: Logo & Location -->
			<div class="flex items-center justify-between">
				<h1
					class="text-2xl font-serif font-bold tracking-tight"
					style="color: {isDrinkingMode ? '#f59e0b' : '#00558c'}"
				>
					Shoptime
				</h1>

				<div
					class="flex items-center gap-2 text-sm font-medium opacity-80"
				>
					<MapPin size={14} />
					<span
						>{data.location?.name && data.location.name.length > 10
							? data.location.name.substring(0, 10) + "..."
							: data.location?.name || "現在地周辺"}</span
					>
					<button
						class="ml-2 p-1.5 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
						onclick={toggleDrinkingMode}
						title="飲みモード切替"
					>
						{#if isDrinkingMode}
							<Beer size={14} class="text-amber-500" />
						{:else}
							<Coffee size={14} class="text-gray-500" />
						{/if}
					</button>
				</div>
			</div>

			<!-- Center Row: Search Bar -->
			<!-- Form to handle Enter key -->
			<form class="relative w-full" onsubmit={handleSearch}>
				<div
					class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"
				>
					{#if $navigating}
						<!-- Spinner while navigating -->
						<div
							class="animate-spin h-5 w-5 border-2 border-gray-300 border-t-blue-500 rounded-full"
						></div>
					{:else}
						<Search class="h-5 w-5 text-gray-400" />
					{/if}
				</div>
				<input
					type="text"
					name="q"
					bind:value={locationQuery}
					oninput={handleInput}
					onblur={handleBlur}
					placeholder="場所を入力（例：和泉中央）"
					disabled={!!$navigating || isFetching}
					class="block w-full pl-10 pr-12 py-3 border-none rounded-xl leading-5 bg-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all shadow-inner disabled:opacity-50 disabled:cursor-not-allowed"
				/>
				<button
					type="button"
					disabled={!!$navigating || isFetching}
					class="absolute inset-y-0 right-0 pr-3 flex items-center cursor-pointer hover:scale-110 transition-transform text-blue-600 disabled:opacity-50 disabled:hover:scale-100"
					onclick={handleCurrentLocation}
				>
					<MapPin class="h-5 w-5" />
				</button>

				<!-- Autocomplete List -->
				{#if showPredictions && predictions.length > 0}
					<ul
						class="absolute z-10 w-full bg-white shadow-lg max-h-60 rounded-md py-1 text-base ring-1 ring-black ring-opacity-5 overflow-auto focus:outline-none sm:text-sm mt-1"
					>
						{#each predictions as prediction}
							<li>
								<button
									type="button"
									class="w-full text-left py-2 pl-3 pr-9 hover:bg-gray-100 text-gray-900 cursor-pointer block truncate"
									onclick={() => selectPrediction(prediction)}
								>
									{prediction.description}
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</form>
		</div>
	</header>

	<main class="max-w-xl mx-auto px-4 pb-20 pt-6 space-y-8">
		<!-- 2. Stats & Filtering -->
		<section class="space-y-4">
			<!-- Category Panel -->
			<div
				class="p-4 rounded-xl shadow-sm border transition-colors duration-300"
				style="background: {isDrinkingMode
					? '#262626'
					: 'white'}; border-color: {isDrinkingMode
					? '#333'
					: '#eee'};"
			>
				<h2
					class="text-xs font-bold uppercase tracking-wider mb-3 opacity-70"
				>
					カテゴリで絞り込み
				</h2>
				<div
					class="flex gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-2 px-2"
				>
					{#each categories as cat}
						<button
							class="flex-shrink-0 px-4 py-2 rounded-lg text-sm font-bold transition-all border"
							style="
                                background: {selectedCategory === cat
								? isDrinkingMode
									? '#f59e0b'
									: '#00558c'
								: 'transparent'};
                                color: {selectedCategory === cat
								? 'white'
								: isDrinkingMode
									? '#aaa'
									: '#555'};
                                border-color: {selectedCategory === cat
								? 'transparent'
								: isDrinkingMode
									? '#444'
									: '#e5e7eb'};
                            "
							onclick={() => handleCategorySelect(cat)}
						>
							{cat}
						</button>
					{/each}
				</div>
			</div>

			<!-- Status Cards -->
			<div class="grid grid-cols-2 gap-4">
				<div
					class="p-5 rounded-xl shadow-sm border flex flex-col items-center justify-center transition-colors duration-300"
					style="background: {isDrinkingMode
						? '#2a1a08'
						: 'white'}; border-color: {isDrinkingMode
						? '#d97706'
						: '#eee'};"
				>
					<span class="text-xs font-bold opacity-60 mb-1"
						>営業中の店舗</span
					>
					<span
						class="text-[2.5rem] font-black leading-none"
						style="color: {isDrinkingMode ? '#f59e0b' : '#00558c'}"
					>
						{stores.length}
					</span>
				</div>
				<div
					class="p-5 rounded-xl shadow-sm border flex flex-col items-center justify-center transition-colors duration-300"
					style="background: {isDrinkingMode
						? '#262626'
						: 'white'}; border-color: {isDrinkingMode
						? '#333'
						: '#eee'};"
				>
					<span class="text-xs font-bold opacity-60 mb-1">表示中</span
					>
					<span
						class="text-[2.5rem] font-black leading-none"
						style="color: {isDrinkingMode ? '#fff' : '#007bff'}"
					>
						{filteredStores.length}
					</span>
				</div>
			</div>
		</section>

		<!-- 3. List Area -->
		<section>
			<div class="flex items-center justify-between mb-4">
				<h2 class="text-lg font-bold">現在営業中のおすすめ</h2>

				<!-- Sort Tabs -->
				<div class="flex bg-gray-100 p-1 rounded-lg">
					{#each ["rating", "distance"] as type}
						<button
							class="px-3 py-1.5 rounded-md text-xs font-bold transition-all"
							style="
                                background: {sortType === type
								? 'white'
								: 'transparent'};
                                color: {sortType === type ? '#333' : '#888'};
                                shadow: {sortType === type
								? '0 1px 2px rgba(0,0,0,0.1)'
								: 'none'};
                            "
							onclick={() => handleSort(type)}
						>
							{type === "rating" ? "評価順" : "距離順"}
						</button>
					{/each}
				</div>
			</div>

			<!-- List Layout (Compact Cards) -->
			<div class="grid grid-cols-1 gap-3 min-h-[50vh]">
				{#await data.streamed.stores}
					<!-- Skeleton Loader -->
					<div class="space-y-3">
						{#each Array(10) as _}
							<div
								class="flex items-center p-3 rounded-xl border border-gray-100 bg-white animate-pulse"
							>
								<div
									class="w-12 h-12 rounded-lg bg-gray-200 mr-4"
								></div>
								<div class="flex-1 space-y-2">
									<div
										class="h-4 bg-gray-200 rounded w-3/4"
									></div>
									<div
										class="h-3 bg-gray-100 rounded w-1/2"
									></div>
								</div>
							</div>
						{/each}
						<div
							class="text-center pt-4 opacity-60 text-xs font-bold text-gray-400"
						>
							お店を探しています...
						</div>
					</div>
				{:then _}
					<!-- Loaded List -->
					<div in:fade={{ duration: 300 }}>
						{#each displayedStores as store (store.id)}
							{@const Icon = getCategoryIcon(store.category)}
							{@const ai = aiDataMap[store.id]}

							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<div
								class="group relative flex items-center p-3 rounded-xl shadow-sm border transition-all hover:shadow-md active:scale-[0.99] cursor-pointer"
								style="background: {isDrinkingMode
									? '#262626'
									: 'white'}; border-color: {isDrinkingMode
									? '#333'
									: 'transparent'};"
								onclick={() => toggleExpand(store.id)}
								role="button"
								tabindex="0"
							>
								<!-- Left: Icon/Thumb -->
								<div
									class="flex-shrink-0 w-12 h-12 rounded-lg flex items-center justify-center mr-4"
									style="background: {isDrinkingMode
										? '#333'
										: '#f0f4f8'}; color: {isDrinkingMode
										? '#f59e0b'
										: '#00558c'};"
								>
									<Icon size={20} strokeWidth={2.5} />
								</div>

								<!-- Center: Info -->
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2 mb-0.5">
										<h3
											class="text-base font-bold truncate leading-tight"
										>
											{store.name}
										</h3>
									</div>
									<div
										class="flex items-center gap-3 text-xs opacity-70"
									>
										<span class="flex items-center gap-1">
											<MapPin size={10} />
											{store.formattedDistance}
										</span>
										<span class="flex items-center gap-1">
											<Star
												size={10}
												class="text-yellow-400 fill-yellow-400"
											/>
											{ai?.score || store.rating || "-"}
										</span>
										<span>{store.category}</span>
									</div>
								</div>

								<!-- Right: Status / Action -->
								<div
									class="flex-shrink-0 ml-2 flex flex-col items-end gap-1"
								>
									<div
										class="w-8 h-8 rounded-full flex items-center justify-center bg-green-100 text-green-600"
									>
										<Activity size={16} />
									</div>
								</div>
							</div>

							<!-- Expanded Details (Optional Visual) -->
							{#if expandedStoreId === store.id}
								{@const expandedAi = aiDataMap[store.id]}
								<div
									transition:slide
									class="mb-4 -mt-2 p-4 pt-6 rounded-b-xl border-x border-b shadow-sm relative z-0"
									style="background: {isDrinkingMode
										? '#2a2a2a'
										: '#fcfcfc'}; border-color: {isDrinkingMode
										? '#333'
										: '#eee'};"
								>
									<!-- Large Image if expanded -->
									{#if store.photoName}
										<div
											class="w-full h-32 rounded-lg bg-gray-200 overflow-hidden mb-3"
										>
											<img
												src={`https://places.googleapis.com/v1/${store.photoName}/media?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&maxHeightPx=400&maxWidthPx=600`}
												alt={store.name}
												class="w-full h-full object-cover"
												loading="lazy"
												decoding="async"
											/>
										</div>
									{/if}

									<p
										class="text-sm leading-relaxed mb-4 opacity-80"
									>
										{#if expandedAi?.ai_insight}
											<span
												class="font-bold text-blue-500 block mb-1"
												>AI Recommendation</span
											>
											{expandedAi.ai_insight}
										{:else}
											{store.editorialSummary?.text ||
												"詳細情報収集中..."}
										{/if}
									</p>

									<div class="flex gap-3">
										{#if store.phoneNumber}
											<a
												href={`tel:${store.phoneNumber}`}
												class="flex-1 py-2.5 rounded-lg bg-white border border-gray-200 text-center text-sm font-bold shadow-sm text-gray-700"
											>
												電話する
											</a>
										{/if}
										{#if store.googleMapsUri}
											<a
												href={store.googleMapsUri}
												target="_blank"
												rel="noopener"
												class="flex-1 py-2.5 rounded-lg text-center text-sm font-bold shadow-sm text-white"
												style="background: #007bff;"
											>
												地図を見る
											</a>
										{/if}
									</div>
								</div>
							{/if}
						{/each}

						{#if displayedStores.length === 0 && !isAnalyzing}
							<div class="py-10 text-center opacity-50">
								<p>
									条件に一致する店舗が見つかりませんでした。
								</p>
							</div>
						{/if}
					</div>
				{/await}
			</div>

			<!-- Load More Button -->
			{#if visibleCount < filteredStores.length}
				<div class="mt-6 flex justify-center">
					<button
						class="px-6 py-3 rounded-full bg-white border border-gray-200 text-sm font-bold shadow-sm hover:bg-gray-50 active:scale-95 transition-all text-gray-600"
						onclick={loadMore}
					>
						もっと見る ({filteredStores.length - visibleCount})
					</button>
				</div>
			{/if}
		</section>
	</main>
</div>

<!-- Location Search Modal (Simple Overlay) -->
{#if showLocationSearch}
	<div
		class="fixed inset-0 z-[100] bg-white/95 backdrop-blur-xl flex flex-col p-4 animate-in fade-in duration-200"
	>
		<div class="flex items-center gap-3 mb-6">
			<button
				class="p-2 -ml-2 rounded-full hover:bg-gray-100"
				onclick={() => (showLocationSearch = false)}
			>
				<MoreHorizontal class="rotate-90" size={24} />
			</button>
			<span class="font-bold text-lg">エリアを変更</span>
		</div>
		<div class="relative mb-6">
			<input
				type="text"
				bind:value={locationQuery}
				oninput={handleInput}
				onblur={handleBlur}
				placeholder="地名・駅名で検索..."
				class="w-full h-14 pl-12 pr-4 rounded-2xl bg-gray-100 border-none text-lg font-bold focus:ring-2 focus:ring-blue-500 transition-all placeholder:text-gray-400"
				use:autofocus
			/>
			<Search
				class="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
				size={20}
			/>
		</div>

		<!-- Predictions List -->
		{#if showPredictions && predictions.length > 0}
			<div class="flex flex-col gap-2">
				{#each predictions as prediction}
					<button
						class="flex items-center gap-3 p-4 rounded-xl hover:bg-gray-50 active:scale-95 transition-all text-left"
						onclick={() => selectPrediction(prediction)}
					>
						<MapPin size={16} class="text-gray-400" />
						<span class="font-bold text-gray-700"
							>{prediction.description}</span
						>
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	/* Custom Scrollbar */
	.scrollbar-hide::-webkit-scrollbar {
		display: none;
	}
	.scrollbar-hide {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
</style>
