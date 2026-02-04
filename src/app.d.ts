// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	// Environment variable types for $env/static/private
	namespace NodeJS {
		interface ProcessEnv {
			GROQ_API_KEY: string;
			GOOGLE_MAPS_API_KEY: string;
			NOTION_API_KEY: string;
			NOTION_DATABASE_ID: string;
		}
	}
}

export { };
