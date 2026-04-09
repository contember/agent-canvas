import { define, KVNamespace, R2Bucket, Worker } from 'oblaka-iac'

/**
 * Per-environment overrides. `local` is what `bunx oblaka oblaka.ts` uses
 * when generating wrangler.jsonc for `wrangler dev --local`. `stage` and
 * `prod` are picked when running `bunx oblaka oblaka.ts --env stage|prod`
 * for actual Cloudflare deploys.
 *
 * Secrets (SHARE_AUTH_TOKEN, SHARE_TTL_SECONDS overrides, etc.) are NOT
 * declared here — set them with `wrangler secret put` after deploy.
 */
const vars = {
	local: {
		// Empty share auth in local dev so smoke tests don't need a token.
	},
	stage: {},
	prod: {},
}

export default define(({ env }) => {
	if (!(env in vars)) {
		throw new Error(`Unknown environment ${env}`)
	}

	const blobs = new R2Bucket({
		name: 'canvas-share-blobs',
	})

	const feedback = new KVNamespace({
		name: 'canvas-share-feedback',
	})

	return new Worker({
		dir: '.',
		name: 'canvas-share',
		main: './src/index.ts',
		compatibility_flags: ['nodejs_compat'],
		compatibility_date: '2025-01-01',
		observability: { enabled: true },
		// Runtime bundles (preact-compat, runtime, components, client.js + css)
		// are mirrored here from daemon/dist/ by `bun run build` in the repo
		// root. The worker serves them via the ASSETS binding.
		assets: {
			directory: './public',
			binding: 'ASSETS',
		},
		bindings: {
			BLOBS: blobs,
			FEEDBACK: feedback,
		},
		vars: {
			ENVIRONMENT: env,
			...vars[env as keyof typeof vars],
		},
	})
})
